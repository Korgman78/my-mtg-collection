// Design tokens de Grimoire.
//
// Direction : grimoire — encre chaude, parchemin, dorure.
//
// Le fond n'est pas un noir neutre mais un noir brun (une encre sur cuir),
// le texte n'est pas blanc mais parchemin, et l'accent est un or vieilli.
// C'est ce triangle qui porte tout l'univers : la typographie, elle, reste
// une sans-serif système parfaitement neutre. Un grimoire se lit, il ne se
// déchiffre pas.
//
// Règle d'usage de l'or : il signale ce sur quoi on peut agir et les titres
// de section. Jamais un bloc entier de texte — l'or vaut par sa rareté.

import { Platform } from 'react-native';

export const Colors = {
  // Fonds, du plus profond au plus élevé. Chaque palier reste chaud :
  // un gris neutre au milieu de cette pile se voit immédiatement.
  bg: '#0B0907',
  surface: '#14110D',
  surfaceAlt: '#1C1813',
  surfaceHover: '#251F18',

  // Séparations. `border` doit rester à la limite du perceptible ;
  // `rule` est la version dorée, réservée aux encadrements.
  border: '#292219',
  borderStrong: '#3A3122',
  rule: 'rgba(201, 162, 39, 0.28)',

  // Texte, trois niveaux suffisent. Le principal tire sur le parchemin.
  text: '#EFE6D5',
  textSecondary: '#9D9179',
  textTertiary: '#6D6353',

  // Accent unique : or vieilli. Le texte posé dessus est de l'encre,
  // pas du blanc — du blanc sur cet or ne passe aucun seuil de contraste.
  accent: '#C9A227',
  accentHover: '#DEB63D',
  accentSoft: 'rgba(201, 162, 39, 0.13)',
  accentBorder: 'rgba(201, 162, 39, 0.42)',
  onAccent: '#171106',

  // Sémantique : hausse / baisse / foil. Teintes de pigment plutôt que
  // de LED, pour rester dans le même monde que l'or.
  up: '#63A96F',
  upSoft: 'rgba(99, 169, 111, 0.13)',
  down: '#C4564B',
  downSoft: 'rgba(196, 86, 75, 0.13)',
  flat: '#7A7060',
  // Le foil reste froid : c'est le seul point de l'app qui doit trancher
  // avec l'or, sinon on ne distingue plus un foil d'une action.
  foil: '#9A8CE0',
  foilSoft: 'rgba(154, 140, 224, 0.14)',

  danger: '#C4564B',
  dangerSoft: 'rgba(196, 86, 75, 0.11)',
  dangerBorder: 'rgba(196, 86, 75, 0.38)',

  overlay: 'rgba(6, 5, 3, 0.74)',
  skeleton: '#1E1913',
} as const;

// Pastilles de dossier : les cinq couleurs de mana en pigments assourdis,
// plus un cuivre. Un joueur lit ces teintes sans légende.
export const FolderColors = [
  '#C9A227', // or / blanc
  '#5A8FC7', // azur / bleu
  '#8A72C9', // améthyste / noir
  '#C4564B', // rubis / rouge
  '#63A96F', // émeraude / vert
  '#B0754A', // cuivre
] as const;

// Piles de polices système. On n'embarque aucune fonte : la pile native de
// chaque plateforme est déjà la plus lisible et coûte zéro octet. L'univers
// grimoire vient de la couleur et des encadrements, pas d'une gothique
// illisible à 12 px.
//
// Sur web on écrit la pile en clair plutôt qu'un `var(--font-display)` :
// une variable CSS non résolue devient un nom de police invalide et le
// navigateur retombe silencieusement sur son serif par défaut.
export const Fonts = Platform.select({
  ios: { sans: 'system-ui', mono: 'ui-monospace' },
  default: { sans: 'normal', mono: 'monospace' },
  web: {
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  },
});

// Échelle d'espacement. Une seule échelle pour tout l'app : padding,
// gap, marges. Pas de valeur en dur dans les écrans.
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

// Rayons contenus : au-delà de 12 px on bascule dans le « bubbly ».
export const Radius = {
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
} as const;

// Hauteurs de contrôle, pour que boutons et champs s'alignent exactement.
export const Control = {
  sm: 32,
  md: 40,
  lg: 46,
} as const;

export const MaxContentWidth = 720;

// Durées d'animation (ms). Court = réactif ; au-delà de 200 ms ça traîne.
export const Motion = {
  fast: 120,
  base: 180,
} as const;
