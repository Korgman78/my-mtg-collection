// Fiche carte : image, prix actuels, stats 30 j (moyenne, couloir), graphe.

import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PriceChart } from '@/components/price-chart';
import { AppText, ChangeBadge, FinishBadge, Loading, Screen, Surface } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useCardDetail } from '@/lib/collection';
import { formatDate, formatEur } from '@/lib/format';
import { priceForFinish, type Finish } from '@/lib/types';

export default function CardScreen() {
  const { cardId, itemId } = useLocalSearchParams<{ cardId: string; itemId?: string }>();
  const router = useRouter();
  const { data, isLoading } = useCardDetail(cardId, itemId);

  if (isLoading || !data) return <Loading />;
  const { card, snapshots, stats, item } = data;
  const finish: Finish = item?.finish ?? 'nonfoil';

  const points = snapshots
    .map((s) => ({ date: s.snapped_on, value: priceForFinish(s, finish) }))
    .filter((p): p is { date: string; value: number } => p.value !== null);

  const isFoil = finish !== 'nonfoil';
  const band =
    stats && !isFoil && stats.p10_eur_30d !== null && stats.p90_eur_30d !== null
      ? { low: stats.p10_eur_30d, high: stats.p90_eur_30d }
      : stats && isFoil && stats.p10_eur_foil_30d !== null && stats.p90_eur_foil_30d !== null
        ? { low: stats.p10_eur_foil_30d, high: stats.p90_eur_foil_30d }
        : null;

  const currentPrice = stats ? priceForFinish(stats, finish) : null;
  const avg = isFoil ? stats?.avg_eur_foil_30d : stats?.avg_eur_30d;
  const change7 = isFoil ? stats?.change_7d_pct_foil : stats?.change_7d_pct;
  const change30 = isFoil ? stats?.change_30d_pct_foil : stats?.change_30d_pct;
  const gain =
    item?.purchase_price_eur != null && currentPrice !== null
      ? (currentPrice - item.purchase_price_eur) * item.quantity
      : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <AppText style={styles.back}>‹</AppText>
          </Pressable>
        </View>

        <Image
          source={{ uri: card.image_normal ?? card.image_small ?? undefined }}
          style={styles.cardImage}
          contentFit="contain"
          transition={250}
        />

        <View style={styles.titleBlock}>
          <AppText variant="heading" style={{ textAlign: 'center' }}>
            {card.name}
          </AppText>
          <AppText variant="small">
            {card.set_code.toUpperCase()} · #{card.collector_number}
            {card.rarity ? ` · ${card.rarity}` : ''}
          </AppText>
          {item ? (
            <View style={styles.badges}>
              <FinishBadge finish={item.finish} />
              {item.quantity > 1 ? <AppText variant="small">×{item.quantity}</AppText> : null}
            </View>
          ) : null}
        </View>

        <Surface style={styles.priceCard}>
          <View style={styles.priceMain}>
            <View>
              <AppText variant="secondary">Prix actuel{isFoil ? ' (foil)' : ''}</AppText>
              <AppText style={styles.bigPrice}>{formatEur(currentPrice)}</AppText>
              {stats ? <AppText variant="small">au {formatDate(stats.latest_date)}</AppText> : null}
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <ChangeBadge pct={change7 ?? null} />
              <AppText variant="small">7 jours</AppText>
            </View>
          </View>

          <View style={styles.statsGrid}>
            <StatCell label="Moyenne 30 j" value={formatEur(avg ?? null)} />
            <StatCell
              label="Couloir 30 j"
              value={band ? `${formatEur(band.low)} – ${formatEur(band.high)}` : '—'}
            />
            <StatCell
              label="Variation 30 j"
              value={change30 != null ? `${change30 > 0 ? '+' : ''}${change30.toFixed(1).replace('.', ',')} %` : '—'}
              color={change30 != null ? (change30 > 0 ? Colors.up : change30 < 0 ? Colors.down : undefined) : undefined}
            />
            {gain !== null ? (
              <StatCell
                label="Plus-value"
                value={formatEur(gain)}
                color={gain >= 0 ? Colors.up : Colors.down}
              />
            ) : null}
          </View>
        </Surface>

        <PriceChart points={points} band={band} />

        <AppText variant="small" style={{ textAlign: 'center' }}>
          Prix Cardmarket (EUR) · Powered by Scryfall
        </AppText>
      </ScrollView>
    </Screen>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statCell}>
      <AppText variant="small">{label}</AppText>
      <AppText variant="price" style={color ? { color, fontSize: 15 } : { fontSize: 15 }}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  header: { flexDirection: 'row' },
  back: { fontSize: 34, color: Colors.textSecondary, lineHeight: 38 },
  cardImage: {
    width: '70%',
    aspectRatio: 63 / 88,
    alignSelf: 'center',
    borderRadius: Radius.md,
  },
  titleBlock: { alignItems: 'center', gap: 4 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginTop: 2 },
  priceCard: { gap: Spacing.three },
  priceMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  bigPrice: {
    fontSize: 34,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Spacing.three,
  },
  statCell: { minWidth: '44%', gap: 2 },
});
