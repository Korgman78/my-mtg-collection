// Écran Alertes : règles configurées + fil des événements déclenchés.
// Marque les événements comme lus à l'ouverture (badge de l'onglet).

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, View } from 'react-native';

import { CreateRuleModal } from '@/components/create-rule-modal';
import {
  AppBar,
  AppText,
  Button,
  ChangeBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Screen,
  SectionHeader,
  Skeleton,
  Surface,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import {
  describeRule,
  useAlerts,
  useDeleteRule,
  useMarkAlertsSeen,
  useToggleRule,
  type AlertEvent,
  type AlertRule,
} from '@/lib/alerts';
import { formatDate, formatEur } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Folder } from '@/lib/types';

export default function AlertsScreen() {
  const router = useRouter();
  const { data, error, isLoading, refetch, isRefetching } = useAlerts();
  const toggleRule = useToggleRule();
  const deleteRule = useDeleteRule();
  const markSeen = useMarkAlertsSeen();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AlertRule | null>(null);
  const folderNames = useAlertFolderNames();

  // Marque tout comme lu dès l'ouverture de l'écran.
  useEffect(() => {
    markSeen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) return <AlertsSkeleton />;
  if (!data) return <ErrorState detail={error?.message} onRetry={() => refetch()} />;

  return (
    <Screen>
      <AppBar
        title="Alertes"
        subtitle={`${data.rules.length} règle${data.rules.length > 1 ? 's' : ''} · ${data.events.length} événement${data.events.length > 1 ? 's' : ''}`}
        right={
          <Button
            label="Nouvelle"
            icon="plus"
            size="sm"
            variant="secondary"
            onPress={() => setCreating(true)}
          />
        }
      />

      <FlatList
        data={data.events}
        keyExtractor={(ev) => ev.id}
        contentContainerStyle={styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <SectionHeader title="Mes règles" />
            {data.rules.length === 0 ? (
              <Surface style={styles.hintCard}>
                <AppText variant="body" style={{ color: Colors.textSecondary }}>
                  Aucune règle pour l&apos;instant. Une règle surveille un prix et te prévient
                  quand il bouge : variation en pourcentage, sortie du couloir habituel, ou
                  franchissement d&apos;un seuil.
                </AppText>
                <Button
                  label="Créer ma première règle"
                  icon="plus"
                  onPress={() => setCreating(true)}
                />
              </Surface>
            ) : (
              <View style={{ gap: Space.sm }}>
                {data.rules.map((rule) => (
                  <RuleCard
                    key={rule.id}
                    rule={rule}
                    folderNames={folderNames}
                    onToggle={(enabled) => toggleRule.mutate({ id: rule.id, enabled })}
                    onDelete={() => setPendingDelete(rule)}
                  />
                ))}
              </View>
            )}

            <SectionHeader title="Activité" />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="chart"
            title="Rien à signaler"
            hint="Les mouvements de prix correspondant à tes règles apparaîtront ici. L'évaluation tourne chaque nuit, après l'ingestion des prix."
          />
        }
        renderItem={({ item }) => (
          <EventRow
            event={item}
            onPress={() =>
              router.push({ pathname: '/card/[cardId]', params: { cardId: item.card_id } })
            }
          />
        )}
      />

      <CreateRuleModal visible={creating} onClose={() => setCreating(false)} />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title="Supprimer cette alerte ?"
        message={
          pendingDelete
            ? describeRule(pendingDelete, folderNames[pendingDelete.folder_id ?? ''])
            : undefined
        }
        confirmLabel="Supprimer la règle"
        loading={deleteRule.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const id = pendingDelete?.id;
          if (!id) return;
          deleteRule.mutate(id, { onSettled: () => setPendingDelete(null) });
        }}
      />
    </Screen>
  );
}

function RuleCard({
  rule,
  folderNames,
  onToggle,
  onDelete,
}: {
  rule: AlertRule;
  folderNames: Record<string, string>;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}) {
  const title = rule.name ?? ruleTitle(rule, folderNames);
  return (
    <Surface style={styles.ruleCard}>
      <View style={styles.ruleBody}>
        <AppText variant="heading" numberOfLines={1} style={!rule.enabled && styles.ruleMuted}>
          {title}
        </AppText>
        <AppText variant="caption" numberOfLines={2}>
          {describeRule(rule, folderNames[rule.folder_id ?? ''], rule.name ?? undefined)}
        </AppText>
      </View>

      <View style={styles.ruleActions}>
        <Switch
          value={rule.enabled}
          onValueChange={onToggle}
          accessibilityLabel={`Activer la règle ${title}`}
          trackColor={{ false: Colors.surfaceHover, true: Colors.accentSoft }}
          thumbColor={rule.enabled ? Colors.accent : Colors.textTertiary}
        />
        <IconButton
          name="trash"
          label={`Supprimer la règle ${title}`}
          onPress={onDelete}
          variant="danger"
          size="sm"
        />
      </View>
    </Surface>
  );
}

function EventRow({ event, onPress }: { event: AlertEvent; onPress: () => void }) {
  const card = event.card;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir ${card?.name ?? 'la carte'}`}
      onPress={onPress}
      style={({ pressed }) => [styles.eventRow, pressed && styles.rowPressed]}>
      <Image
        source={{ uri: card?.image_small ?? undefined }}
        style={styles.thumb}
        contentFit="cover"
        transition={150}
      />
      <View style={styles.eventBody}>
        <AppText variant="heading" numberOfLines={1}>
          {card?.name ?? 'Carte'}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {describeEvent(event)} · {formatDate(event.triggered_on)}
        </AppText>
      </View>
      <View style={styles.eventRight}>
        <AppText variant="price">{formatEur(event.price_now)}</AppText>
        {event.metric === 'pct_change' ? (
          <ChangeBadge pct={event.change_pct} size="sm" />
        ) : (
          <AppText
            variant="caption"
            style={{ color: event.direction === 'up' ? Colors.up : Colors.down, fontWeight: '600' }}>
            {event.direction === 'up' ? 'hausse' : 'baisse'}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

function ruleTitle(rule: AlertRule, folderNames: Record<string, string>): string {
  if (rule.scope === 'collection') return 'Toute la collection';
  if (rule.scope === 'folder') return folderNames[rule.folder_id ?? ''] ?? 'Dossier';
  return 'Carte';
}

function describeEvent(ev: AlertEvent): string {
  if (ev.metric === 'corridor_breakout')
    return ev.direction === 'up' ? 'sortie du couloir (haut)' : 'sortie du couloir (bas)';
  if (ev.metric === 'threshold_above') return 'seuil franchi';
  if (ev.metric === 'threshold_below') return 'passé sous le seuil';
  return ev.direction === 'up' ? 'en hausse' : 'en baisse';
}

/** Table id → nom de dossier, pour décrire les règles à portée dossier. */
function useAlertFolderNames(): Record<string, string> {
  const [folders, setFolders] = useState<Pick<Folder, 'id' | 'name'>[]>([]);
  useEffect(() => {
    supabase
      .from('folders')
      .select('id, name')
      .then(({ data }) => setFolders((data as Pick<Folder, 'id' | 'name'>[]) ?? []));
  }, []);
  return useMemo(() => Object.fromEntries(folders.map((f) => [f.id, f.name])), [folders]);
}

/** Squelette des alertes : les règles, puis le fil d'activité.
 *
 *  Deux rubriques, comme à l'arrivée — c'est la structure de l'écran qui
 *  renseigne, bien plus que le nombre exact de lignes réservées. */
function AlertsSkeleton() {
  return (
    <Screen>
      <AppBar title="Alertes" />

      <View style={styles.list}>
        <View style={styles.headerBlock}>
          <SectionHeader title="Mes règles" />
          <View style={{ gap: Space.sm }}>
            {[0, 1].map((i) => (
              <Surface key={i} padded={false} style={styles.ruleCard}>
                <View style={styles.ruleBody}>
                  <Skeleton width="58%" height={13} />
                  <Skeleton width="80%" height={10} />
                </View>
                <Skeleton width={38} height={22} radius={Radius.pill} />
              </Surface>
            ))}
          </View>

          <SectionHeader title="Activité" />
        </View>

        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.eventRow}>
            <Skeleton width={40} height={56} radius={Radius.sm} />
            <View style={styles.eventBody}>
              <Skeleton width="66%" height={13} />
              <Skeleton width="42%" height={10} />
            </View>
            <View style={styles.eventRight}>
              <Skeleton width={52} height={13} />
              <Skeleton width={34} height={10} />
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Space.lg, paddingBottom: Space.xxl, gap: Space.sm, flexGrow: 1 },
  headerBlock: { gap: Space.md, marginBottom: Space.xs },
  hintCard: { gap: Space.lg },

  ruleCard: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.lg },
  ruleBody: { flex: 1, gap: 2 },
  ruleMuted: { color: Colors.textSecondary },
  ruleActions: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },

  eventRow: {
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
  thumb: { width: 40, height: 56, borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt },
  eventBody: { flex: 1, gap: 2 },
  eventRight: { alignItems: 'flex-end', gap: Space.xs },
});
