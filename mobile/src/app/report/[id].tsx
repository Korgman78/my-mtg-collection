// Un récap hebdomadaire, tel qu'il a été figé.
//
// Rien n'est recalculé ici : les chiffres affichés sont ceux que le job a
// observés le jour de la fabrication. C'est ce qui permet de rouvrir le
// rapport d'il y a deux mois et d'y lire la même chose qu'à sa parution.

import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppBar,
  AppText,
  ChangeBadge,
  EmptyState,
  ErrorState,
  FinishBadge,
  Loading,
  Pill,
  Screen,
  SectionHeader,
  Surface,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { formatDate, formatEur } from '@/lib/format';
import { goBack } from '@/lib/nav';
import {
  reportPeriod,
  useMarkReportSeen,
  useReports,
  type ReportEvent,
  type ReportMover,
} from '@/lib/reports';

export default function ReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, error, isLoading, refetch } = useReports();
  const markSeen = useMarkReportSeen();

  const report = data?.find((r) => r.id === id) ?? null;

  // Ouvrir un rapport vaut lecture. On ne marque qu'une fois, au montage :
  // le `.is('seen_at', null)` de la mutation rend l'appel inoffensif s'il
  // était déjà lu.
  useEffect(() => {
    if (report && !report.seen_at) markSeen.mutate(report.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report?.id]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorState detail={error.message} onRetry={() => refetch()} />;
  if (!report) {
    return (
      <Screen>
        <AppBar title="Récap hebdo" onBack={() => goBack('/alerts')} backLabel="Retour aux alertes" />
        <EmptyState
          icon="chart"
          title="Rapport introuvable"
          hint="Il a peut-être été élagué : seuls les dix derniers sont conservés."
          action={{ label: 'Voir les archives', onPress: () => router.replace('/reports') }}
        />
      </Screen>
    );
  }

  const openCard = (cardId: string) =>
    router.push({ pathname: '/card/[cardId]', params: { cardId } });

  const change = report.value_change_eur;

  return (
    <Screen>
      <AppBar
        title="Récap hebdo"
        subtitle={reportPeriod(report)}
        onBack={() => goBack('/alerts')}
        backLabel="Retour aux alertes"
      />

      <ScrollView contentContainerStyle={styles.content}>
        <Surface tone="plate" style={styles.valueCard}>
          <AppText variant="overline">Valeur de la collection</AppText>
          <AppText variant="display">{formatEur(report.value_eur)}</AppText>
          {change !== null && Math.abs(change) >= 0.01 ? (
            <AppText
              variant="caption"
              style={{ color: change > 0 ? Colors.up : Colors.down, fontWeight: '600' }}>
              {change > 0 ? '+' : '−'}
              {formatEur(Math.abs(change))} sur la semaine
            </AppText>
          ) : (
            <AppText variant="caption">Stable sur la semaine</AppText>
          )}
          <ValueBars values={report.value_history} />
        </Surface>

        <MoverSection
          title="Plus fortes hausses"
          movers={report.risers}
          empty="Aucune hausse retenue cette semaine."
          onPress={openCard}
        />

        <MoverSection
          title="Plus fortes baisses"
          movers={report.fallers}
          empty="Aucune baisse retenue cette semaine."
          onPress={openCard}
        />

        <View style={styles.section}>
          <SectionHeader title="Alertes déclenchées" />
          {report.events.length === 0 ? (
            <AppText variant="caption">
              Aucune de tes règles ne s&apos;est déclenchée cette semaine.
            </AppText>
          ) : (
            report.events.map((event, i) => (
              <EventRow
                key={`${event.card_id}-${event.finish}-${event.triggered_on}-${i}`}
                event={event}
                onPress={() => openCard(event.card_id)}
              />
            ))
          )}
        </View>

        <AppText variant="caption" style={styles.footer}>
          Rapport figé le {formatDate(report.period_end)}. Les mouvements portent sur les cartes
          possédées valant au moins 1 €, en prix unitaire. Prix Cardmarket via Scryfall.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

/** Les huit derniers relevés de valeur, en bâtons.
 *
 *  Pas de dates en abscisse, et c'est volontaire : les relevés sautent les
 *  jours où l'ingestion n'a rien écrit, donc les espacer régulièrement
 *  mentirait sur le temps. Ce qu'on veut lire ici est une pente, pas un
 *  calendrier — la fiche carte porte le vrai graphe daté. */
function ValueBars({ values }: { values: number[] }) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  return (
    <View style={styles.bars} accessibilityLabel={`Évolution sur ${values.length} relevés`}>
      {values.map((v, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: 8 + ((v - min) / span) * 30,
              backgroundColor: i === values.length - 1 ? Colors.accent : Colors.borderStrong,
            },
          ]}
        />
      ))}
    </View>
  );
}

function MoverSection({
  title,
  movers,
  empty,
  onPress,
}: {
  title: string;
  movers: ReportMover[];
  empty: string;
  onPress: (cardId: string) => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      {movers.length === 0 ? (
        <AppText variant="caption">{empty}</AppText>
      ) : (
        movers.map((m, rank) => (
          <MoverRow
            key={`${m.card_id}-${m.finish}`}
            mover={m}
            rank={rank + 1}
            onPress={() => onPress(m.card_id)}
          />
        ))
      )}
    </View>
  );
}

function MoverRow({
  mover,
  rank,
  onPress,
}: {
  mover: ReportMover;
  rank: number;
  onPress: () => void;
}) {
  const up = mover.change_eur > 0;
  return (
    <Row
      onPress={onPress}
      label={`${mover.name}, ${mover.change_pct} %`}
      image={mover.image_small}
      rank={rank}
      title={mover.name}
      subtitle={`${mover.set_code.toUpperCase()} · ${formatEur(mover.price_then)} → ${formatEur(mover.price_now)}${mover.quantity > 1 ? ` · ×${mover.quantity}` : ''}`}
      finish={mover.finish}
      right={
        <>
          <ChangeBadge pct={mover.change_pct} />
          <AppText variant="caption" style={{ color: up ? Colors.up : Colors.down }}>
            {up ? '+' : '−'}
            {formatEur(Math.abs(mover.change_eur))}
          </AppText>
        </>
      }
    />
  );
}

function EventRow({ event, onPress }: { event: ReportEvent; onPress: () => void }) {
  const label =
    event.metric === 'corridor_breakout'
      ? event.direction === 'up'
        ? 'sortie du couloir (haut)'
        : 'sortie du couloir (bas)'
      : event.metric === 'threshold_above'
        ? 'seuil franchi'
        : event.metric === 'threshold_below'
          ? 'passé sous le seuil'
          : event.direction === 'up'
            ? 'en hausse'
            : 'en baisse';

  return (
    <Row
      onPress={onPress}
      label={`${event.name}, ${label}`}
      image={event.image_small}
      title={event.name}
      subtitle={`${label} · ${formatDate(event.triggered_on)}`}
      finish={event.finish}
      right={
        <>
          <AppText variant="price">{formatEur(event.price_now)}</AppText>
          {event.metric === 'pct_change' ? (
            <ChangeBadge pct={event.change_pct} size="sm" />
          ) : (
            <Pill label={event.direction === 'up' ? 'hausse' : 'baisse'} />
          )}
        </>
      }
    />
  );
}

/** Ligne commune aux mouvements et aux alertes : même gabarit, donc même
 *  lecture d'une rubrique à l'autre. */
function Row({
  onPress,
  label,
  image,
  rank,
  title,
  subtitle,
  finish,
  right,
}: {
  onPress: () => void;
  label: string;
  image: string | null;
  rank?: number;
  title: string;
  subtitle: string;
  finish: string;
  right: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}>
        {rank !== undefined ? (
          <AppText variant="caption" style={styles.rank}>
            {rank}
          </AppText>
        ) : null}
        <Image
          source={{ uri: image ?? undefined }}
          style={styles.thumb}
          contentFit="cover"
          transition={120}
        />
        <View style={styles.body}>
          <AppText variant="heading" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {subtitle}
          </AppText>
          <FinishBadge finish={finish} />
        </View>
        <View style={styles.right}>{right}</View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Space.lg, paddingBottom: Space.xxxl, gap: Space.xl },
  valueCard: { gap: Space.xs, alignItems: 'flex-start', paddingVertical: Space.xl },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 40, marginTop: Space.md },
  bar: { width: 10, borderRadius: 2 },

  section: { gap: Space.sm },
  row: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  rowMain: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.md },
  rowPressed: { backgroundColor: Colors.surfaceHover },
  rank: {
    minWidth: 14,
    textAlign: 'center',
    color: Colors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
  thumb: { width: 34, height: 47, borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt },
  body: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', gap: Space.xs },
  footer: { color: Colors.textTertiary },
});
