// Cube helper, étape 1 : exporter un cube et ses candidats pour la session
// Claude Code qui va les taguer et proposer des archétypes.
//
// Lecture seule en base, À UNE EXCEPTION près : le statut peasant, calculé
// ici à partir de toutes les impressions, est réécrit dans `cards` s'il y
// manquait (c'est une donnée publique de Scryfall, pas une décision).
//
// Candidats = cartes des dossiers « collection » de l'utilisateur, absentes
// du cube, jouables en peasant, hors terrains de base. La collection peut en
// compter des milliers : seuls les `--top` premiers (par rang EDHREC, faute
// de mieux comme mesure gratuite de « carte jouée ») partent au tagging.
//
// Usage :
//   node --env-file=.env scripts/cube-helper/export.mjs --cube "Mon cube" [--top 600]
//
// Écrit dans .cube-helper/<cube>/ :
//   export.json  — tout : cube, candidats, tags connus, archétypes existants
//   to-tag.txt   — les cartes à taguer, une par ligne, format compact

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createInterface } from 'node:readline';
import pg from 'pg';

import { arg, slugify } from './common.mjs';

const HEADERS = { 'User-Agent': 'my-mtg-collection/0.1 (cube helper)', Accept: 'application/json' };

/** Le bulk Scryfall de toutes les impressions, mis en cache par génération :
 *  relancer l'export dans la journée ne retélécharge pas 80 Mo. */
export async function bulkPath() {
  const index = await (await fetch('https://api.scryfall.com/bulk-data', { headers: HEADERS })).json();
  const bulk = index.data.find((d) => d.type === 'default_cards');
  const stamp = bulk.updated_at.slice(0, 19).replace(/[^0-9]/g, '');
  const file = path.join('.cube-helper', `default-cards-${stamp}.jsonl.gz`);
  if (fs.existsSync(file)) return file;

  for (const old of fs.readdirSync('.cube-helper').filter((f) => f.startsWith('default-cards-'))) {
    fs.rmSync(path.join('.cube-helper', old));
  }
  console.log(`Téléchargement du bulk Scryfall (${Math.round(bulk.compressed_size / 1e6)} Mo)…`);
  const res = await fetch(bulk.jsonl_download_uri, { headers: HEADERS });
  if (!res.ok) throw new Error(`Bulk : ${res.status}`);
  await fs.promises.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/** Un passage sur toutes les impressions papier : l'ensemble des oracles
 *  peasant, et la fiche complète des impressions qui nous intéressent. */
export async function scanBulk(file, wantedIds) {
  const peasant = new Set();
  const byId = new Map();
  const stream = createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of stream) {
    if (!line) continue;
    const c = JSON.parse(line);
    if (!c.games?.includes('paper')) continue;
    if (c.oracle_id && (c.rarity === 'common' || c.rarity === 'uncommon')) peasant.add(c.oracle_id);
    if (wantedIds.has(c.id)) byId.set(c.id, c);
  }
  return { peasant, byId };
}

/** Ligne compacte d'une carte pour le tagging : tout ce qui sert à juger
 *  son rôle, rien de plus. */
export function tagLine(card) {
  const faces = card.card_faces ?? [card];
  const face = (f) => {
    const pt = f.power != null ? ` ${f.power}/${f.toughness}` : '';
    const text = (f.oracle_text ?? '').replace(/\n/g, ' ¶ ');
    return `${f.mana_cost ?? ''} | ${f.type_line ?? ''}${pt} | ${text}`;
  };
  return `${card.name} | ${faces.map(face).join(' // ')}`;
}

async function main() {
  const cubeArg = arg('cube');
  const top = Number(arg('top', '600'));
  if (!cubeArg) throw new Error('--cube "<nom ou id>" est obligatoire');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL absent (lancer avec --env-file=.env)');

  fs.mkdirSync('.cube-helper', { recursive: true });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const q = async (sql, params) => (await db.query(sql, params)).rows;

  const cubes = await q('select * from cubes where id::text = $1 or lower(name) = lower($1)', [cubeArg]);
  if (cubes.length !== 1) {
    const all = await q('select name from cubes order by created_at');
    throw new Error(`Cube « ${cubeArg} » introuvable ou ambigu. Cubes : ${all.map((c) => c.name).join(', ')}`);
  }
  const cube = cubes[0];
  const hasColumn = async (table, column) =>
    (
      await q(
        `select 1 from information_schema.columns where table_schema='public' and table_name=$1 and column_name=$2`,
        [table, column]
      )
    ).length > 0;
  const helperMigrated = await hasColumn('cube_cards', 'locked');
  if (!helperMigrated) console.warn('⚠ Migration du helper absente : ni verrous, ni tags, ni peasant en base.');

  const inCube = await q(
    `select cc.id as cube_card_id, ${helperMigrated ? 'cc.locked' : 'false as locked'}, c.id, c.name
       from cube_cards cc join cards c on c.id = cc.card_id where cc.cube_id = $1`,
    [cube.id]
  );
  const owned = await q(
    `select c.id, c.name, sum(ci.quantity)::int as quantity
       from collection_items ci
       join folders f on f.id = ci.folder_id
       join cards c on c.id = ci.card_id
      where f.user_id = $1 and f.kind = 'collection'
      group by c.id, c.name`,
    [cube.user_id]
  );

  const cubeNames = new Set(inCube.map((c) => c.name));
  const wanted = new Set([...inCube.map((c) => c.id), ...owned.map((c) => c.id)]);
  const { peasant, byId } = await scanBulk(await bulkPath(), wanted);

  if (helperMigrated) {
    const ids = [...wanted].filter((id) => byId.get(id)?.oracle_id);
    const peasantIds = ids.filter((id) => peasant.has(byId.get(id).oracle_id));
    await db.query('update cards set peasant = (id = any($1::uuid[])) where id = any($2::uuid[])', [peasantIds, ids]);
  }

  const isPeasant = (id) => {
    const c = byId.get(id);
    return c?.oracle_id ? peasant.has(c.oracle_id) : null;
  };

  // Une entrée par NOM : plusieurs impressions possédées = une candidate.
  const candidates = new Map();
  for (const o of owned) {
    const c = byId.get(o.id);
    if (!c || cubeNames.has(o.name)) continue;
    if ((c.type_line ?? '').startsWith('Basic')) continue;
    if (isPeasant(o.id) === false) continue;
    const prev = candidates.get(o.name);
    if (prev) prev.quantity += o.quantity;
    else candidates.set(o.name, { id: o.id, name: o.name, quantity: o.quantity, rank: c.edhrec_rank ?? 1e9 });
  }
  const ranked = [...candidates.values()].sort((a, b) => a.rank - b.rank);

  const allNames = [...cubeNames, ...candidates.keys()];
  const tags = helperMigrated
    ? Object.fromEntries(
        (await q('select * from card_tags where name = any($1)', [allNames])).map((t) => [t.name, t])
      )
    : {};
  const archetypes = await q('select * from cube_archetypes where cube_id = $1 order by position', [cube.id]);
  await db.end();

  const describe = (id, extra) => {
    const c = byId.get(id);
    const faces = c.card_faces ?? [];
    return {
      id,
      name: c.name,
      mana_cost: c.mana_cost ?? faces[0]?.mana_cost ?? null,
      cmc: c.cmc,
      colors: c.colors ?? [...new Set(faces.flatMap((f) => f.colors ?? []))],
      color_identity: c.color_identity,
      type_line: c.type_line,
      produced_mana: c.produced_mana ?? null,
      edhrec_rank: c.edhrec_rank ?? null,
      peasant: isPeasant(id),
      ...extra,
    };
  };

  const cubeCards = inCube
    .filter((c) => byId.has(c.id))
    .map((c) => describe(c.id, { cube_card_id: c.cube_card_id, locked: c.locked }));
  const selected = ranked.slice(0, top);
  const candidateCards = selected.map((c) => describe(c.id, { quantity: c.quantity }));

  const dir = path.join('.cube-helper', slugify(cube.name));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'export.json'),
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        cube: { id: cube.id, name: cube.name, target_size: cube.target_size, description: cube.description },
        cube_cards: cubeCards,
        candidates: candidateCards,
        candidates_left_out: ranked.length - selected.length,
        known_tags: tags,
        archetypes,
      },
      null,
      1
    )
  );

  // Les tags d'une session interrompue, pas encore importés, comptent aussi.
  const localFile = path.join(dir, 'tags.json');
  const pending = fs.existsSync(localFile) ? JSON.parse(fs.readFileSync(localFile, 'utf8')) : {};
  const untagged = [...cubeCards, ...candidateCards].filter((c) => !tags[c.name] && !pending[c.name]);
  fs.writeFileSync(
    path.join(dir, 'to-tag.txt'),
    untagged.map((c) => tagLine(byId.get(c.id))).join('\n') + '\n'
  );

  const notPeasant = cubeCards.filter((c) => c.peasant === false);
  console.log(`Cube « ${cube.name} » : ${cubeCards.length} cartes (${cubeCards.filter((c) => c.locked).length} verrouillées)`);
  console.log(`Candidats peasant dans la collection : ${ranked.length}, exportés : ${selected.length}`);
  console.log(`Déjà tagués : ${allNames.filter((n) => tags[n]).length} · à taguer : ${untagged.length}`);
  if (notPeasant.length) {
    console.log(`⚠ Non peasant dans le cube (${notPeasant.length}) : ${notPeasant.map((c) => c.name).join(', ')}`);
  }
  console.log(`→ ${dir}`);
}

if (path.basename(process.argv[1] ?? '') === 'export.mjs') main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
