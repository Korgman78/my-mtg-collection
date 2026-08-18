// Pourquoi le scanner échoue sur de vraies photos, et que faire.
//
// Constat de terrain : sur l'appareil, TOUS les candidats reviennent entre
// 10 et 14 bits, alors que deux cartes différentes sont normalement à ~23.
// L'empreinte de la photo tombe donc à égale distance de tout : elle a perdu
// ce qui distingue une carte d'une autre.
//
// Hypothèse : on hache la carte ENTIÈRE. Or toutes les cartes Magic
// partagent la même charpente — bordure, bandeau de titre, cadre
// d'illustration, bloc de texte, bandeau bas. À 32×32, cette charpente
// commune occupe l'essentiel des basses fréquences, et l'illustration, seule
// partie réellement distinctive, ne pèse presque rien. Sur une image Scryfall
// parfaite ça suffit ; sur une photo tenue à la main, la dégradation noie le
// peu de signal utile.
//
// Ce script compare donc deux stratégies sur des photos simulées AVEC les
// dégradations qui manquaient jusqu'ici : inclinaison (perspective), reflet,
// dominante de couleur, flou, bruit.
//
//   « carte »  — l'empreinte actuelle, sur toute la carte
//   « illustration » — l'empreinte de la seule fenêtre d'illustration
//   « combiné » — la meilleure des deux
//
// Usage : node scripts/phash-eval-art.mjs [set] [nb cartes]

import jpeg from 'jpeg-js';

import { gray32FromRegion, hamming, phashFromGray32 } from '../mobile/src/lib/phash.ts';

const HEADERS = { 'User-Agent': 'my-mtg-collection/0.1 (art eval)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getRgba(url) {
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return jpeg.decode(Buffer.from(await res.arrayBuffer()), { useTArray: true });
}

/** Fenêtre d'illustration d'une carte au cadre moderne, en fractions.
 *  Mesurée sur le gabarit standard : l'illustration occupe la bande haute,
 *  sous le bandeau de titre et au-dessus du type. */
const ART = { x: 0.075, y: 0.115, w: 0.85, h: 0.42 };

function hashWhole({ data, width, height }) {
  return phashFromGray32(gray32FromRegion(data, width, 0, 0, width, height));
}

function hashArt({ data, width, height }) {
  return phashFromGray32(
    gray32FromRegion(
      data,
      width,
      Math.round(width * ART.x),
      Math.round(height * ART.y),
      Math.round(width * ART.w),
      Math.round(height * ART.h)
    )
  );
}

/* --- Dégradations d'une vraie prise de vue ------------------------------- */

/** Inclinaison : la carte n'est jamais parfaitement parallèle au capteur.
 *  Homographie appliquée en cartographie inverse, avec les quatre coins de
 *  la carte déplacés. */
function tilt({ data, width, height }, amount) {
  // Coins destination -> source. On rétrécit un bord, comme si la carte
  // penchait en arrière d'un côté.
  const dx = width * amount;
  const dy = height * amount * 0.5;
  const src = [
    [dx, 0],
    [width - 1, dy],
    [width - 1 - dx, height - 1],
    [0, height - 1 - dy],
  ];

  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);

      // Interpolation bilinéaire des quatre coins : suffisant pour simuler
      // une inclinaison douce sans sortir l'artillerie matricielle.
      const sx =
        (1 - u) * (1 - v) * src[0][0] + u * (1 - v) * src[1][0] + u * v * src[2][0] + (1 - u) * v * src[3][0];
      const sy =
        (1 - u) * (1 - v) * src[0][1] + u * (1 - v) * src[1][1] + u * v * src[2][1] + (1 - u) * v * src[3][1];

      const ix = Math.max(0, Math.min(width - 1, Math.round(sx)));
      const iy = Math.max(0, Math.min(height - 1, Math.round(sy)));
      const s = (iy * width + ix) * 4;
      const d = (y * width + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/** Reflet : une tache lumineuse diagonale, comme un plafonnier sur le vernis. */
function glare({ data, width, height }, strength) {
  const out = new Uint8ClampedArray(data.length);
  const cx = width * 0.35;
  const cy = height * 0.3;
  const radius = Math.max(width, height) * 0.45;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const dist = Math.hypot(x - cx, y - cy) / radius;
      const boost = Math.max(0, 1 - dist) ** 2 * strength * 255;
      out[o] = data[o] + boost;
      out[o + 1] = data[o + 1] + boost;
      out[o + 2] = data[o + 2] + boost;
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/** Dominante de couleur : lumière chaude d'intérieur. */
function colorCast({ data, width, height }, r, g, b) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    out[i] = data[i] * r;
    out[i + 1] = data[i + 1] * g;
    out[i + 2] = data[i + 2] * b;
    out[i + 3] = 255;
  }
  return { data: out, width, height };
}

function blur({ data, width, height }, radius) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
          const o = (yy * width + xx) * 4;
          r += data[o];
          g += data[o + 1];
          b += data[o + 2];
          n++;
        }
      }
      const d = (y * width + x) * 4;
      out[d] = r / n;
      out[d + 1] = g / n;
      out[d + 2] = b / n;
      out[d + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/** Erreur de cadrage : on garde un peu plus ou un peu moins que la carte. */
function reframe({ data, width, height }, fraction) {
  const dx = Math.round(width * fraction);
  const dy = Math.round(height * fraction);
  const w = width - dx * 2;
  const h = height - dy * 2;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + dy) * width + (x + dx)) * 4;
      const d = (y * w + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

const SCENARIOS = [
  ['scan parfait (temoin)', (i) => i],
  ['inclinaison 4 %', (i) => tilt(i, 0.04)],
  ['reflet', (i) => glare(i, 0.45)],
  ['lumiere chaude + flou', (i) => blur(colorCast(i, 1.15, 1.0, 0.8), 2)],
  ['cadrage a 3 % pres', (i) => reframe(i, 0.03)],
  ['photo a main levee', (i) => blur(glare(tilt(reframe(i, 0.025), 0.035), 0.35), 1)],
];

async function main() {
  const setCode = (process.argv[2] ?? 'fin').toLowerCase();
  const limit = Number(process.argv[3] ?? 40);

  const q = encodeURIComponent(`set:${setCode} game:paper`);
  const page = await (
    await fetch(
      `https://api.scryfall.com/cards/search?q=${q}&unique=prints&include_variations=true&order=set`,
      { headers: HEADERS }
    )
  ).json();
  const cards = (page.data ?? []).slice(0, limit);

  // Référence : petite image, comme le job de production.
  const reference = [];
  for (const card of cards) {
    const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? {};
    if (!uris.small || !uris.normal) continue;
    const img = await getRgba(uris.small);
    reference.push({ name: card.name, normal: uris.normal, whole: hashWhole(img), art: hashArt(img) });
    await sleep(110);
  }
  console.log(`Set ${setCode.toUpperCase()} — référence de ${reference.length} cartes\n`);

  // À quel point les cartes se distinguent-elles, selon la stratégie ?
  for (const key of ['whole', 'art']) {
    let sum = 0;
    let pairs = 0;
    let closest = 64;
    for (let i = 0; i < reference.length; i++) {
      for (let j = i + 1; j < reference.length; j++) {
        const d = hamming(reference[i][key], reference[j][key]);
        sum += d;
        pairs++;
        closest = Math.min(closest, d);
      }
    }
    console.log(
      `Écart entre cartes différentes — ${key === 'whole' ? 'carte entière' : 'illustration '} : ` +
        `moyenne ${(sum / pairs).toFixed(1)}, plus proche paire ${closest}`
    );
  }
  console.log('');

  const photos = [];
  for (const ref of reference) {
    photos.push({ ref, img: await getRgba(ref.normal) });
    await sleep(110);
  }

  console.log(
    'situation'.padEnd(26) +
      'carte'.padStart(9) +
      'illustr.'.padStart(10) +
      'combine'.padStart(9) +
      '  dist. carte / illustr.'
  );
  console.log('-'.repeat(78));

  for (const [label, degrade] of SCENARIOS) {
    let okWhole = 0;
    let okArt = 0;
    let okBoth = 0;
    let distWhole = 0;
    let distArt = 0;

    for (const { ref, img } of photos) {
      const photo = degrade(img);
      const qWhole = hashWhole(photo);
      const qArt = hashArt(photo);

      const rank = (queryHash, key) => {
        const dTrue = hamming(queryHash, ref[key]);
        let dWrong = 64;
        for (const o of reference) {
          if (o !== ref) dWrong = Math.min(dWrong, hamming(queryHash, o[key]));
        }
        return { dTrue, win: dTrue < dWrong };
      };

      const w = rank(qWhole, 'whole');
      const a = rank(qArt, 'art');
      if (w.win) okWhole++;
      if (a.win) okArt++;
      if (w.win || a.win) okBoth++;
      distWhole += w.dTrue;
      distArt += a.dTrue;
    }

    const n = photos.length;
    console.log(
      label.padEnd(26) +
        `${okWhole}/${n}`.padStart(9) +
        `${okArt}/${n}`.padStart(10) +
        `${okBoth}/${n}`.padStart(9) +
        `   ${(distWhole / n).toFixed(1)} / ${(distArt / n).toFixed(1)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
