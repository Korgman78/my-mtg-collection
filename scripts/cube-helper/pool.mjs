// Cube helper, étape 2 bis : assembler le pool tagué, localement.
//
// Fusionne export.json (tags déjà en base) et tags.json (tags de la session
// en cours, pas encore importés), vérifie le vocabulaire, et écrit :
//   pool.txt     — une ligne par carte, avec ses tags : c'est la matière
//                  de la proposition d'archétypes ;
//   themes.txt   — par paire de couleurs et par thème, moteurs et
//                  récompenses disponibles, dans le cube et hors du cube.
// Aucun accès réseau ni base : se relance à volonté pendant le tagging.
//
// Usage : node scripts/cube-helper/pool.mjs --cube "Mon cube"

import fs from 'node:fs';
import path from 'node:path';

import { arg, slugify } from './common.mjs';
import { THEMES, validateTag } from './vocabulary.mjs';

export function loadSession(cubeName) {
  const dir = path.join('.cube-helper', slugify(cubeName));
  const exp = JSON.parse(fs.readFileSync(path.join(dir, 'export.json'), 'utf8'));
  const localFile = path.join(dir, 'tags.json');
  const local = fs.existsSync(localFile) ? JSON.parse(fs.readFileSync(localFile, 'utf8')) : {};
  // Une correction manuelle en base prime sur tout ; sinon le tag de la
  // session en cours prime sur l'ancien tag du helper.
  const tags = { ...exp.known_tags };
  for (const [name, t] of Object.entries(local)) {
    if (tags[name]?.source !== 'manual') tags[name] = t;
  }
  return { dir, exp, tags, local };
}

const PAIRS = ['WU', 'UB', 'BR', 'RG', 'GW', 'WB', 'UR', 'BG', 'RW', 'GU'];
const fits = (colors, pair) => colors.every((c) => pair.includes(c));

function main() {
  const cubeName = arg('cube');
  if (!cubeName) throw new Error('--cube est obligatoire');
  const { dir, exp, tags, local } = loadSession(cubeName);

  const errors = Object.entries(local).flatMap(([n, t]) => validateTag(n, t));
  if (errors.length) {
    console.error(`${errors.length} erreur(s) de vocabulaire dans tags.json :\n${errors.join('\n')}`);
    process.exitCode = 1;
  }

  const cards = [
    ...exp.cube_cards.map((c) => ({ ...c, where: c.locked ? 'IN*' : 'IN' })),
    ...exp.candidates.map((c) => ({ ...c, where: `CAND×${c.quantity}` })),
  ];
  const fmtTags = (t) =>
    t
      ? [
          `P${t.power ?? '?'}`,
          t.themes.map((x) => `${x.theme}:${x.role === 'enabler' ? 'E' : 'P'}`).join(',') || '-',
          t.functions.join(',') || '-',
        ].join(' | ')
      : 'NON TAGUÉE';

  const lines = cards.map(
    (c) =>
      `[${c.where}] ${c.name} | ${c.colors.join('') || 'C'} | ${c.cmc} | ${(c.type_line ?? '').split(' — ')[0]} | ${fmtTags(tags[c.name])}`
  );
  fs.writeFileSync(path.join(dir, 'pool.txt'), lines.join('\n') + '\n');

  // Offre par paire × thème : combien de moteurs et de récompenses jouables
  // dans la paire (cartes mono ou bicolores de la paire, et incolores).
  const out = [];
  for (const pair of PAIRS) {
    const inPair = cards.filter((c) => !(c.type_line ?? '').includes('Land') && fits(c.colors, pair));
    const rows = [];
    for (const theme of Object.keys(THEMES)) {
      const count = (where, role) =>
        inPair.filter(
          (c) =>
            c.where.startsWith(where) && tags[c.name]?.themes.some((x) => x.theme === theme && x.role === role)
        ).length;
      const [ie, ip, ce, cp] = [count('IN', 'enabler'), count('IN', 'payoff'), count('CAND', 'enabler'), count('CAND', 'payoff')];
      if (ie + ip + ce + cp >= 3) rows.push(`  ${theme.padEnd(13)} cube ${ie}E/${ip}P   collection +${ce}E/+${cp}P`);
    }
    out.push(`${pair} (${inPair.filter((c) => c.where.startsWith('IN')).length} cartes jouables dans le cube)`, ...rows);
  }
  fs.writeFileSync(path.join(dir, 'themes.txt'), out.join('\n') + '\n');

  const untagged = cards.filter((c) => !tags[c.name]).length;
  console.log(`${cards.length} cartes · ${cards.length - untagged} taguées · ${untagged} restantes`);
  console.log(`→ ${path.join(dir, 'pool.txt')} et themes.txt`);
}

if (path.basename(process.argv[1] ?? '') === 'pool.mjs') main();
