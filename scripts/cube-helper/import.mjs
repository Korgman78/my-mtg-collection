// Cube helper, étape 3 : réécrire en base ce que la session a produit.
//
// Par défaut, n'écrit RIEN : affiche ce qui serait fait. `--write` écrit.
//
//   - tags.json     → card_tags (jamais par-dessus une correction manuelle) ;
//   - proposal.json → une ligne cube_helper_runs, que l'app présentera ;
//   - avec `--apply-archetypes`, crée aussi les archétypes proposés dans le
//     cube, avec leurs cartes (utile tant que l'écran du helper n'existe
//     pas). Un archétype du même nom est mis à jour, pas dupliqué.
//
// Usage :
//   node --env-file=.env scripts/cube-helper/import.mjs --cube "Mon cube" [--write] [--apply-archetypes]
//
// Format de proposal.json :
//   {
//     "archetypes": [{
//       "name": "Golgari sacrifice", "colors": ["B","G"],
//       "plan": "…", "wants": ["sacrifice","graveyard"],
//       "key_cards": ["…"], "cards": ["…"]
//     }],
//     "suggestions": { "cuts": [{ "name", "why" }], "adds": [{ "name", "why" }] },
//     "notes": "…"
//   }

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

import { arg } from './common.mjs';
import { loadSession } from './pool.mjs';
import { THEMES, VOCAB_VERSION, validateTag } from './vocabulary.mjs';

const has = (flag) => process.argv.includes(`--${flag}`);
async function main() {
  const cubeName = arg('cube');
  if (!cubeName) throw new Error('--cube est obligatoire');
  const write = has('write');
  const applyArchetypes = has('apply-archetypes');
  const { dir, exp, local } = loadSession(cubeName);

  const errors = Object.entries(local).flatMap(([n, t]) => validateTag(n, t));
  const proposalFile = path.join(dir, 'proposal.json');
  const proposal = fs.existsSync(proposalFile) ? JSON.parse(fs.readFileSync(proposalFile, 'utf8')) : null;

  const known = new Map([...exp.cube_cards, ...exp.candidates].map((c) => [c.name, c]));
  const inCube = new Map(exp.cube_cards.map((c) => [c.name, c]));
  for (const a of proposal?.archetypes ?? []) {
    for (const c of a.colors) if (!'WUBRG'.includes(c)) errors.push(`${a.name} : couleur « ${c} »`);
    for (const w of a.wants ?? []) if (!(w in THEMES)) errors.push(`${a.name} : thème « ${w} »`);
    for (const n of [...(a.key_cards ?? []), ...(a.cards ?? [])]) {
      if (!known.has(n)) errors.push(`${a.name} : carte inconnue de l'export « ${n} »`);
    }
  }
  if (errors.length) throw new Error(`Rien n'est écrit, ${errors.length} erreur(s) :\n${errors.join('\n')}`);

  console.log(`Tags à écrire : ${Object.keys(local).length}`);
  if (proposal) {
    console.log(`Proposition : ${proposal.archetypes.length} archétypes`);
    for (const a of proposal.archetypes) {
      const outside = (a.cards ?? []).filter((n) => !inCube.has(n)).length;
      console.log(`  ${a.colors.join('')} ${a.name} — ${(a.cards ?? []).length} cartes (${outside} hors cube)`);
    }
  }
  if (!write) {
    console.log('\nSimulation : rien n’a été écrit. Relancer avec --write.');
    return;
  }

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query('begin');
  try {
    for (const [name, t] of Object.entries(local)) {
      await db.query(
        `insert into card_tags (name, themes, functions, power, note, vocab_version, source, updated_at)
         values ($1, $2, $3, $4, $5, $6, 'helper', now())
         on conflict (name) do update set
           themes = excluded.themes, functions = excluded.functions, power = excluded.power,
           note = excluded.note, vocab_version = excluded.vocab_version, updated_at = now()
         where card_tags.source <> 'manual'`,
        [name, JSON.stringify(t.themes ?? []), t.functions ?? [], t.power ?? null, t.note ?? null, VOCAB_VERSION]
      );
    }

    if (proposal) {
      await db.query('insert into cube_helper_runs (cube_id, payload) values ($1, $2)', [
        exp.cube.id,
        JSON.stringify(proposal),
      ]);
    }

    if (proposal && applyArchetypes) {
      for (const [i, a] of proposal.archetypes.entries()) {
        const existing = await db.query('select id from cube_archetypes where cube_id = $1 and name = $2', [
          exp.cube.id,
          a.name,
        ]);
        const id = existing.rows[0]?.id
          ? (
              await db.query(
                'update cube_archetypes set colors = $2, description = $3, position = $4 where id = $1 returning id',
                [existing.rows[0].id, a.colors, a.plan ?? null, i]
              )
            ).rows[0].id
          : (
              await db.query(
                `insert into cube_archetypes (cube_id, name, colors, description, position)
                 values ($1, $2, $3, $4, $5) returning id`,
                [exp.cube.id, a.name, a.colors, a.plan ?? null, i]
              )
            ).rows[0].id;
        // Seules les cartes DANS le cube peuvent être rangées : les autres
        // sont des suggestions d'ajout, elles restent dans la proposition.
        await db.query('delete from cube_archetype_cards where archetype_id = $1', [id]);
        const keys = new Set(a.key_cards ?? []);
        for (const n of new Set([...(a.cards ?? []), ...keys])) {
          const card = inCube.get(n);
          if (!card) continue;
          await db.query(
            'insert into cube_archetype_cards (archetype_id, cube_card_id, is_key) values ($1, $2, $3)',
            [id, card.cube_card_id, keys.has(n)]
          );
        }
      }
    }
    await db.query('commit');
    // Les tags sont en base : le fichier local n'a plus de raison d'exister,
    // et le garder ferait croire à un prochain export qu'ils sont en attente.
    if (fs.existsSync(path.join(dir, 'tags.json'))) {
      fs.renameSync(path.join(dir, 'tags.json'), path.join(dir, `tags-imported-${Date.now()}.json`));
    }
    console.log('Écrit.');
  } catch (err) {
    await db.query('rollback');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
