// Ingestion quotidienne des prix Scryfall.
//
// 1. Télécharge le bulk "default_cards" (toutes les impressions, ~1 carte/printing).
// 2. Archive un extrait compressé (id, prix) de TOUTES les cartes papier dans
//    archives/YYYY-MM-DD.csv.gz — c'est ce qui permet de reconstruire
//    l'historique d'une carte ajoutée à la collection plus tard (backfill.mjs).
// 3. Insère un snapshot de prix en base pour les cartes suivies (table cards)
//    et rafraîchit leurs métadonnées.
// 4. Recalcule la valeur du jour de chaque folder.
//
// Usage : DATABASE_URL=postgres://... node scripts/ingest.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import pg from 'pg';
import StreamArray from 'stream-json/streamers/StreamArray.js';

const HEADERS = {
  'User-Agent': 'my-mtg-collection/0.1 (price ingestion)',
  Accept: 'application/json',
};

const SNAPSHOT_COLUMNS = ['card_id', 'snapped_on', 'eur', 'eur_foil', 'eur_etched', 'usd', 'usd_foil', 'usd_etched'];

function chunks(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const tracked = new Set((await db.query('select id from cards')).rows.map((r) => r.id));
  console.log(`Cartes suivies en base : ${tracked.size}`);

  const index = await (await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS })).json();
  const bulk = index.data.find((d) => d.type === 'default_cards');
  console.log(`Téléchargement du bulk (${Math.round(bulk.size / 1e6)} Mo) : ${bulk.download_uri}`);
  const res = await fetch(bulk.download_uri, { headers: HEADERS });
  if (!res.ok) throw new Error(`Bulk download failed: ${res.status}`);

  const today = new Date().toISOString().slice(0, 10);
  fs.mkdirSync('archives', { recursive: true });
  const archivePath = path.join('archives', `${today}.csv.gz`);
  const gz = zlib.createGzip({ level: 9 });
  const out = fs.createWriteStream(archivePath);
  gz.pipe(out);

  const writeLine = async (line) => {
    if (!gz.write(line)) await once(gz, 'drain');
  };
  await writeLine('id,eur,eur_foil,eur_etched,usd,usd_foil,usd_etched\n');

  const snapshots = [];
  const meta = [];
  let paperCards = 0;

  const stream = Readable.fromWeb(res.body).pipe(StreamArray.withParser());
  for await (const { value: card } of stream) {
    if (!card.games?.includes('paper')) continue;
    paperCards++;
    const p = card.prices ?? {};
    await writeLine(
      [card.id, p.eur, p.eur_foil, p.eur_etched, p.usd, p.usd_foil, p.usd_etched]
        .map((v) => v ?? '')
        .join(',') + '\n'
    );
    if (tracked.has(card.id)) {
      snapshots.push([card.id, today, p.eur, p.eur_foil, p.eur_etched, p.usd, p.usd_foil, p.usd_etched]);
      const img = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? {};
      meta.push([
        card.id,
        card.oracle_id ?? null,
        card.name,
        card.set,
        card.collector_number,
        card.rarity ?? null,
        img.normal ?? null,
        img.small ?? null,
        card.finishes ?? [],
        card.released_at ?? null,
      ]);
    }
  }
  gz.end();
  await once(out, 'finish');
  console.log(`Archive écrite : ${archivePath} (${paperCards} cartes papier)`);

  await db.query('begin');
  try {
    for (const batch of chunks(snapshots, 500)) {
      const placeholders = batch
        .map((row, i) => `(${row.map((_, j) => `$${i * row.length + j + 1}`).join(',')})`)
        .join(',');
      await db.query(
        `insert into price_snapshots (${SNAPSHOT_COLUMNS.join(',')})
         values ${placeholders}
         on conflict (card_id, snapped_on) do update set
           eur = excluded.eur, eur_foil = excluded.eur_foil, eur_etched = excluded.eur_etched,
           usd = excluded.usd, usd_foil = excluded.usd_foil, usd_etched = excluded.usd_etched`,
        batch.flat().map((v) => v ?? null)
      );
    }
    for (const m of meta) {
      await db.query(
        `update cards set oracle_id = $2, name = $3, set_code = $4, collector_number = $5,
           rarity = $6, image_normal = $7, image_small = $8, finishes = $9,
           released_at = $10, updated_at = now()
         where id = $1`,
        m
      );
    }
    await db.query('select public.snapshot_collection_values()');
    await db.query('commit');
  } catch (err) {
    await db.query('rollback');
    throw err;
  }

  // Évaluation des alertes (tolérante : la migration peut ne pas être appliquée).
  try {
    const fired = await db.query('select public.evaluate_alert_rules() as count');
    console.log(`Alertes déclenchées : ${fired.rows[0].count}`);
  } catch (err) {
    console.warn(`Évaluation des alertes sautée : ${err.message}`);
  }

  console.log(`Snapshots insérés : ${snapshots.length} | métadonnées rafraîchies : ${meta.length}`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
