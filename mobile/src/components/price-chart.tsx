// Graphe de prix : une seule série (le prix), plus le couloir P10–P90 en
// bande de fond. SVG maison, contrôle total du rendu.
//
// Choix de lecture :
//   - une seule série → pas de légende, le titre de section la nomme ;
//   - la série porte l'encre principale, pas l'accent : l'accent reste
//     réservé aux choses sur lesquelles on peut cliquer ;
//   - le couloir est un décor de fond (neutre, faible opacité, bornes
//     pointillées) pour ne jamais être confondu avec de la donnée ;
//   - axes récessifs : quatre repères de texte, aucune grille.
//
// Toucher le graphe pose un curseur qui donne la date et le prix exacts.

import { useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { AppText } from '@/components/ui';
import { Icon } from '@/components/icons';
import { Colors, Fonts, Radius, Space } from '@/constants/theme';
import { formatDate, formatEur } from '@/lib/format';

export type ChartPoint = { date: string; value: number };

const HEIGHT = 200;
const PAD_TOP = 24;
const PAD_BOTTOM = 26;
const PAD_X = 12;

export function PriceChart({
  points,
  band,
}: {
  points: ChartPoint[];
  band?: { low: number; high: number } | null;
}) {
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <View style={styles.placeholder}>
        <Icon name="chart" size={20} color={Colors.textTertiary} />
        <AppText variant="body" style={styles.placeholderText}>
          L&apos;historique se construit. Un nouveau point de prix arrive chaque nuit.
        </AppText>
      </View>
    );
  }

  const values = points.map((p) => p.value);
  let min = Math.min(...values, band?.low ?? Infinity);
  let max = Math.max(...values, band?.high ?? -Infinity);
  if (max - min < 0.01) {
    min -= 0.5;
    max += 0.5;
  }
  const margin = (max - min) * 0.1;
  min -= margin;
  max += margin;

  const innerW = width - PAD_X * 2;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (i: number) => PAD_X + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = `${line} L ${x(points.length - 1)} ${HEIGHT - PAD_BOTTOM} L ${x(0)} ${HEIGHT - PAD_BOTTOM} Z`;
  const last = points[points.length - 1];

  const active = cursor === null ? null : points[cursor];
  const activeX = cursor === null ? 0 : x(cursor);

  function handleTouch(e: GestureResponderEvent) {
    if (innerW <= 0) return;
    const local = e.nativeEvent.locationX - PAD_X;
    const ratio = Math.max(0, Math.min(1, local / innerW));
    setCursor(Math.round(ratio * (points.length - 1)));
  }

  return (
    <View style={styles.container} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleTouch}
        onResponderMove={handleTouch}
        onResponderRelease={() => setCursor(null)}
        onResponderTerminate={() => setCursor(null)}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            <Defs>
              <LinearGradient id="priceArea" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={Colors.text} stopOpacity="0.16" />
                <Stop offset="1" stopColor={Colors.text} stopOpacity="0" />
              </LinearGradient>
            </Defs>

            {/* Couloir habituel : décor de fond, bornes pointillées. */}
            {band && band.high > band.low && (
              <G>
                <Rect
                  x={PAD_X}
                  y={y(band.high)}
                  width={innerW}
                  height={Math.max(2, y(band.low) - y(band.high))}
                  fill={Colors.text}
                  fillOpacity={0.05}
                  rx={4}
                />
                <Line
                  x1={PAD_X}
                  y1={y(band.high)}
                  x2={width - PAD_X}
                  y2={y(band.high)}
                  stroke={Colors.borderStrong}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
                <Line
                  x1={PAD_X}
                  y1={y(band.low)}
                  x2={width - PAD_X}
                  y2={y(band.low)}
                  stroke={Colors.borderStrong}
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              </G>
            )}

            <Path d={area} fill="url(#priceArea)" />
            <Path
              d={line}
              stroke={Colors.text}
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Dernier point : anneau de surface pour le détacher de l'aire. */}
            <Circle
              cx={x(points.length - 1)}
              cy={y(last.value)}
              r={4.5}
              fill={Colors.text}
              stroke={Colors.surface}
              strokeWidth={2}
            />

            {/* Curseur tactile. */}
            {active && (
              <G>
                <Line
                  x1={activeX}
                  y1={PAD_TOP - 6}
                  x2={activeX}
                  y2={HEIGHT - PAD_BOTTOM}
                  stroke={Colors.borderStrong}
                  strokeWidth={1}
                />
                <Circle
                  cx={activeX}
                  cy={y(active.value)}
                  r={4.5}
                  fill={Colors.text}
                  stroke={Colors.surface}
                  strokeWidth={2}
                />
                <SvgText
                  x={Math.min(Math.max(activeX, PAD_X + 34), width - PAD_X - 34)}
                  y={14}
                  fill={Colors.text}
                  fontSize={12}
                  fontWeight="600"
                  fontFamily={Fonts?.sans}
                  textAnchor="middle">
                  {`${formatEur(active.value)} · ${formatDate(active.date)}`}
                </SvgText>
              </G>
            )}

            {/* Repères. Masqués pendant la lecture au doigt. */}
            {!active && (
              <G>
                <SvgText x={PAD_X} y={14} fill={Colors.textTertiary} fontSize={11} fontFamily={Fonts?.sans}>
                  {formatEur(Math.max(...values))}
                </SvgText>
                <SvgText
                  x={width - PAD_X}
                  y={14}
                  fill={Colors.text}
                  fontSize={12}
                  fontWeight="600"
                  fontFamily={Fonts?.sans}
                  textAnchor="end">
                  {formatEur(last.value)}
                </SvgText>
              </G>
            )}

            <SvgText
              x={PAD_X}
              y={HEIGHT - 8}
              fill={Colors.textTertiary}
              fontSize={11}
              fontFamily={Fonts?.sans}>
              {formatDate(points[0].date)}
            </SvgText>
            <SvgText
              x={width - PAD_X}
              y={HEIGHT - 8}
              fill={Colors.textTertiary}
              fontSize={11}
              fontFamily={Fonts?.sans}
              textAnchor="end">
              {formatDate(last.date)}
            </SvgText>
          </Svg>
        )}
      </View>

      {band && band.high > band.low ? (
        <View style={styles.caption}>
          <View style={styles.captionSwatch} />
          <AppText variant="caption">
            Couloir habituel (P10–P90 sur 30 j) : {formatEur(band.low)} – {formatEur(band.high)}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  caption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
    paddingTop: Space.xs,
  },
  captionSwatch: {
    width: 14,
    height: 10,
    borderRadius: 3,
    backgroundColor: Colors.surfaceHover,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  placeholder: {
    height: HEIGHT,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.sm,
    padding: Space.xl,
  },
  placeholderText: { textAlign: 'center', color: Colors.textSecondary, maxWidth: 280 },
});
