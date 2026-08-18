// Construction de la base de référence du scanner, set par set.
//
// Pour chaque impression d'un set : on télécharge la petite image Scryfall,
// on la réduit en 32×32 gris et on calcule le pHash — avec EXACTEMENT le
// même code que l'app (mobile/src/lib/phash.ts, importé tel quel grâce au
// strip-types de Node ≥ 22). C'est la condition pour que les hachages soient
// comparables ; deux implémentations « équivalentes » ne suffiraient pas.
//
// On prend toutes les raretés et toutes les variantes, contrairement au bloc
// de set de l'app : un showcase a une autre illustration, donc un autre
// hachage, et doit être reconnaissable pour lui-même.
//
// Usage :
//   DATABASE_URL=postgres://... node scripts/hash-set.mjs otj mh3
//   DATABASE_URL=postgres://... node scripts/hash-set.mjs --dry-run otj

import jpeg from 'jpeg-js';
import pg from 'pg';

import { gray32FromRgba, phashFromGray32 } from '../mobile/src/lib/phash.ts';

const HEADERS = {
  'User-Agent': 'my-mtg-collection/0.1 (scanner reference hashing)',
  Accept: 'application/json',
};

// Scryfall demande 50–100 ms entre deux requêtes, et pas plus de 10 images/s.
const API_DELAY_MS = 120;
const IMAGE_DELAY_MS = 110;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chunks(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/** L'image d'une carte, face avant pour les recto-verso. */
function imageUris(card) {
  return card.image_uris ?? card.card_faces?.[0]?.image_uris ?? {};
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall ${res.status} sur ${url}`);
  return res.json();
}

/** Toutes les impressions d'un set, variantes comprises. */
async function fetchSetPrintings(setCode) {
  const q = encodeURIComponent(`set:${setCode} game:paper`);
  let url = `https://api.scryfall.com/cards/search?q=${q}&unique=prints&include_variations=true&order=set`;
  const cards = [];

  while (url) {
    const page = await fetchJson(url);
    cards.push(...page.data);
    url = page.has_more ? page.next_page : null;
    if (url) await sleep(API_DELAY_MS);
  }
  return cards;
}

/** Télécharge une image et en calcule le pHash. `null` si l'image manque. */
async function hashCardImage(card) {
  const uri = imageUris(card).small ?? imageUris(card).normal;
  if (!uri) return null;

  const res = await fetch(uri, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  // `useTArray` renvoie un Uint8Array plutôt qu'un Buffer : c'est la même
  // forme de donnée que celle que l'app obtiendra en décodant son PNG.
  const { data, width, height } = jpeg.decode(buffer, { useTArray: true });
  return phashFromGray32(gray32FromRgba(data, width, height));
}

async function hashSet(db, setCode, dryRun) {
  const set = await fetchJson(`https://api.scryfall.com/sets/${setCode}`);
  console.log(`\n${set.code.toUpperCase()} — ${set.name} (${set.card_count} cartes annoncées)`);

  const cards = await fetchSetPrintings(set.code);
  console.log(`  ${cards.length} impressions papier à hacher`);

  const rows = [];
  let skipped = 0;

  for (const [i, card] of cards.entries()) {
    try {
      const phash = await hashCardImage(card);
      if (!phash) {
        skipped++;
      } else {
        rows.push([
          card.id,
          card.set,
          card.name,
          card.collector_number,
          card.rarity ?? null,
          imageUris(card).small ?? null,
          imageUris(card).normal ?? null,
          card.released_at ?? null,
          phash,
        ]);
      }
    } catch (err) {
      skipped++;
      console.warn(`  ! ${card.name} (${card.collector_number}) : ${err.message}`);
    }

    if ((i + 1) % 50 === 0 || i === cards.length - 1) {
      process.stdout.write(`\r  hachées : ${rows.length}/${cards.length}`);
    }
    await sleep(IMAGE_DELAY_MS);
  }
  process.stdout.write('\n');

  // Un contrôle qui vaut la peine : deux cartes distinctes qui partagent un
  // hachage signalent une illustration réellement identique (rééditions) ou
  // un algorithme dégénéré. On l'affiche sans bloquer.
  const seen = new Map();
  let collisions = 0;
  for (const r of rows) {
    const key = r[8];
    if (seen.has(key)) collisions++;
    else seen.set(key, r[2]);
  }
  console.log(`  ${rows.length} hachées, ${skipped} sans image, ${collisions} hachages en double`);

  if (dryRun) {
    console.log('  (--dry-run : rien n’est écrit en base)');
    return;
  }

  for (const batch of chunks(rows, 200)) {
    const values = batch
      .map(
        (_, i) =>
          `($${i * 9 + 1},$${i * 9 + 2},$${i * 9 + 3},$${i * 9 + 4},$${i * 9 + 5},$${i * 9 + 6},$${i * 9 + 7},$${i * 9 + 8},$${i * 9 + 9}::bit(64))`
      )
      .join(',');
    await db.query(
      `insert into card_hashes
         (card_id, set_code, name, collector_number, rarity, image_small, image_normal, released_at, phash)
       values ${values}
       on conflict (card_id) do update set
         phash = excluded.phash,
         name = excluded.name,
         image_small = excluded.image_small,
         image_normal = excluded.image_normal,
         hashed_at = now()`,
      batch.flat()
    );
  }

  await db.query(
    `insert into hashed_sets (set_code, set_name, card_count, hashed_at)
     values ($1, $2, $3, now())
     on conflict (set_code) do update set
       set_name = excluded.set_name,
       card_count = excluded.card_count,
       hashed_at = now()`,
    [set.code, set.name, rows.length]
  );

  console.log(`  écrit en base.`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const codes = args.filter((a) => !a.startsWith('--')).map((c) => c.toLowerCase());

  if (codes.length === 0) {
    console.error('Usage : node scripts/hash-set.mjs [--dry-run] <code de set> [autre code…]');
    process.exit(1);
  }
  if (!dryRun && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const db = dryRun ? null : new pg.Client({ connectionString: process.env.DATABASE_URL });
  if (db) await db.connect();

  try {
    for (const code of codes) await hashSet(db, code, dryRun);
  } finally {
    if (db) await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
