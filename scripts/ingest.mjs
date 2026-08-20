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
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import pg from 'pg';

const HEADERS = {
  'User-Agent': 'my-mtg-collection/0.1 (price ingestion)',
  Accept: 'application/json',
};

/** `--force` : réécrire même si la génération de prix est déjà connue. */
const force = process.argv.includes('--force');

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

  // Scryfall a changé le format de ses exports en 2026 : `download_uri` et
  // `size` ont disparu au profit de `jsonl_download_uri` et
  // `compressed_size`, et le contenu n'est plus un tableau JSON mais du
  // JSONL gzippé — une carte par ligne. L'ancien code téléchargeait donc
  // `undefined` et le job échouait avant d'écrire quoi que ce soit.
  const index = await (await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS })).json();
  const bulk = index.data.find((d) => d.type === 'default_cards');
  if (!bulk?.jsonl_download_uri) {
    throw new Error(
      "L'export « default_cards » de Scryfall n'expose pas jsonl_download_uri : " +
        `clés reçues = ${Object.keys(bulk ?? {}).join(', ')}. Le format a probablement changé.`
    );
  }

  // Une génération de prix déjà ingérée ne doit pas produire un second jour.
  //
  // Scryfall régénère cet export plusieurs fois par jour, mais les prix qu'il
  // contient ne bougent qu’environ une fois par 24 h. Deux ingestions dans la
  // même génération écrivent donc deux journées identiques au centime près —
  // ce qui vide l'onglet Tendances (il écarte les cartes qui n'ont pas bougé)
  // et fausse la moyenne 30 jours en comptant deux fois le même relevé.
  //
  // Le contrôle est fait AVANT le téléchargement : 78 Mo qu'on évite de tirer.
  const known = await db
    .query('select bulk_updated_at from ingest_state where singleton')
    .then((r) => r.rows[0]?.bulk_updated_at ?? null)
    .catch(() => null); // table absente : migration pas encore appliquée.

  if (known && new Date(known).getTime() === new Date(bulk.updated_at).getTime() && !force) {
    console.log(
      `Génération déjà ingérée (${bulk.updated_at}) — rien à faire.
` +
        'Scryfall publie de nouveaux prix environ une fois par jour. ' +
        'Utilise --force pour réécrire malgré tout.'
    );
    await db.end();
    return;
  }

  console.log(
    `Téléchargement du bulk (${Math.round(bulk.compressed_size / 1e6)} Mo compressés) : ` +
      bulk.jsonl_download_uri
  );
  const res = await fetch(bulk.jsonl_download_uri, { headers: HEADERS });
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

  // Décompression puis lecture ligne à ligne. `readline` fait le découpage
  // sans jamais charger les 78 Mo en mémoire, et gère les fins de ligne
  // qui tombent au milieu d'un bloc gzip.
  const stream = createInterface({
    input: Readable.fromWeb(res.body).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });

  for await (const line of stream) {
    if (line.length === 0) continue;
    const card = JSON.parse(line);
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

  // Génération retenue, pour que le prochain run sache quoi sauter.
  await db
    .query(
      `insert into ingest_state (singleton, bulk_updated_at, bulk_uri, snapshots)
       values (true, $1, $2, $3)
       on conflict (singleton) do update
         set bulk_updated_at = excluded.bulk_updated_at,
             bulk_uri        = excluded.bulk_uri,
             snapshots       = excluded.snapshots,
             ingested_at     = now()`,
      [bulk.updated_at, bulk.jsonl_download_uri, snapshots.length]
    )
    .catch((err) => console.warn(`État d'ingestion non enregistré : ${err.message}`));
  console.log(`Snapshots insérés : ${snapshots.length} | métadonnées rafraîchies : ${meta.length}`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
