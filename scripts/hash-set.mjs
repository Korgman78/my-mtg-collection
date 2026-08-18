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
// Le job est REPRENABLE : les cartes déjà indexées sont sautées. On peut
// donc l'interrompre, le relancer, ou le reprendre depuis une autre machine
// — la référence vit dans Supabase, pas en local.
//
// Usage :
//   DATABASE_URL=... node scripts/hash-set.mjs otj mh3      un ou plusieurs sets
//   DATABASE_URL=... node scripts/hash-set.mjs --main-sets  les sets principaux récents
//   DATABASE_URL=... node scripts/hash-set.mjs --main-sets --since 2020-01-01
//   node scripts/hash-set.mjs --dry-run otj                 n'écrit rien
//   node scripts/hash-set.mjs --main-sets --list            affiche la liste et sort

import jpeg from 'jpeg-js';
import pg from 'pg';

import { phashPair } from '../mobile/src/lib/phash.ts';

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

/** Ce qu'on entend par « set principal » : les sorties qu'on drafte ou
 *  qu'on ouvre en booster. Sont exclus d'office les jetons, les promos, les
 *  memorabilia, les masterpieces — et Secret Lair, qui est de type `box`. */
const MAIN_SET_TYPES = ['expansion', 'core', 'masters', 'draft_innovation'];

/** Les précons Commander, ajoutées par `--with-commander`. Elles méritent
 *  d'être indexées : ce sont des cartes qu'on possède très souvent, et
 *  certaines réimpressions n'existent nulle part ailleurs. */
const COMMANDER_SET_TYPE = 'commander';

/** Les codes des sets retenus, sortis depuis une date donnée. */
async function mainSetCodes(since, types) {
  const all = await fetchJson('https://api.scryfall.com/sets');
  const today = new Date().toISOString().slice(0, 10);
  const wanted = new Set(types);

  return all.data
    .filter(
      (s) =>
        !s.digital &&
        wanted.has(s.set_type) &&
        s.released_at &&
        s.released_at >= since &&
        s.released_at <= today
    )
    .sort((a, b) => a.released_at.localeCompare(b.released_at))
    .map((s) => ({
      code: s.code,
      name: s.name,
      count: s.card_count,
      date: s.released_at,
      type: s.set_type,
    }));
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
  // Deux empreintes : la carte entière et sa seule illustration. C'est la
  // seconde qui porte la reconnaissance — voir la migration art_hashes.
  return phashPair(data, width, height);
}

/** Vérifie que la cible existe AVANT de télécharger quoi que ce soit.
 *
 *  Sans ce contrôle, un set standard se télécharge pendant douze minutes
 *  pour échouer à la première écriture si la migration n'a pas été appliquée.
 *  Échouer en deux secondes coûte infiniment moins cher. */
async function preflight(db) {
  const { rows } = await db.query(
    `select to_regclass('public.card_hashes') as hashes,
            to_regclass('public.hashed_sets') as sets`
  );
  if (!rows[0].hashes || !rows[0].sets) {
    throw new Error(
      'Les tables du scanner sont absentes. Applique d’abord la migration ' +
        'supabase/migrations/20260818120000_card_hashes.sql, puis relance.'
    );
  }
}

async function hashSet(db, setCode, dryRun) {
  const set = await fetchJson(`https://api.scryfall.com/sets/${setCode}`);
  console.log(`\n${set.code.toUpperCase()} — ${set.name} (${set.card_count} cartes annoncées)`);

  const all = await fetchSetPrintings(set.code);

  // Reprise : ce qui est déjà en base ne se re-télécharge pas. C'est ce qui
  // rend le job interruptible, et une relance après ajout d'un set coûte
  // quelques secondes au lieu de tout recommencer.
  //
  // On ne considère « fait » qu'une ligne qui porte AUSSI l'empreinte de
  // l'illustration : les lignes d'avant ce changement doivent être refaites.
  let done = new Set();
  if (db) {
    const { rows: existing } = await db.query(
      'select card_id from card_hashes where set_code = $1 and art_phash is not null',
      [set.code]
    );
    done = new Set(existing.map((r) => r.card_id));
  }
  const cards = all.filter((c) => !done.has(c.id));

  if (done.size > 0) {
    console.log(`  ${all.length} impressions, ${done.size} déjà indexées → ${cards.length} à faire`);
  } else {
    console.log(`  ${cards.length} impressions papier à hacher`);
  }
  if (cards.length === 0) {
    console.log('  rien à faire.');
    return;
  }

  const rows = [];
  let skipped = 0;

  for (const [i, card] of cards.entries()) {
    try {
      const hashes = await hashCardImage(card);
      if (!hashes) {
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
          hashes.whole,
          hashes.art,
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
  // Le contrôle porte sur l'illustration, celle qui décide désormais.
  const seen = new Map();
  let collisions = 0;
  for (const r of rows) {
    const key = r[9];
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
          `($${i * 10 + 1},$${i * 10 + 2},$${i * 10 + 3},$${i * 10 + 4},$${i * 10 + 5},$${i * 10 + 6},$${i * 10 + 7},$${i * 10 + 8},$${i * 10 + 9}::bit(64),$${i * 10 + 10}::bit(64))`
      )
      .join(',');
    await db.query(
      `insert into card_hashes
         (card_id, set_code, name, collector_number, rarity, image_small, image_normal, released_at, phash, art_phash)
       values ${values}
       on conflict (card_id) do update set
         phash = excluded.phash,
         art_phash = excluded.art_phash,
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

/** Deux ans en arrière, par défaut. */
function twoYearsAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d.toISOString().slice(0, 10);
}

function flagValue(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const listOnly = args.includes('--list');
  const since = flagValue(args, '--since', twoYearsAgo());

  let codes = args
    .filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--since')
    .map((c) => c.toLowerCase());

  if (args.includes('--main-sets')) {
    const types = [...MAIN_SET_TYPES];
    if (args.includes('--with-commander')) types.push(COMMANDER_SET_TYPE);

    const sets = await mainSetCodes(since, types);
    console.log(`Sets depuis ${since} (${types.join(', ')}) :\n`);
    let total = 0;
    for (const s of sets) {
      total += s.count;
      const tag = s.type === COMMANDER_SET_TYPE ? ' [commander]' : '';
      console.log(
        `  ${s.date}  ${s.code.toUpperCase().padEnd(5)} ${String(s.count).padStart(4)}  ${s.name}${tag}`
      );
    }
    // 0,21 s par carte, mesuré. Autant l'annoncer avant, pas après.
    console.log(`\n${sets.length} sets, ${total} cartes, ~${Math.round((total * 0.21) / 60)} min.\n`);
    codes = [...new Set([...codes, ...sets.map((s) => s.code)])];
  }

  if (listOnly) return;

  if (codes.length === 0) {
    console.error(
      'Usage : node scripts/hash-set.mjs [--dry-run] [--main-sets [--since AAAA-MM-JJ]] [codes…]'
    );
    process.exit(1);
  }
  if (!dryRun && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

  const db = dryRun ? null : new pg.Client({ connectionString: process.env.DATABASE_URL });
  if (db) {
    await db.connect();
    await preflight(db);
  }

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
