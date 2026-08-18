// Où va-t-on maintenant ? Trois pistes, mesurées plutôt que supposées.
//
// L'empreinte de l'illustration a nettement amélioré les choses, mais elle
// repose sur une hypothèse fragile : que le rectangle analysé soit
// EXACTEMENT la carte. La fenêtre d'illustration est définie en fractions de
// ce rectangle — si la photo laisse 12 % de fond autour, la fenêtre glisse et
// on hache un morceau de bordure au lieu du dessin.
//
// Ce script chiffre trois leviers :
//
//   A. l'existant           — 25 fenêtres balayées à l'aveugle
//   B. détection parfaite   — on connaît les bords exacts de la carte
//                             (ce que donnerait une détection de contour)
//   C. illustration en 2×2  — quatre empreintes au lieu d'une, sommées
//
// L'écart A → B chiffre ce que rapporterait une vraie détection de carte.
// L'écart 1×1 → 2×2 chiffre ce que rapporterait un descripteur plus fin.
//
// Usage : node scripts/phash-eval-next.mjs [set] [nb cartes]

import jpeg from 'jpeg-js';

import { ART_REGION, gray32FromRegion, hamming, phashFromGray32, phashWindows } from '../mobile/src/lib/phash.ts';
import { detectCard, rectify } from '../mobile/src/lib/card-detect.ts';

const HEADERS = { 'User-Agent': 'my-mtg-collection/0.1 (next eval)', Accept: 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getRgba(url) {
  const res = await fetch(url, { headers: { 'User-Agent': HEADERS['User-Agent'] } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return jpeg.decode(Buffer.from(await res.arrayBuffer()), { useTArray: true });
}

/* --- Descripteurs --------------------------------------------------------- */

/** L'illustration d'une carte dont on connaît les bords, en une empreinte. */
function artHash({ data, width }, card) {
  return phashFromGray32(
    gray32FromRegion(
      data,
      width,
      Math.round(card.x + card.w * ART_REGION.x),
      Math.round(card.y + card.h * ART_REGION.y),
      Math.round(card.w * ART_REGION.w),
      Math.round(card.h * ART_REGION.h)
    )
  );
}

/** La même illustration découpée en 2×2 : quatre empreintes.
 *  Un quart d'illustration porte moins de charpente commune et plus de
 *  dessin, donc plus d'information distinctive par bit. */
function artHashGrid({ data, width }, card) {
  const ax = card.x + card.w * ART_REGION.x;
  const ay = card.y + card.h * ART_REGION.y;
  const aw = card.w * ART_REGION.w;
  const ah = card.h * ART_REGION.h;

  const out = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      out.push(
        phashFromGray32(
          gray32FromRegion(
            data,
            width,
            Math.round(ax + (aw / 2) * col),
            Math.round(ay + (ah / 2) * row),
            Math.round(aw / 2),
            Math.round(ah / 2)
          )
        )
      );
    }
  }
  return out;
}

const gridDistance = (a, b) => a.reduce((sum, h, i) => sum + hamming(h, b[i]), 0);

/* --- Photo réaliste ------------------------------------------------------- */

function tilt({ data, width, height }, amount) {
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

function glare({ data, width, height }, strength) {
  const out = new Uint8ClampedArray(data.length);
  const cx = width * 0.35;
  const cy = height * 0.3;
  const radius = Math.max(width, height) * 0.45;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const boost = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / radius) ** 2 * strength * 255;
      out[o] = data[o] + boost;
      out[o + 1] = data[o + 1] + boost;
      out[o + 2] = data[o + 2] + boost;
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

/** La carte posée dans le cadre, avec du fond autour et un décentrage.
 *  Renvoie l'image ET les bords exacts de la carte — ce que produirait une
 *  détection de contour parfaite. */
function framedPhoto(card, { pad, shiftX, shiftY }) {
  const w = Math.round(card.width * (1 + pad * 2));
  const h = Math.round(card.height * (1 + pad * 2));
  const out = new Uint8ClampedArray(w * h * 4);

  let seed = 5;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < out.length; i += 4) {
    const v = 90 + (rnd() - 0.5) * 14;
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = 255;
  }

  const ox = Math.round((w - card.width) / 2 + card.width * shiftX);
  const oy = Math.round((h - card.height) / 2 + card.height * shiftY);
  for (let y = 0; y < card.height; y++) {
    for (let x = 0; x < card.width; x++) {
      const dy = y + oy;
      const dx = x + ox;
      if (dy < 0 || dy >= h || dx < 0 || dx >= w) continue;
      const s = (y * card.width + x) * 4;
      const d = (dy * w + dx) * 4;
      out[d] = card.data[s];
      out[d + 1] = card.data[s + 1];
      out[d + 2] = card.data[s + 2];
    }
  }

  return {
    photo: { data: out, width: w, height: h },
    bounds: { x: ox, y: oy, w: card.width, h: card.height },
  };
}

async function main() {
  const setCode = (process.argv[2] ?? 'fin').toLowerCase();
  const limit = Number(process.argv[3] ?? 25);

  const q = encodeURIComponent(`set:${setCode} game:paper`);
  const page = await (
    await fetch(`https://api.scryfall.com/cards/search?q=${q}&unique=cards&order=set`, {
      headers: HEADERS,
    })
  ).json();
  const cards = (page.data ?? []).slice(0, limit);

  const reference = [];
  for (const card of cards) {
    const uris = card.image_uris ?? card.card_faces?.[0]?.image_uris ?? {};
    if (!uris.small || !uris.normal) continue;
    const img = await getRgba(uris.small);
    const full = { x: 0, y: 0, w: img.width, h: img.height };
    reference.push({
      name: card.name,
      normal: uris.normal,
      art: artHash(img, full),
      grid: artHashGrid(img, full),
    });
    await sleep(260);
  }
  console.log(`Set ${setCode.toUpperCase()} — référence de ${reference.length} cartes\n`);

  const originals = [];
  for (const ref of reference) {
    originals.push({ ref, img: await getRgba(ref.normal) });
    await sleep(260);
  }

  const CASES = [
    ['cadrage soigné', { pad: 0.04, shiftX: 0, shiftY: 0, tiltAmt: 0.02, glareAmt: 0.2 }],
    ['photo ordinaire', { pad: 0.12, shiftX: 0.02, shiftY: -0.02, tiltAmt: 0.04, glareAmt: 0.35 }],
    ['photo negligee', { pad: 0.22, shiftX: 0.05, shiftY: -0.04, tiltAmt: 0.07, glareAmt: 0.5 }],
  ];

  console.log(
    'situation'.padEnd(20) +
      'A actuel'.padStart(10) +
      'B parfait'.padStart(11) +
      'D reel'.padStart(9) +
      'E reel 2x2'.padStart(12) +
      'F combine'.padStart(11) +
      '   detect.'
  );
  console.log('-'.repeat(70));

  for (const [label, p] of CASES) {
    let okA = 0;
    let okB = 0;
    let okD = 0;
    let okE = 0;
    let okF = 0;
    let okFound = 0;
    let dA = 0;
    let dB = 0;

    for (const { ref, img } of originals) {
      const degraded = glare(tilt(img, p.tiltAmt), p.glareAmt);
      const { photo, bounds } = framedPhoto(
        { data: degraded.data, width: degraded.width, height: degraded.height },
        p
      );

      // A — l'existant : 25 fenêtres balayées, sans savoir où est la carte.
      const windows = phashWindows(photo.data, photo.width, photo.height).art;
      const bestA = (target) => Math.min(...windows.map((h) => hamming(h, target)));

      // B — détection parfaite : on applique la fenêtre d'illustration aux
      // bords réels de la carte.
      const hB = artHash(photo, { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h });

      const winner = (dist, key) => {
        const dTrue = dist(ref[key]);
        let dWrong = Infinity;
        for (const o of reference) if (o !== ref) dWrong = Math.min(dWrong, dist(o[key]));
        return { dTrue, win: dTrue < dWrong };
      };

      const a = winner(bestA, 'art');
      const b = winner((t) => hamming(hB, t), 'art');

      // D et E — détection RÉELLE, celle qui tournera sur le téléphone,
      // suivie d'un redressement par homographie.
      const detected = detectCard(photo.data, photo.width, photo.height);
      let d = { win: false, dTrue: 64 };
      let e = { win: false, dTrue: 256 };

      let hD = null;
      if (detected) {
        const flat = rectify(photo.data, photo.width, photo.height, detected.quad, 256, 357);
        if (flat) {
          okFound++;
          const full = { x: 0, y: 0, w: flat.width, h: flat.height };
          hD = artHash(flat, full);
          d = winner((t) => hamming(hD, t), 'art');
          e = winner((t) => gridDistance(artHashGrid(flat, full), t), 'grid');
        }
      }

      // F — les deux ensemble. La détection ne REMPLACE pas le balayage, elle
      // s'y ajoute : une détection ratée ne peut alors jamais faire pire que
      // l'existant, elle peut seulement aider quand elle est bonne.
      const f = winner(
        (t) => Math.min(bestA(t), hD ? hamming(hD, t) : 64),
        'art'
      );

      if (a.win) okA++;
      if (b.win) okB++;
      if (d.win) okD++;
      if (e.win) okE++;
      if (f.win) okF++;
      dA += a.dTrue;
      dB += d.dTrue;
    }

    const n = originals.length;
    console.log(
      label.padEnd(20) +
        `${okA}/${n}`.padStart(10) +
        `${okB}/${n}`.padStart(11) +
        `${okD}/${n}`.padStart(9) +
        `${okE}/${n}`.padStart(12) +
        `${okFound}/${n}`.padStart(10) +
        `   ${(dA / n).toFixed(1)} / ${(dB / n).toFixed(1)}`
    );
  }

  // Pouvoir discriminant brut des deux descripteurs.
  console.log('');
  for (const key of ['art', 'grid']) {
    let sum = 0;
    let pairs = 0;
    let closest = Infinity;
    for (let i = 0; i < reference.length; i++) {
      for (let j = i + 1; j < reference.length; j++) {
        const d =
          key === 'art'
            ? hamming(reference[i].art, reference[j].art)
            : gridDistance(reference[i].grid, reference[j].grid);
        sum += d;
        pairs++;
        closest = Math.min(closest, d);
      }
    }
    const bits = key === 'art' ? 64 : 256;
    console.log(
      `${key === 'art' ? 'illustration 1×1' : 'illustration 2×2'} (${bits} bits) — ` +
        `écart moyen ${(sum / pairs).toFixed(1)}, plus proche paire ${closest} ` +
        `(soit ${((closest / bits) * 100).toFixed(1)} % des bits)`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
