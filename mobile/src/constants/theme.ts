import { Platform } from 'react-native';

// Palette sombre unique (pas de mode clair en v1) : bleu nuit profond + or.
export const Colors = {
  bg: '#0B0E14',
  surface: '#141927',
  surfaceAlt: '#1C2335',
  border: '#242D44',
  text: '#F2F4F8',
  textSecondary: '#8B93A7',
  accent: '#E8B64C',
  accentSoft: 'rgba(232, 182, 76, 0.14)',
  up: '#4ADE80',
  upSoft: 'rgba(74, 222, 128, 0.12)',
  down: '#F87171',
  downSoft: 'rgba(248, 113, 113, 0.12)',
  foil: '#7DD3FC',
  danger: '#F87171',
} as const;

// Couleurs proposées à la création d'un folder.
export const FolderColors = ['#E8B64C', '#7DD3FC', '#A78BFA', '#4ADE80', '#F87171', '#FB923C'] as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 10,
  md: 16,
  lg: 22,
} as const;

export const MaxContentWidth = 800;
