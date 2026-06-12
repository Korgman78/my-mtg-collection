// Reconstruit l'historique de prix des cartes suivies à partir des archives
// quotidiennes (archives/YYYY-MM-DD.csv.gz). À lancer après avoir ajouté de
// nouvelles cartes à la collection : seules les dates manquantes sont insérées
// (on conflict do nothing).
//
// Usage : DATABASE_URL=postgres://... node scripts/backfill.mjs

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import pg from 'pg';

const SNAPSHOT_COLUMNS = ['card_id', 'snapped_on', 'eur', 'eur_foil', 'eur_etched', 'usd', 'usd_foil', 'usd_etched'];

function chunks(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

async function insertRows(db, rows) {
  for (const batch of chunks(rows, 500)) {
    const placeholders = batch
      .map((row, i) => `(${row.map((_, j) => `$${i * row.length + j + 1}`).join(',')})`)
      .join(',');
    await db.query(
      `insert into price_snapshots (${SNAPSHOT_COLUMNS.join(',')})
       values ${placeholders}
       on conflict (card_id, snapped_on) do nothing`,
      batch.flat().map((v) => (v === '' ? null : v))
    );
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const tracked = new Set((await db.query('select id from cards')).rows.map((r) => r.id));
  console.log(`Cartes suivies en base : ${tracked.size}`);
  if (tracked.size === 0) {
    console.log('Rien à backfiller.');
    await db.end();
    return;
  }

  const files = fs.existsSync('archives')
    ? fs.readdirSync('archives').filter((f) => /^\d{4}-\d{2}-\d{2}\.csv\.gz$/.test(f)).sort()
    : [];
  console.log(`Archives trouvées : ${files.length}`);

  let inserted = 0;
  for (const file of files) {
    const date = file.slice(0, 10);
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join('archives', file)).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    const rows = [];
    let header = true;
    for await (const line of rl) {
      if (header) { header = false; continue; }
      const comma = line.indexOf(',');
      const id = line.slice(0, comma);
      if (!tracked.has(id)) continue;
      const [eur, eurFoil, eurEtched, usd, usdFoil, usdEtched] = line.slice(comma + 1).split(',');
      rows.push([id, date, eur, eurFoil, eurEtched, usd, usdFoil, usdEtched]);
    }
    if (rows.length > 0) await insertRows(db, rows);
    inserted += rows.length;
    console.log(`${date} : ${rows.length} lignes`);
  }

  await db.query('select public.snapshot_collection_values()');
  console.log(`Terminé. ${inserted} snapshots traités.`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
