// Précision géométrique de la détection de carte, contre une vérité connue.
//
// Les autres bancs d'essai mesurent la RECONNAISSANCE : ils disent qu'un
// scan échoue, jamais pourquoi. Celui-ci mesure ce qui la conditionne — à
// quelle distance des vrais bords `detectCard` place les siens — en
// compositant une vraie image Scryfall sur un fond de table, à une position
// et une rotation qu'on choisit. Les quatre coins sont donc connus au pixel
// près, ce qu'aucune photo réelle ne peut offrir.
//
// Ce que ça a servi à établir, le 2026-09-02 :
//
//   La détection ne délimite pas la carte, elle délimite son INTÉRIEUR
//   IMPRIMÉ. La composante connexe couvre 34 à 38 % de la photo là où la
//   carte en occupe 80 %, et la largeur trouvée vaut ~10 % de moins que la
//   vraie, sur les quatre sets essayés et quel que soit le cadrage. L'écart
//   se concentre en bas : haut, gauche et droite tombent à quelques pixels
//   du vrai bord, le bord bas peut en manquer 150.
//
//   C'est logique après coup : le masque vient du gradient, donc il voit ce
//   qui porte du détail. Une carte commence par une marge et une bordure
//   unies, et se termine par un bloc de texte puis une ligne de collection.
//   Rien de tout ça n'allume un Sobel flouté.
//
// Conséquence pour qui reprendra le sujet : tant que le masque s'arrête au
// cadre imprimé, raffiner le choix des coins ne peut rien rapporter. C'est le
// masque qu'il faut corriger, pas la géométrie qu'on en tire.
//
// Attention, la mesure est exigeante à dessein : elle compare à la carte
// ENTIÈRE, bordure comprise, parce que c'est ce cadrage-là que le hachage de
// référence suppose (les images Scryfall sont rognées au bord de la carte).
//
// Usage : node scripts/detect-precision.mjs [sets…]

import jpeg from 'jpeg-js';

import { detectCard } from '../mobile/src/lib/card-detect.ts';

const HEADERS = { 'User-Agent': 'my-mtg-collection/0.1 (detect precision)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Des cadres volontairement variés : le contraste entre la bordure et la
 *  table change beaucoup d'un set à l'autre, et c'est justement ce qui
 *  distingue une correction robuste d'une correction calée sur un cas. */
const DEFAULT_SETS = ['fin', 'otj', 'mh3', 'blb'];

/** Trois cadrages, du soigné au négligé, comme dans phash-eval-next. */
const CASES = [
  ['cadrage soigné', { pad: 0.06, deg: 0 }],
  ['photo ordinaire', { pad: 0.14, deg: 3, shiftX: 0.02, shiftY: -0.02 }],
  ['photo négligée', { pad: 0.24, deg: 7, shiftX: 0.05, shiftY: -0.04 }],
];

/** La première carte illustrée d'un set, en image `normal`. */
async function cardImage(setCode) {
  const q = encodeURIComponent(`set:${setCode} game:paper`);
  const page = await (
    await fetch(`https://api.scryfall.com/cards/search?q=${q}&unique=cards&order=set`, {
      headers: { ...HEADERS, Accept: 'application/json' },
    })
  ).json();
  const card = (page.data ?? []).find((c) => (c.image_uris ?? {}).normal);
  if (!card) throw new Error(`Aucune carte illustrée pour « ${setCode} ».`);

  const res = await fetch(card.image_uris.normal, { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall a répondu ${res.status} pour l'image.`);
  const image = jpeg.decode(Buffer.from(await res.arrayBuffer()), { useTArray: true });
  return { name: card.name, ...image };
}

/**
 * La carte posée sur une table, tournée, décentrée, avec du fond autour.
 *
 * Cartographie inverse : pour chaque pixel de la photo on remonte dans le
 * repère de la carte. C'est ce qui permet de connaître les quatre coins
 * exactement, au lieu de les déduire d'une transformation approchée.
 */
function place(card, { pad, deg = 0, shiftX = 0, shiftY = 0 }) {
  const width = Math.round(card.width * (1 + pad * 2));
  const height = Math.round(card.height * (1 + pad * 2));
  const data = new Uint8ClampedArray(width * height * 4);

  let seed = 13;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < data.length; i += 4) {
    // Un gris de table légèrement bruité : un fond parfaitement uni
    // rendrait la détection plus facile qu'elle ne l'est jamais.
    const v = 96 + (rnd() - 0.5) * 12;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }

  const cx = width / 2 + card.width * shiftX;
  const cy = height / 2 + card.height * shiftY;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const sx = dx * cos + dy * sin + card.width / 2;
      const sy = -dx * sin + dy * cos + card.height / 2;
      if (sx < 0 || sy < 0 || sx >= card.width || sy >= card.height) continue;
      const s = (Math.floor(sy) * card.width + Math.floor(sx)) * 4;
      const d = (y * width + x) * 4;
      data[d] = card.data[s];
      data[d + 1] = card.data[s + 1];
      data[d + 2] = card.data[s + 2];
    }
  }

  const corner = (ox, oy) => ({ x: cx + ox * cos - oy * sin, y: cy + ox * sin + oy * cos });
  const hw = card.width / 2;
  const hh = card.height / 2;

  return {
    photo: { data, width, height },
    truth: [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)],
  };
}

/** Largeur et hauteur moyennes d'un quadrilatère. */
function size(quad) {
  return {
    w:
      (Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y) +
        Math.hypot(quad[2].x - quad[3].x, quad[2].y - quad[3].y)) /
      2,
    h:
      (Math.hypot(quad[3].x - quad[0].x, quad[3].y - quad[0].y) +
        Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y)) /
      2,
  };
}

const CORNERS = ['haut-gauche', 'haut-droit', 'bas-droit', 'bas-gauche'];

async function main() {
  const sets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_SETS;

  const cards = [];
  for (const code of sets) {
    cards.push([code, await cardImage(code)]);
    await sleep(150);
  }

  console.log(
    '\n' +
      'situation'.padEnd(18) +
      'set'.padStart(6) +
      'couverture'.padStart(12) +
      'écart max'.padStart(11) +
      'écart moy.'.padStart(12) +
      'largeur'.padStart(16)
  );
  console.log('-'.repeat(75));

  let worst = 0;
  let biasSum = 0;
  let count = 0;
  // Écart moyen par coin : c'est lui qui a montré que le défaut est en bas,
  // et non réparti comme le serait une imprécision d'ensemble.
  const perCorner = [0, 0, 0, 0];

  for (const [label, params] of CASES) {
    for (const [code, card] of cards) {
      const { photo, truth } = place(card, params);
      const found = detectCard(photo.data, photo.width, photo.height);

      if (!found) {
        console.log(label.padEnd(18) + code.toUpperCase().padStart(6) + 'NON DÉTECTÉE'.padStart(12));
        continue;
      }

      let max = 0;
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        const d = Math.hypot(found.quad[i].x - truth[i].x, found.quad[i].y - truth[i].y);
        max = Math.max(max, d);
        sum += d;
        perCorner[i] += d;
      }

      const real = size(truth);
      const got = size(found.quad);
      worst = Math.max(worst, max);
      biasSum += (got.w - real.w) / real.w;
      count++;

      console.log(
        label.padEnd(18) +
          code.toUpperCase().padStart(6) +
          `${(found.coverage * 100).toFixed(0)} %`.padStart(12) +
          max.toFixed(1).padStart(11) +
          (sum / 4).toFixed(1).padStart(12) +
          `${real.w.toFixed(0)} → ${got.w.toFixed(0)}`.padStart(16)
      );
    }
  }

  if (count === 0) return;

  console.log('\nÉcart moyen par coin :');
  for (let i = 0; i < 4; i++) {
    console.log(`  ${CORNERS[i].padEnd(13)} ${(perCorner[i] / count).toFixed(1)} px`);
  }
  console.log(
    `\nPire écart de coin : ${worst.toFixed(1)} px. ` +
      `Biais de largeur moyen : ${((biasSum / count) * 100).toFixed(1)} %.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
