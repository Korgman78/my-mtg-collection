// Tendances : ce qui bouge dans la collection, hausses et baisses.
//
// Même matière que le récap hebdomadaire, mais consultable à tout moment et
// sur trois horizons. La maille est la collection entière, pas un dossier :
// on veut savoir ce qui monte chez soi, pas dans un rangement.
//
// Deux classements plutôt qu'un, et ce n'est pas de la redondance : une
// commune qui prend 300 % gagne trois centimes, une mythique qui prend 4 %
// en gagne douze. Le pourcentage dit ce qui s'agite, les euros disent ce qui
// compte. Les deux questions sont légitimes, d'où le sélecteur.

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import {
  AppBar,
  AppText,
  ChangeBadge,
  EmptyState,
  ErrorState,
  FinishBadge,
  Screen,
  SectionHeader,
  Segmented,
  Skeleton,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { usePriceMovers, type MoverOrder, type MoverWindow, type PriceMover } from '@/lib/collection';
import { formatEur } from '@/lib/format';

const WINDOW_LABEL: Record<MoverWindow, string> = {
  3: '3 jours',
  7: '7 jours',
  30: '1 mois',
};

export default function TrendsScreen() {
  const router = useRouter();
  const [windowDays, setWindowDays] = useState<MoverWindow>(7);
  const [order, setOrder] = useState<MoverOrder>('pct');

  const risers = usePriceMovers(windowDays, order, 'up');
  const fallers = usePriceMovers(windowDays, order, 'down');

  const loading = risers.isLoading || fallers.isLoading;
  const refreshing = risers.isRefetching || fallers.isRefetching;
  const empty = (risers.data?.length ?? 0) === 0 && (fallers.data?.length ?? 0) === 0;
  // Une requête en échec n'est pas une absence de mouvement : sans ça,
  // une panne réseau s'annonce « Rien à signaler ».
  const failure = risers.error ?? fallers.error;

  const openCard = (m: PriceMover) =>
    router.push({ pathname: '/card/[cardId]', params: { cardId: m.card_id } });

  // Une seule liste, deux sections : les baisses passent en pied de liste,
  // là où on les cherche.
  const sections = [
    { key: 'up' as const, title: 'Plus fortes hausses', data: risers.data ?? [] },
    { key: 'down' as const, title: 'Plus fortes baisses', data: fallers.data ?? [] },
  ];

  return (
    <Screen>
      <AppBar
        title="Tendances"
        subtitle={`Toute la collection · ${WINDOW_LABEL[windowDays]}`}
      />

      <View style={styles.controls}>
        <Segmented
          options={[
            { value: '3', label: '3 jours' },
            { value: '7', label: '7 jours' },
            { value: '30', label: '1 mois' },
          ]}
          value={String(windowDays) as '3' | '7' | '30'}
          onChange={(v) => setWindowDays(Number(v) as MoverWindow)}
        />
        <Segmented
          options={[
            { value: 'pct', label: 'En %' },
            { value: 'eur', label: 'En €' },
          ]}
          value={order}
          onChange={setOrder}
        />
      </View>

      {loading ? (
        <MoversSkeleton />
      ) : failure ? (
        <ErrorState
          detail={failure.message}
          onRetry={() => {
            risers.refetch();
            fallers.refetch();
          }}
        />
      ) : empty ? (
        <EmptyState
          icon="chart"
          title="Rien à signaler"
          hint="Aucun mouvement de prix mesurable sur cette période. L'historique se construit une nuit à la fois : il faut au moins deux relevés pour comparer quoi que ce soit."
        />
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(s) => s.key}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={() => {
            risers.refetch();
            fallers.refetch();
          }}
          renderItem={({ item: section }) => (
            <View style={{ gap: Space.sm }}>
              <SectionHeader title={section.title} />
              {section.data.length === 0 ? (
                <AppText variant="caption" style={styles.none}>
                  Aucune {section.key === 'up' ? 'hausse' : 'baisse'} sur cette période.
                </AppText>
              ) : (
                section.data.map((mover, rank) => (
                  <MoverRow
                    key={`${mover.card_id}-${mover.finish}`}
                    mover={mover}
                    rank={rank + 1}
                    order={order}
                    onPress={() => openCard(mover)}
                  />
                ))
              )}
            </View>
          )}
        />
      )}
    </Screen>
  );
}

/** Squelette des tendances : deux sections, comme à l'arrivée.
 *
 *  Les contrôles (fenêtre et unité) restent au-dessus et fonctionnent : ils ne
 *  dépendent d'aucune requête, et changer de fenêtre pendant le chargement est
 *  exactement ce qu'on fait quand on trouve le temps long. */
function MoversSkeleton() {
  return (
    <View style={styles.list}>
      {['Plus fortes hausses', 'Plus fortes baisses'].map((title) => (
        <View key={title} style={{ gap: Space.sm }}>
          <SectionHeader title={title} />
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={10} height={10} radius={Radius.pill} />
              <Skeleton width={34} height={47} radius={Radius.sm} />
              <View style={styles.body}>
                <Skeleton width="62%" height={13} />
                <Skeleton width="34%" height={10} />
              </View>
              <View style={styles.figures}>
                <Skeleton width={48} height={13} />
                <Skeleton width={36} height={10} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function MoverRow({
  mover,
  rank,
  order,
  onPress,
}: {
  mover: PriceMover;
  rank: number;
  order: MoverOrder;
  onPress: () => void;
}) {
  const up = mover.change_eur > 0;
  const tone = up ? Colors.up : Colors.down;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${mover.name}, ${mover.change_pct} %, ${formatEur(mover.change_eur)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <AppText variant="caption" style={styles.rank}>
        {rank}
      </AppText>

      <Image
        source={{ uri: mover.image_small ?? undefined }}
        style={styles.thumb}
        contentFit="cover"
        transition={120}
      />

      <View style={styles.body}>
        <AppText variant="heading" numberOfLines={1}>
          {mover.name}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {mover.set_code.toUpperCase()} · {formatEur(mover.price_then)} →{' '}
          {formatEur(mover.price_now)}
          {mover.quantity > 1 ? ` · ×${mover.quantity}` : ''}
        </AppText>
        <FinishBadge finish={mover.finish} />
      </View>

      {/* Le critère de tri est mis en avant, l'autre reste lisible en dessous :
          on ne cache pas la moitié de l'information parce qu'on a choisi un
          classement. */}
      <View style={styles.figures}>
        {order === 'pct' ? (
          <>
            <ChangeBadge pct={mover.change_pct} />
            <AppText variant="caption" style={{ color: tone }}>
              {up ? '+' : '−'}
              {formatEur(Math.abs(mover.change_eur))}
            </AppText>
          </>
        ) : (
          <>
            <AppText variant="price" style={{ color: tone }}>
              {up ? '+' : '−'}
              {formatEur(Math.abs(mover.change_eur))}
            </AppText>
            <ChangeBadge pct={mover.change_pct} size="sm" />
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: Space.lg, paddingBottom: Space.md, gap: Space.sm },
  list: { paddingHorizontal: Space.lg, paddingBottom: Space.xxl, gap: Space.xl, flexGrow: 1 },
  none: { paddingVertical: Space.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surfaceHover },
  rank: {
    minWidth: 16,
    textAlign: 'center',
    color: Colors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
  thumb: { width: 34, height: 47, borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt },
  body: { flex: 1, gap: 2 },
  figures: { alignItems: 'flex-end', gap: Space.xs },
});
