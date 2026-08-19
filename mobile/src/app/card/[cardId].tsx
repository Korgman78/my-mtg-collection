// Fiche carte : visuel, prix courant, statistiques 30 j, historique,
// puis les actions qu'on peut mener sur cette carte.

import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CreateRuleModal } from '@/components/create-rule-modal';
import { PriceChart } from '@/components/price-chart';
import {
  AppBar,
  AppText,
  Button,
  ChangeBadge,
  ConfirmDialog,
  Divider,
  ErrorState,
  FinishBadge,
  Pill,
  Screen,
  SectionHeader,
  Skeleton,
  Stepper,
  Surface,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { useCardDetail, useDeleteItem, useSetItemQuantity } from '@/lib/collection';
import { formatDate, formatEur } from '@/lib/format';
import { goBack } from '@/lib/nav';
import { priceForFinish, type Finish } from '@/lib/types';

export default function CardScreen() {
  const { cardId, itemId } = useLocalSearchParams<{ cardId: string; itemId?: string }>();
  const { data, error, isLoading, refetch } = useCardDetail(cardId, itemId);
  const deleteItem = useDeleteItem();
  const setQuantity = useSetItemQuantity();
  const [alerting, setAlerting] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (isLoading) return <CardSkeleton onBack={() => goBack('/')} />;
  if (!data) return <ErrorState detail={error?.message} onRetry={() => refetch()} />;
  const { card, snapshots, stats, item } = data;
  const finish: Finish = item?.finish ?? 'nonfoil';
  const isFoil = finish !== 'nonfoil';

  const points = snapshots
    .map((s) => ({ date: s.snapped_on, value: priceForFinish(s, finish) }))
    .filter((p): p is { date: string; value: number } => p.value !== null);

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
      <AppBar
        title={card.name}
        subtitle={`${card.set_code.toUpperCase()} · #${card.collector_number}${card.rarity ? ` · ${card.rarity}` : ''}`}
        onBack={() => goBack('/')}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.artWrap}>
          <Image
            source={{ uri: card.image_normal ?? card.image_small ?? undefined }}
            style={styles.art}
            contentFit="contain"
            transition={220}
          />
        </View>

        {item ? (
          <View style={styles.badges}>
            <FinishBadge finish={item.finish} />
            <Pill label={`×${item.quantity}`} />
          </View>
        ) : null}

        {item ? (
          <Surface style={styles.copies}>
            <View style={{ gap: 2, flex: 1 }}>
              <AppText variant="overline">Exemplaires</AppText>
              <AppText variant="caption">
                {currentPrice !== null
                  ? `${formatEur(currentPrice * item.quantity)} au total`
                  : 'Prix inconnu pour l’instant'}
              </AppText>
            </View>
            <Stepper
              value={item.quantity}
              onChange={(quantity) => setQuantity.mutate({ itemId: item.id, quantity })}
            />
          </Surface>
        ) : null}

        <Surface style={styles.priceCard}>
          <View style={styles.priceMain}>
            <View style={{ gap: 2 }}>
              <AppText variant="overline">Prix actuel{isFoil ? ' · foil' : ''}</AppText>
              <AppText variant="display">{formatEur(currentPrice)}</AppText>
              {stats ? <AppText variant="caption">au {formatDate(stats.latest_date)}</AppText> : null}
            </View>
            <View style={styles.change7}>
              <ChangeBadge pct={change7 ?? null} />
              <AppText variant="caption">7 jours</AppText>
            </View>
          </View>

          <Divider />

          <View style={styles.statsGrid}>
            <StatCell label="Moyenne 30 j" value={formatEur(avg ?? null)} />
            <StatCell
              label="Couloir 30 j"
              value={band ? `${formatEur(band.low)} – ${formatEur(band.high)}` : '—'}
            />
            <StatCell
              label="Variation 30 j"
              value={
                change30 != null
                  ? `${change30 > 0 ? '+' : ''}${change30.toFixed(1).replace('.', ',')} %`
                  : '—'
              }
              color={change30 != null && change30 !== 0 ? (change30 > 0 ? Colors.up : Colors.down) : undefined}
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

        <View style={{ gap: Space.md }}>
          <SectionHeader title="Historique" />
          <PriceChart points={points} band={band} />
        </View>

        <View style={{ gap: Space.md }}>
          <SectionHeader title="Actions" />
          <Button
            label="Créer une alerte sur cette carte"
            icon="bell"
            variant="secondary"
            onPress={() => setAlerting(true)}
          />
          {item ? (
            <Button
              label="Retirer du dossier"
              icon="trash"
              variant="danger"
              onPress={() => setRemoving(true)}
              loading={deleteItem.isPending}
            />
          ) : null}
        </View>

        <AppText variant="caption" style={styles.attribution}>
          Prix Cardmarket (EUR) · Powered by Scryfall
        </AppText>
      </ScrollView>

      <CreateRuleModal
        visible={alerting}
        onClose={() => setAlerting(false)}
        preset={{ cardId: card.id, cardName: card.name, finish }}
      />

      <ConfirmDialog
        visible={removing}
        title={`Retirer « ${card.name} » ?`}
        message="La carte est retirée de ce dossier. Son historique de prix est conservé."
        confirmLabel="Retirer la carte"
        loading={deleteItem.isPending}
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          const id = item?.id;
          if (!id) return;
          deleteItem.mutate(id, {
            onSuccess: () => goBack('/'),
            onSettled: () => setRemoving(false),
          });
        }}
      />
    </Screen>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.statCell}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant="price" style={color ? { color } : undefined}>
        {value}
      </AppText>
    </View>
  );
}

/** Squelette d'une fiche carte.
 *
 *  L'illustration est le bloc coûteux : 64 % de la largeur au rapport 63:88.
 *  La réserver évite que la page entière se recompose quand l'image arrive. */
function CardSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <Screen>
      <AppBar title="Carte" onBack={onBack} />

      <View style={styles.content}>
        <View style={styles.artWrap}>
          <Skeleton style={styles.art} radius={Radius.lg} />
        </View>

        <Surface style={styles.priceCard}>
          <View style={styles.priceMain}>
            <View style={{ gap: Space.sm }}>
              <Skeleton width={92} height={9} />
              <Skeleton width={124} height={26} radius={Radius.md} />
            </View>
            <Skeleton width={58} height={22} radius={Radius.pill} />
          </View>

          <View style={styles.statsGrid}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.statCell}>
                <Skeleton width={78} height={9} />
                <Skeleton width={62} height={14} style={{ marginTop: Space.xs }} />
              </View>
            ))}
          </View>
        </Surface>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxxl,
    gap: Space.xl,
  },
  artWrap: { alignItems: 'center' },
  art: {
    width: '64%',
    maxWidth: 300,
    aspectRatio: 63 / 88,
    borderRadius: Radius.lg,
  },
  badges: { flexDirection: 'row', justifyContent: 'center', gap: Space.sm },
  copies: { flexDirection: 'row', alignItems: 'center', gap: Space.md },

  priceCard: { gap: Space.lg },
  priceMain: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  change7: { alignItems: 'flex-end', gap: Space.xs },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space.lg, columnGap: Space.md },
  statCell: { minWidth: '45%', flexGrow: 1, gap: 2 },

  attribution: { textAlign: 'center', color: Colors.textTertiary },
});
