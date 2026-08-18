// Contrôle du scanner contre la VRAIE base.
//
// Les bancs d'essai (phash-eval, scan-e2e) valident l'algorithme hors ligne.
// Celui-ci valide ce qu'aucun d'eux ne touche : la fonction SQL déployée —
// le cast en `bit(64)`, le `unnest` du lot de hachages, le `bit_count`, le
// seuil et l'ordre de classement.
//
// Il tire quelques cartes au hasard parmi celles déjà indexées, fabrique une
// « photo » à partir de leur illustration, rejoue le pipeline de l'app, et
// interroge `match_card_hashes` comme le ferait le téléphone.
//
// À lancer en premier le jour où le scanner ne reconnaît plus rien : il dit
// tout de suite si le problème vient de la base ou de l'appareil.
//
// Usage : node --env-file=.env scripts/scan-smoke.mjs [set] [nb cartes]

import jpeg from 'jpeg-js';
import pg from 'pg';

import { frameRect } from '../mobile/src/lib/card-frame.ts';
import { phashWindows } from '../mobile/src/lib/phash.ts';

const UA = { 'User-Agent': 'my-mtg-collection/0.1 (scanner smoke test)' };

async function getRgba(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return jpeg.decode(Buffer.from(await res.arrayBuffer()), { useTArray: true });
}

/** Une photo plausible : la carte ne remplit pas le cadre, la lumière n'est
 *  pas celle du studio Scryfall, et le capteur bruite. */
function fakePhoto({ data, width, height }, { margin = 0.12, gain = 0.85, noise = 14 } = {}) {
  const w = Math.round(width * (1 + margin * 2));
  const h = Math.round(height * (1 + margin * 2));
  const out = new Uint8ClampedArray(w * h * 4);

  let seed = 19;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  for (let i = 0; i < out.length; i += 4) {
    const v = 95 + (rnd() - 0.5) * 12;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }

  const ox = Math.round((w - width) / 2);
  const oy = Math.round((h - height) / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = ((y + oy) * w + (x + ox)) * 4;
      out[d] = data[s] * gain + (rnd() - 0.5) * noise;
      out[d + 1] = data[s + 1] * gain + (rnd() - 0.5) * noise;
      out[d + 2] = data[s + 2] * gain + (rnd() - 0.5) * noise;
    }
  }
  return { data: out, width: w, height: h };
}

/** Découpe du cadre, comme ImageManipulator.crop() côté app. */
function cropToFrame({ data, width, height }) {
  const r = frameRect(width, height);
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const s = ((y + r.originY) * width + (x + r.originX)) * 4;
      const d = (y * r.width + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: r.width, height: r.height };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const setCode = process.argv[2] ?? null;
  const sample = Number(process.argv[3] ?? 6);

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  try {
    const { rows: cards } = await db.query(
      `select card_id, name, set_code, collector_number, image_normal
         from card_hashes
        where image_normal is not null
          and ($1::text is null or set_code = $1)
        order by random()
        limit $2`,
      [setCode, sample]
    );

    if (cards.length === 0) {
      console.log('Aucune carte indexée pour ce critère. Lance d’abord hash-set.mjs.');
      return;
    }

    const { rows: total } = await db.query('select count(*)::int n from card_hashes');
    console.log(`Référence : ${total[0].n} empreintes. Test sur ${cards.length} cartes tirées au hasard.\n`);

    let ok = 0;
    for (const card of cards) {
      const original = await getRgba(card.image_normal);
      const photo = cropToFrame(fakePhoto(original));
      const hashes = phashWindows(photo.data, photo.width, photo.height);

      const { rows: matches } = await db.query(
        'select name, set_code, collector_number, distance, whole_distance ' +
          'from match_card_hashes($1::text[], $2::text[], 18, 3)',
        [hashes.whole, hashes.art]
      );

      const best = matches[0];
      const hit = best && best.name === card.name && best.set_code === card.set_code;
      if (hit) ok++;

      const runnerUp = matches[1] ? `, 2e à ${matches[1].distance}` : '';
      console.log(
        `${hit ? 'ok  ' : 'RATÉ'}  ${card.name.slice(0, 32).padEnd(32)} ` +
          (best
            ? `→ ${best.name.slice(0, 28).padEnd(28)} illustr. ${String(best.distance).padStart(2)}` +
              ` (carte ${String(best.whole_distance ?? '-').padStart(2)})${runnerUp}`
            : '→ aucun candidat')
      );
      await new Promise((r) => setTimeout(r, 120));
    }

    console.log(`\n${ok}/${cards.length} reconnues.`);
    process.exitCode = ok === cards.length ? 0 : 1;
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
