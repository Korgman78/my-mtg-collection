// Génère le jeu d'icônes de l'app, à partir d'une seule description de forme.
//
// Pourquoi un script plutôt que six PNG dessinés à la main : Android en réclame
// quatre variantes de la même marque (pleine, avant-plan, arrière-plan,
// monochrome), et les garder cohérentes à la main est une promesse qu'on ne
// tient jamais. Ici on change une couleur ou un angle, on relance, et les six
// fichiers repartent alignés.
//
// La marque : trois cartes en éventail, la première portant sa fenêtre
// d'illustration. Pas de texte — un logo qui doit rester lisible à 48 px ne
// peut pas porter « My MTG Collection » ; il porte la silhouette d'une carte,
// que le joueur reconnaît sans légende.
//
// Usage : node scripts/make-icons.mjs

import fs from 'node:fs';
import path from 'node:path';

import { PNG } from 'pngjs';

const OUT = path.resolve('mobile/assets/images');

/* -------------------------------------------------------------------------- */
/* Palette — reprise de mobile/src/constants/theme.ts                          */
/* -------------------------------------------------------------------------- */

const INK = '#14110D'; // fond, encre chaude
const GOLD = '#C9A227'; // accent, or vieilli
const GOLD_DIM = '#6E5A22'; // les cartes du dessous, en retrait
const WINDOW = '#171106'; // la fenêtre d'illustration, creusée dans l'or

function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/* -------------------------------------------------------------------------- */
/* Rendu                                                                       */
/* -------------------------------------------------------------------------- */

/** Un rectangle arrondi, éventuellement pivoté.
 *
 *  `mode: 'clear'` efface au lieu de peindre : c'est ce qui creuse l'écart
 *  entre deux cartes qui se chevauchent, et la fenêtre d'illustration, sans
 *  avoir à peindre une couleur de fond — donc en gardant la transparence pour
 *  les variantes qui en ont besoin. */
function roundedRect({ cx, cy, w, h, r, angle = 0, color, mode = 'over', alpha = 1 }) {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const hw = w / 2;
  const hh = h / 2;

  // Rayon de garde pour la boîte englobante de la forme pivotée.
  const reach = Math.hypot(hw, hh) + 2;

  return {
    bbox: [cx - reach, cy - reach, cx + reach, cy + reach],
    // Couverture d'un point, dans le repère de la forme.
    hit(px, py) {
      const dx0 = px - cx;
      const dy0 = py - cy;
      const x = Math.abs(dx0 * cos - dy0 * sin);
      const y = Math.abs(dx0 * sin + dy0 * cos);
      if (x > hw || y > hh) return false;
      const ox = x - (hw - r);
      const oy = y - (hh - r);
      if (ox <= 0 || oy <= 0) return true;
      return ox * ox + oy * oy <= r * r;
    },
    color: color ? rgb(color) : null,
    mode,
    alpha,
  };
}

/** Peint une liste de formes, en échantillonnant 4×4 par pixel.
 *
 *  Le suréchantillonnage n'est pas un luxe : sans lui, une carte pivotée de
 *  15° montre un escalier que l'œil attrape immédiatement sur un fond sombre. */
function render(size, shapes, background) {
  const png = new PNG({ width: size, height: size });
  const buf = png.data;

  if (background) {
    const [r, g, b] = rgb(background);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = 255;
    }
  } else {
    buf.fill(0);
  }

  const SS = 4; // sous-échantillons par axe
  const step = 1 / SS;
  const offset = step / 2;

  for (const shape of shapes) {
    const [x0, y0, x1, y1] = shape.bbox;
    const minX = Math.max(0, Math.floor(x0));
    const maxX = Math.min(size - 1, Math.ceil(x1));
    const minY = Math.max(0, Math.floor(y0));
    const maxY = Math.min(size - 1, Math.ceil(y1));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            if (shape.hit(px + sx * step + offset, py + sy * step + offset)) hits++;
          }
        }
        if (hits === 0) continue;

        const cov = (hits / (SS * SS)) * shape.alpha;
        const i = (py * size + px) * 4;

        if (shape.mode === 'clear') {
          buf[i + 3] = Math.round(buf[i + 3] * (1 - cov));
          continue;
        }

        const [sr, sg, sb] = shape.color;
        const da = buf[i + 3] / 255;
        const oa = cov + da * (1 - cov);
        if (oa === 0) continue;
        // Composition « source over », en non prémultiplié.
        buf[i] = Math.round((sr * cov + buf[i] * da * (1 - cov)) / oa);
        buf[i + 1] = Math.round((sg * cov + buf[i + 1] * da * (1 - cov)) / oa);
        buf[i + 2] = Math.round((sb * cov + buf[i + 2] * da * (1 - cov)) / oa);
        buf[i + 3] = Math.round(oa * 255);
      }
    }
  }

  return png;
}

/* -------------------------------------------------------------------------- */
/* La marque                                                                   */
/* -------------------------------------------------------------------------- */

/** Les trois cartes en éventail.
 *
 *  `scale` cadre la marque : 1 remplit une icône pleine, ~0,68 la ramène dans
 *  la zone sûre d'une icône adaptative Android (le système peut la rogner en
 *  cercle, tout ce qui déborde de 66 % du canevas est à la merci du masque).
 *
 *  `mono` produit la silhouette d'une seule teinte réclamée par les icônes
 *  thématiques d'Android 13+ : le système la recolore, elle ne peut donc pas
 *  compter sur la couleur pour séparer les cartes — d'où les écarts creusés. */
function mark({ size, scale = 1, mono = false, gapColor = null }) {
  const c = size / 2;
  const u = (size / 1024) * scale; // unité de dessin, calée sur un canevas 1024

  const cardW = 330 * u;
  const cardH = 461 * u; // rapport 63:88, celui d'une vraie carte
  const radius = 26 * u;
  const gap = 13 * u; // largeur de l'écart entre deux cartes
  const spread = 145 * u;
  const tilt = 15;

  const front = mono ? '#FFFFFF' : GOLD;
  const back = mono ? '#FFFFFF' : GOLD_DIM;

  // L'écart : soit on l'efface (variantes transparentes et monochrome), soit
  // on le peint de la couleur du fond (icône pleine).
  const separator = (opts) =>
    gapColor
      ? roundedRect({ ...opts, color: gapColor, mode: 'over' })
      : roundedRect({ ...opts, mode: 'clear' });

  const side = (dir) => {
    const cx = c + dir * spread;
    const cy = c + 16 * u; // les cartes du fond descendent un peu
    const angle = dir * tilt;
    return [
      separator({ cx, cy, w: cardW + gap * 2, h: cardH + gap * 2, r: radius + gap, angle }),
      roundedRect({ cx, cy, w: cardW, h: cardH, r: radius, angle, color: back }),
    ];
  };

  const centerY = c - 10 * u;

  return [
    ...side(-1),
    ...side(1),
    separator({
      cx: c,
      cy: centerY,
      w: cardW + gap * 2,
      h: cardH + gap * 2,
      r: radius + gap,
    }),
    roundedRect({ cx: c, cy: centerY, w: cardW, h: cardH, r: radius, color: front }),
    // La fenêtre d'illustration : c'est elle qui fait lire « carte » plutôt
    // que « rectangle ». Creusée, jamais peinte, pour tenir en monochrome.
    roundedRect({
      cx: c,
      cy: centerY - 66 * u,
      w: cardW - 62 * u,
      h: cardH * 0.42,
      r: 10 * u,
      mode: mono ? 'clear' : 'over',
      color: mono ? null : WINDOW,
    }),
  ];
}

/* -------------------------------------------------------------------------- */

function write(name, png) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, PNG.sync.write(png));
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(`  ${name.padEnd(30)} ${String(png.width).padStart(4)}px   ${kb} Ko`);
}

console.log(`Écriture dans ${OUT}\n`);

// Icône pleine : le système arrondit lui-même les angles.
write('icon.png', render(1024, mark({ size: 1024, gapColor: INK }), INK));

// Icône adaptative Android : deux calques, plus la variante thématique.
write('android-icon-foreground.png', render(1024, mark({ size: 1024, scale: 0.68 }), null));
write('android-icon-background.png', render(1024, [], INK));
write(
  'android-icon-monochrome.png',
  render(1024, mark({ size: 1024, scale: 0.68, mono: true }), null)
);

// Écran de démarrage : posé sur la couleur de fond déclarée dans app.json.
write('splash-icon.png', render(1024, mark({ size: 1024, scale: 0.92 }), null));

// Favicon web.
write('favicon.png', render(64, mark({ size: 64, gapColor: INK }), INK));

console.log('\nTerminé.');
