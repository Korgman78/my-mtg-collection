// Essai de bout en bout du scanner, sans caméra ni base.
//
// Il fait tourner les DEUX chemins réels, celui de la référence et celui de
// l'app, et vérifie qu'ils se rejoignent :
//
//   référence : JPEG Scryfall (petit) → jpeg-js → gray32 → pHash
//               (exactement scripts/hash-set.mjs)
//
//   requête   : JPEG Scryfall (grand) → photo simulée (fond autour, lumière,
//               bruit, flou) → découpe frameRect() → réduction 256 px →
//               encodage PNG → décodage par mobile/src/lib/png.ts →
//               phashWindows() → meilleure correspondance
//               (exactement mobile/src/lib/scan.ts, caméra en moins)
//
// Ce que ça attrape et qu'aucun test unitaire ne verrait : une découpe qui
// ne tombe pas au bon endroit, un décodeur PNG qui décale d'un pixel, une
// échelle de fenêtres mal centrée. Autant de pannes muettes.
//
// Usage : node scripts/scan-e2e.mjs [set] [nb cartes]

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

import { phashPair, phashWindows } from '../mobile/src/lib/phash.ts';
import { decodePng } from '../mobile/src/lib/png.ts';
import { frameRect } from '../mobile/src/lib/card-frame.ts';

const HEADERS = { 'User-Agent': 'my-mtg-collection/0.1 (scanner e2e)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getRgba(url) {
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return jpeg.decode(Buffer.from(await res.arrayBuffer()), { useTArray: true });
}

/* --- Fabrication d'une « photo » ----------------------------------------- */

/** La carte posée sur une table, avec du fond autour et un léger décentrage. */
function asPhoto({ data, width, height }, margin, shiftX, shiftY, gain, noiseAmp) {
  const w = Math.round(width * (1 + margin * 2));
  const h = Math.round(height * (1 + margin * 2));
  const out = new Uint8ClampedArray(w * h * 4);

  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  // Fond : un gris de table, pas un noir parfait.
  for (let i = 0; i < out.length; i += 4) {
    const v = 95 + (rnd() - 0.5) * 12;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }

  const ox = Math.round((w - width) / 2 + width * shiftX);
  const oy = Math.round((h - height) / 2 + height * shiftY);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dy = y + oy;
      const dx = x + ox;
      if (dy < 0 || dy >= h || dx < 0 || dx >= w) continue;
      const s = (y * width + x) * 4;
      const d = (dy * w + dx) * 4;
      out[d] = data[s] * gain + (rnd() - 0.5) * noiseAmp;
      out[d + 1] = data[s + 1] * gain + (rnd() - 0.5) * noiseAmp;
      out[d + 2] = data[s + 2] * gain + (rnd() - 0.5) * noiseAmp;
    }
  }
  return { data: out, width: w, height: h };
}

/* --- Le chemin de l'app --------------------------------------------------- */

/** Découpe rectangulaire, comme le fait ImageManipulator.crop(). */
function cropRect({ data, width }, rect) {
  const out = new Uint8ClampedArray(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const s = ((y + rect.originY) * width + (x + rect.originX)) * 4;
      const d = (y * rect.width + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = 255;
    }
  }
  return { data: out, width: rect.width, height: rect.height };
}

/** Réduction à une largeur donnée, comme ImageManipulator.resize(). */
function resizeTo({ data, width, height }, targetWidth) {
  const tw = targetWidth;
  const th = Math.max(1, Math.round((height * targetWidth) / width));
  const out = new Uint8ClampedArray(tw * th * 4);

  for (let y = 0; y < th; y++) {
    const y0 = Math.floor((y * height) / th);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * width) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / tw));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const o = (sy * width + sx) * 4;
          r += data[o];
          g += data[o + 1];
          b += data[o + 2];
          n++;
        }
      }
      const d = (y * tw + x) * 4;
      out[d] = r / n;
      out[d + 1] = g / n;
      out[d + 2] = b / n;
      out[d + 3] = 255;
    }
  }
  return { data: out, width: tw, height: th };
}

/** Encode en PNG : c'est le format que l'ImageManipulator rend à l'app. */
function toPng({ data, width, height }) {
  const png = new PNG({ width, height });
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(png.data);
  return PNG.sync.write(png);
}

/** Le pipeline de l'app, à la caméra près. */
function appHashes(photo) {
  const cropped = cropRect(photo, frameRect(photo.width, photo.height));
  const small = resizeTo(cropped, 256);
  const decoded = decodePng(new Uint8Array(toPng(small)));
  return phashWindows(decoded.data, decoded.width, decoded.height).art;
}

/* --- Essai ---------------------------------------------------------------- */

const CASES = [
  ['carte bien cadrée, bonne lumière', { margin: 0.1, sx: 0, sy: 0, gain: 1, noise: 8 }],
  ['décentrée de 3 %', { margin: 0.1, sx: 0.03, sy: -0.02, gain: 1, noise: 8 }],
  ['photo de loin (30 % de fond)', { margin: 0.3, sx: 0, sy: 0, gain: 1, noise: 8 }],
  ['pénombre', { margin: 0.12, sx: 0.01, sy: 0.01, gain: 0.6, noise: 14 }],
  ['cumul défavorable', { margin: 0.22, sx: 0.04, sy: -0.03, gain: 0.75, noise: 20 }],
];

async function main() {
  const setCode = (process.argv[2] ?? 'otp').toLowerCase();
  const limit = Number(process.argv[3] ?? 40);

  const q = encodeURIComponent(`set:${setCode} game:paper`);
  const page = await (
    await fetch(
      `https://api.scryfall.com/cards/search?q=${q}&unique=prints&include_variations=true&order=set`,
      { headers: HEADERS }
    )
  ).json();
  const cards = (page.data ?? []).slice(0, limit);

  // Référence, chemin de production.
  const reference = [];
  for (const card of cards) {
    const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? {};
    if (!uris.small || !uris.normal) continue;
    const img = await getRgba(uris.small);
    reference.push({
      name: card.name,
      normal: uris.normal,
      hash: phashPair(img.data, img.width, img.height).art,
    });
    await sleep(110);
  }
  console.log(`Set ${setCode.toUpperCase()} — référence de ${reference.length} cartes\n`);

  const originals = [];
  for (const ref of reference) {
    originals.push({ ref, img: await getRgba(ref.normal) });
    await sleep(110);
  }

  console.log(
    'situation'.padEnd(34) + 'reconnu'.padStart(9) + 'dist.'.padStart(8) + 'marge min'.padStart(11)
  );
  console.log('-'.repeat(62));

  let worstCase = 1;

  for (const [label, p] of CASES) {
    let correct = 0;
    let distSum = 0;
    let marginMin = 64;

    for (const { ref, img } of originals) {
      const photo = asPhoto(img, p.margin, p.sx, p.sy, p.gain, p.noise);
      const queries = appHashes(photo);

      const best = (target) => {
        let d = 64;
        for (const h of queries) {
          let x = 0;
          for (let i = 0; i < h.length; i++) if (h[i] !== target[i]) x++;
          if (x < d) d = x;
        }
        return d;
      };

      const dTrue = best(ref.hash);
      let dWrong = 64;
      for (const other of reference) {
        if (other !== ref) dWrong = Math.min(dWrong, best(other.hash));
      }

      if (dTrue < dWrong) correct++;
      distSum += dTrue;
      marginMin = Math.min(marginMin, dWrong - dTrue);
    }

    worstCase = Math.min(worstCase, correct / originals.length);
    console.log(
      label.padEnd(34) +
        `${correct}/${originals.length}`.padStart(9) +
        (distSum / originals.length).toFixed(1).padStart(8) +
        String(marginMin).padStart(11)
    );
  }

  console.log(`\nPire cas : ${(worstCase * 100).toFixed(0)} % de reconnaissance.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
