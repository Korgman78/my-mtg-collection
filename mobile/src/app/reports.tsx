// Archives des récaps hebdomadaires.
//
// Le dernier rapport vit en tête de l'onglet Alertes ; celui-ci donne accès
// aux précédents. La base n'en conserve que dix par utilisateur — l'écran le
// dit, pour qu'une archive qui ne remonte pas plus loin ne passe pas pour une
// perte de données.

import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icons';
import {
  AppBar,
  AppText,
  EmptyState,
  ErrorState,
  Pill,
  Screen,
  Skeleton,
  Surface,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { formatEur } from '@/lib/format';
import { goBack } from '@/lib/nav';
import { REPORT_RETENTION, reportPeriod, reportSummary, useReports, type WeeklyReport } from '@/lib/reports';

export default function ReportsScreen() {
  const router = useRouter();
  const { data, error, isLoading, refetch, isRefetching } = useReports();

  const open = (report: WeeklyReport) =>
    router.push({ pathname: '/report/[id]', params: { id: report.id } });

  return (
    <Screen>
      <AppBar
        title="Archives"
        subtitle={
          data && data.length > 0
            ? `${data.length} rapport${data.length > 1 ? 's' : ''} conservé${data.length > 1 ? 's' : ''}`
            : undefined
        }
        onBack={() => goBack('/alerts')}
        backLabel="Retour aux alertes"
      />

      {isLoading ? (
        <ArchiveSkeleton />
      ) : error ? (
        <ErrorState detail={error.message} onRetry={() => refetch()} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          refreshing={isRefetching}
          onRefresh={refetch}
          ListEmptyComponent={
            <EmptyState
              icon="chart"
              title="Aucun rapport pour l'instant"
              hint="Le récap est fabriqué chaque dimanche. Le premier apparaîtra après le prochain passage."
            />
          }
          ListFooterComponent={
            (data?.length ?? 0) > 0 ? (
              <AppText variant="caption" style={styles.footer}>
                Les {REPORT_RETENTION} derniers rapports sont conservés. Au-delà, les plus anciens
                sont retirés à la fabrication du suivant.
              </AppText>
            ) : null
          }
          renderItem={({ item }) => <ReportRow report={item} onPress={() => open(item)} />}
        />
      )}
    </Screen>
  );
}

function ReportRow({ report, onPress }: { report: WeeklyReport; onPress: () => void }) {
  const change = report.value_change_eur;
  const up = change !== null && change > 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir le récap du ${reportPeriod(report)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <AppText variant="heading" numberOfLines={1}>
            {reportPeriod(report)}
          </AppText>
          {report.seen_at === null ? <Pill label="Nouveau" tone="accent" /> : null}
        </View>
        <AppText variant="caption" numberOfLines={1}>
          {reportSummary(report)}
        </AppText>
      </View>

      <View style={styles.figures}>
        <AppText variant="price">{formatEur(report.value_eur)}</AppText>
        {change !== null && Math.abs(change) >= 0.01 ? (
          <AppText variant="caption" style={{ color: up ? Colors.up : Colors.down }}>
            {up ? '+' : '−'}
            {formatEur(Math.abs(change))}
          </AppText>
        ) : null}
      </View>

      <Icon name="chevronRight" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

function ArchiveSkeleton() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3].map((i) => (
        <Surface key={i} padded={false} style={styles.row}>
          <View style={styles.body}>
            <Skeleton width="46%" height={14} />
            <Skeleton width="62%" height={10} />
          </View>
          <View style={styles.figures}>
            <Skeleton width={58} height={14} />
            <Skeleton width={40} height={10} />
          </View>
        </Surface>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Space.lg, paddingBottom: Space.xxl, gap: Space.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surfaceHover },
  body: { flex: 1, gap: 3 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  figures: { alignItems: 'flex-end', gap: Space.xs },
  footer: { color: Colors.textTertiary, paddingTop: Space.md },
});
