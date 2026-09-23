// Briques visuelles du cube builder : pastilles de couleur, coût de mana,
// barres de répartition, courbe de mana, vignette de carte.
//
// Règle tenue par tous les graphiques de ce fichier : la couleur n'est
// jamais seule à porter l'identité. Les pigments de mana se confondent pour
// un œil daltonien (bleu et noir, incolore et terrain — mesuré) : chaque
// barre porte donc son libellé écrit, et chaque valeur son chiffre.

import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppText } from '@/components/ui';
import { Colors, Fonts, Radius, Space } from '@/constants/theme';
import {
  CMC_BUCKETS,
  cmcLabel,
  SECTION_COLORS,
  type Section,
} from '@/lib/cube-stats';
import type { CardRow, ManaColor } from '@/lib/types';

/** Pastille d'une couleur de mana, lettre comprise. */
export function ColorPip({ color, size = 18 }: { color: Section; size?: number }) {
  const light = color === 'W' || color === 'M';
  return (
    <View
      style={[
        styles.pip,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: SECTION_COLORS[color] },
      ]}>
      <Text
        style={[
          styles.pipText,
          { fontSize: size * 0.55, color: light ? Colors.onAccent : Colors.bg },
        ]}>
        {color}
      </Text>
    </View>
  );
}

export function ColorPips({ colors, size = 16 }: { colors: readonly ManaColor[]; size?: number }) {
  if (colors.length === 0) return <ColorPip color="C" size={size} />;
  return (
    <View style={styles.pips}>
      {colors.map((c) => (
        <ColorPip key={c} color={c} size={size} />
      ))}
    </View>
  );
}

/** Coût de mana lisible : « {2}{W}{U} » devient « 2 W U » en pastilles. */
export function ManaCost({ cost, size = 15 }: { cost: string | null | undefined; size?: number }) {
  if (!cost) return null;
  const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return (
    <View style={styles.pips}>
      {symbols.map((s, i) =>
        /^[WUBRG]$/.test(s) ? (
          <ColorPip key={i} color={s as ManaColor} size={size} />
        ) : (
          <View
            key={i}
            style={[styles.pip, styles.genericPip, { width: size, height: size, borderRadius: size / 2 }]}>
            <Text style={[styles.pipText, { fontSize: size * 0.55, color: Colors.text }]}>
              {s.replace('/', '')}
            </Text>
          </View>
        )
      )}
    </View>
  );
}

/** Une ligne de répartition : libellé, barre, valeur. La barre est à
 *  l'échelle du maximum de la série, pas du total — sinon toutes les
 *  barres d'un cube équilibré seraient également minuscules. */
export function BarRow({
  label,
  value,
  max,
  color = Colors.accent,
  lead,
  note,
  onPress,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
  lead?: ReactNode;
  note?: string;
  onPress?: () => void;
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  const body = (
    <View style={styles.barRow}>
      <View style={styles.barLabel}>
        {lead}
        <AppText variant="caption" numberOfLines={1} style={{ color: Colors.text, flexShrink: 1 }}>
          {label}
        </AppText>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <View style={styles.barValue}>
        <AppText variant="caption" style={styles.barNumber}>
          {value}
        </AppText>
        {note ? <AppText variant="caption">{note}</AppText> : null}
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} : ${value}`}
      onPress={onPress}
      style={({ pressed }) => pressed && { opacity: 0.6 }}>
      {body}
    </Pressable>
  );
}

/** Courbe de mana : une colonne par coût, chiffre au-dessus. Huit colonnes
 *  seulement, on peut se permettre d'écrire chaque valeur — c'est même ce
 *  qu'on vient lire. */
export function CurveChart({
  curve,
  color = Colors.accent,
  height = 96,
  onPressBucket,
}: {
  curve: number[];
  color?: string;
  height?: number;
  onPressBucket?: (bucket: number) => void;
}) {
  const max = Math.max(1, ...curve);
  return (
    <View style={styles.curve}>
      {CMC_BUCKETS.map((b) => {
        const v = curve[b] ?? 0;
        return (
          <Pressable
            key={b}
            disabled={!onPressBucket}
            accessibilityRole={onPressBucket ? 'button' : undefined}
            accessibilityLabel={`Coût ${cmcLabel(b)} : ${v} cartes`}
            onPress={() => onPressBucket?.(b)}
            style={styles.curveCol}>
            <AppText variant="caption" style={styles.curveCount}>
              {v}
            </AppText>
            <View style={[styles.curveSlot, { height }]}>
              <View
                style={[
                  styles.curveBar,
                  { height: v > 0 ? Math.max(3, (v / max) * height) : 0, backgroundColor: color },
                ]}
              />
            </View>
            <AppText variant="caption" style={styles.curveAxis}>
              {cmcLabel(b)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Vignette d'une carte du cube, pour la grille. */
export function CubeCardTile({
  card,
  onPress,
  badge,
}: {
  card: CardRow;
  onPress: () => void;
  badge?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={card.name}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}>
      <Image
        source={{ uri: card.image_small ?? card.image_normal ?? undefined }}
        style={styles.tileImage}
        contentFit="cover"
        transition={120}
        recyclingKey={card.id}
      />
      {badge ? (
        <View style={styles.tileBadge}>
          <Text style={styles.tileBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pips: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  pip: { alignItems: 'center', justifyContent: 'center' },
  genericPip: { backgroundColor: Colors.borderStrong },
  pipText: { fontWeight: '800', fontFamily: Fonts?.sans, includeFontPadding: false },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 26 },
  barLabel: { width: 108, flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  barTrack: {
    flex: 1,
    height: 10,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  barValue: { minWidth: 44, flexDirection: 'row', gap: 4, justifyContent: 'flex-end' },
  barNumber: { color: Colors.text, fontVariant: ['tabular-nums'], fontWeight: '600' },

  curve: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  curveCol: { flex: 1, alignItems: 'center', gap: 4 },
  curveCount: { color: Colors.text, fontVariant: ['tabular-nums'], fontWeight: '600' },
  curveSlot: {
    width: '100%',
    justifyContent: 'flex-end',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderStrong,
  },
  curveBar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  curveAxis: { fontVariant: ['tabular-nums'] },

  tile: { flex: 1, aspectRatio: 488 / 680, borderRadius: Radius.md, overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%', backgroundColor: Colors.surfaceAlt },
  tileBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: Colors.accent,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tileBadgeText: { color: Colors.onAccent, fontSize: 10, fontWeight: '800' },
});
