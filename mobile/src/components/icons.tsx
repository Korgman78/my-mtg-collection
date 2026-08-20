// Jeu d'icônes maison, dessiné au trait sur une grille 24×24.
//
// Pourquoi pas une librairie : le seul besoin, c'est une douzaine de glyphes
// cohérents. Les dessiner ici garantit une graisse de trait identique partout
// et évite d'embarquer une police d'icônes entière. Surtout, ça remplace les
// emoji (🔔 🗂 ✦) qui donnaient à l'app son air de prototype.
//
// Convention : viewBox 24×24, trait de 1.6, extrémités arrondies, aucune
// forme pleine. La couleur vient toujours du parent via `color`.

import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Colors } from '@/constants/theme';

const PATHS = {
  bell: ['M18 8.4a6 6 0 1 0-12 0c0 6.3-2.6 8.1-2.6 8.1h17.2S18 14.7 18 8.4', 'M13.7 20.2a2 2 0 0 1-3.4 0'],
  folder: ['M3 6.8A1.8 1.8 0 0 1 4.8 5h3.9l2 2.2h8.5A1.8 1.8 0 0 1 21 9v8.2a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 17.2z'],
  layers: ['M12 3.5 21 8l-9 4.5L3 8z', 'M3 12.5 12 17l9-4.5', 'M3 16.5 12 21l9-4.5'],
  plus: ['M12 5.5v13', 'M5.5 12h13'],
  minus: ['M5.5 12h13'],
  chevronLeft: ['M14.5 19 8 12l6.5-7'],
  chevronRight: ['M9.5 5 16 12l-6.5 7'],
  chevronDown: ['M5 9.5 12 16l7-6.5'],
  trash: ['M3.8 6.2h16.4', 'M9 6.2V4.6a1.2 1.2 0 0 1 1.2-1.2h3.6A1.2 1.2 0 0 1 15 4.6v1.6', 'M18.4 6.2 17.6 19a1.8 1.8 0 0 1-1.8 1.7H8.2A1.8 1.8 0 0 1 6.4 19L5.6 6.2'],
  search: ['M10.8 18.1a7.3 7.3 0 1 0 0-14.6 7.3 7.3 0 0 0 0 14.6', 'M20.5 20.5 16 16'],
  sparkle: ['M12 3.2l1.85 5.35L19.2 10.4l-5.35 1.85L12 17.6l-1.85-5.35L4.8 10.4l5.35-1.85z'],
  arrowUp: ['M12 19.2V5.4', 'M5.8 11.6 12 5.4l6.2 6.2'],
  arrowDown: ['M12 4.8v13.8', 'M18.2 12.4 12 18.6l-6.2-6.2'],
  logout: ['M9.5 20.5H5.3a1.8 1.8 0 0 1-1.8-1.8V5.3a1.8 1.8 0 0 1 1.8-1.8h4.2', 'M16 16.5l4.5-4.5L16 7.5', 'M20.5 12H9.5'],
  close: ['M18.2 5.8 5.8 18.2', 'M5.8 5.8l12.4 12.4'],
  check: ['M20 6.5 9.4 17.1 4 11.7'],
  chart: ['M3.5 3.5v17h17', 'M7.2 15.4l3.9-3.9 2.9 2.9 5.3-5.9'],
  card: ['M4.4 3.5h15.2a.9.9 0 0 1 .9.9v15.2a.9.9 0 0 1-.9.9H4.4a.9.9 0 0 1-.9-.9V4.4a.9.9 0 0 1 .9-.9', 'M7 7.6h10v6.2H7z'],
  filter: ['M4 6.5h16', 'M7 12h10', 'M10 17.5h4'],
  alert: ['M12 4.2 21.2 19.8H2.8z', 'M12 10v4.1', 'M12 17.3v.01'],
  pencil: ['M4 20h4.2L19.1 9.1a2 2 0 0 0-2.8-2.8L5.4 17.2 4 20', 'M14.8 7.6l3.4 3.4'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 20,
  color = Colors.textSecondary,
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  /** `ColorValue` et pas `string` : les options d'onglet fournissent ce type. */
  color?: ColorValue;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {PATHS[name].map((d) => (
        <Path
          key={d}
          d={d}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}
