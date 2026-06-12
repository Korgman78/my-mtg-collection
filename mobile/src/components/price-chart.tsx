// Graphe de prix : ligne + aire dégradée, et couloir P10–P90 en bande translucide.
// SVG maison : aucun style imposé, contrôle total du rendu.

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatDate, formatEur } from '@/lib/format';
import { AppText } from '@/components/ui';

export type ChartPoint = { date: string; value: number };

const HEIGHT = 190;
const PAD_TOP = 26;
const PAD_BOTTOM = 24;
const PAD_X = 6;

export function PriceChart({
  points,
  band,
}: {
  points: ChartPoint[];
  band?: { low: number; high: number } | null;
}) {
  const [width, setWidth] = useState(0);

  if (points.length < 2) {
    return (
      <View style={styles.placeholder}>
        <AppText variant="secondary" style={{ textAlign: 'center' }}>
          📈 L&apos;historique se construit.{'\n'}Un nouveau point de prix arrive chaque nuit.
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
  const margin = (max - min) * 0.08;
  min -= margin;
  max += margin;

  const innerW = width - PAD_X * 2;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (i: number) => PAD_X + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * innerH;

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = `${line} L ${x(points.length - 1)} ${HEIGHT - PAD_BOTTOM} L ${x(0)} ${HEIGHT - PAD_BOTTOM} Z`;
  const last = points[points.length - 1];

  return (
    <View style={styles.container} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          <Defs>
            <LinearGradient id="area" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={Colors.accent} stopOpacity="0.28" />
              <Stop offset="1" stopColor={Colors.accent} stopOpacity="0" />
            </LinearGradient>
          </Defs>

          {band && band.high > band.low && (
            <Rect
              x={PAD_X}
              y={y(band.high)}
              width={innerW}
              height={Math.max(2, y(band.low) - y(band.high))}
              fill={Colors.accentSoft}
              rx={4}
            />
          )}

          <Path d={area} fill="url(#area)" />
          <Path d={line} stroke={Colors.accent} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
          <Circle cx={x(points.length - 1)} cy={y(last.value)} r={4.5} fill={Colors.accent} />

          <SvgText x={PAD_X} y={16} fill={Colors.textSecondary} fontSize={11}>
            max {formatEur(Math.max(...values))}
          </SvgText>
          <SvgText
            x={width - PAD_X}
            y={16}
            fill={Colors.text}
            fontSize={12}
            fontWeight="bold"
            textAnchor="end">
            {formatEur(last.value)}
          </SvgText>
          <SvgText x={PAD_X} y={HEIGHT - 6} fill={Colors.textSecondary} fontSize={11}>
            {formatDate(points[0].date)}
          </SvgText>
          <SvgText x={width - PAD_X} y={HEIGHT - 6} fill={Colors.textSecondary} fontSize={11} textAnchor="end">
            {formatDate(last.date)}
          </SvgText>
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  placeholder: {
    height: HEIGHT,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
});
