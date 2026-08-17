// Design tokens de Grimoire.
//
// Direction : sobre & premium. Fond quasi-noir neutre, surfaces qui se
// distinguent par de très faibles écarts de luminosité plutôt que par des
// bordures marquées, un accent froid unique réservé aux actions.
//
// Règle d'usage de l'accent : il signale ce sur quoi on peut agir, jamais
// une simple décoration. Un écran qui a trois zones accentuées a un problème
// de hiérarchie, pas besoin d'une quatrième couleur.

import { Platform } from 'react-native';

export const Colors = {
  // Fonds, du plus profond au plus élevé.
  bg: '#0A0A0B',
  surface: '#131315',
  surfaceAlt: '#1A1A1D',
  surfaceHover: '#202024',

  // Séparations. `border` doit rester à la limite du perceptible.
  border: '#232327',
  borderStrong: '#2F2F35',

  // Texte, trois niveaux suffisent.
  text: '#ECECEE',
  textSecondary: '#8C8C96',
  textTertiary: '#5A5A63',

  // Accent unique, froid et légèrement désaturé.
  accent: '#6C74E0',
  accentHover: '#7E86EA',
  accentSoft: 'rgba(108, 116, 224, 0.14)',
  accentBorder: 'rgba(108, 116, 224, 0.38)',
  onAccent: '#FFFFFF',

  // Sémantique : hausse / baisse / foil. Volontairement peu saturées pour
  // ne pas concurrencer l'accent.
  up: '#3FB950',
  upSoft: 'rgba(63, 185, 80, 0.12)',
  down: '#E5534B',
  downSoft: 'rgba(229, 83, 75, 0.12)',
  flat: '#6E6E78',
  foil: '#58A6FF',
  foilSoft: 'rgba(88, 166, 255, 0.12)',

  danger: '#E5534B',
  dangerSoft: 'rgba(229, 83, 75, 0.10)',
  dangerBorder: 'rgba(229, 83, 75, 0.35)',

  overlay: 'rgba(0, 0, 0, 0.68)',
  skeleton: '#1E1E22',
} as const;

// Pastilles de dossier : teintes désaturées qui cohabitent avec l'accent.
export const FolderColors = [
  '#6C74E0',
  '#58A6FF',
  '#3FB950',
  '#D9A441',
  '#E5534B',
  '#A874D9',
] as const;

// Piles de polices système. On n'embarque aucune fonte : la pile native de
// chaque plateforme est déjà la plus lisible et coûte zéro octet.
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
