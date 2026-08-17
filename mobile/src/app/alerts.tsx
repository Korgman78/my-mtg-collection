// Écran Alertes : fil d'événements déclenchés + liste des règles configurées.
// Marque les événements comme lus à l'ouverture (badge du dashboard).

import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, View } from 'react-native';

import { CreateRuleModal } from '@/components/create-rule-modal';
import { AppText, ChangeBadge, EmptyState, Loading, Screen, Surface } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
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
  const { data, isLoading, refetch, isRefetching } = useAlerts();
  const toggleRule = useToggleRule();
  const deleteRule = useDeleteRule();
  const markSeen = useMarkAlertsSeen();
  const [creating, setCreating] = useState(false);

  // Marque tout comme lu dès l'ouverture de l'écran.
  useEffect(() => {
    markSeen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const folderNames = useAlertFolderNames();

  if (isLoading || !data) return <Loading />;

  function confirmDelete(rule: AlertRule) {
    Alert.alert('Supprimer cette alerte ?', describeRule(rule, folderNames[rule.folder_id ?? '']), [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteRule.mutate(rule.id) },
    ]);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <AppText style={styles.back}>‹</AppText>
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="heading">Alertes</AppText>
          <AppText variant="small">
            {data.rules.length} règle{data.rules.length > 1 ? 's' : ''} · {data.events.length} événement
            {data.events.length > 1 ? 's' : ''}
          </AppText>
        </View>
        <Pressable onPress={() => setCreating(true)} style={styles.addButton} hitSlop={8}>
          <AppText style={{ color: Colors.bg, fontWeight: '700', fontSize: 22, lineHeight: 26 }}>＋</AppText>
        </Pressable>
      </View>

      <FlatList
        data={data.events}
        keyExtractor={(ev) => ev.id}
        contentContainerStyle={styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View style={{ gap: Spacing.two, marginBottom: Spacing.three }}>
            <AppText variant="heading" style={styles.sectionTitle}>
              Mes règles
            </AppText>
            {data.rules.length === 0 ? (
              <Surface>
                <AppText variant="secondary">
                  Aucune règle. Appuie sur ＋ pour surveiller les mouvements de prix de ta collection.
                </AppText>
              </Surface>
            ) : (
              data.rules.map((rule) => (
                <Pressable key={rule.id} onLongPress={() => confirmDelete(rule)}>
                  <Surface style={styles.ruleCard}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="body" style={{ fontWeight: '600' }} numberOfLines={1}>
                        {rule.name ?? ruleTitle(rule, folderNames)}
                      </AppText>
                      <AppText variant="small" numberOfLines={2}>
                        {describeRule(rule, folderNames[rule.folder_id ?? ''], rule.name ?? undefined)}
                      </AppText>
                    </View>
                    <Switch
                      value={rule.enabled}
                      onValueChange={(enabled) => toggleRule.mutate({ id: rule.id, enabled })}
                      trackColor={{ false: Colors.surfaceAlt, true: Colors.accentSoft }}
                      thumbColor={rule.enabled ? Colors.accent : Colors.textSecondary}
                    />
                  </Surface>
                </Pressable>
              ))
            )}
            <AppText variant="heading" style={[styles.sectionTitle, { marginTop: Spacing.three }]}>
              Activité
            </AppText>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            glyph="🔔"
            title="Rien à signaler"
            hint="Les mouvements correspondant à tes règles apparaîtront ici après l'évaluation nocturne."
          />
        }
        renderItem={({ item }) => <EventRow event={item} onPress={() => openCard(router, item)} />}
      />

      <CreateRuleModal visible={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}

function EventRow({ event, onPress }: { event: AlertEvent; onPress: () => void }) {
  const card = event.card;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]} onPress={onPress}>
      <Image
        source={{ uri: card?.image_small ?? undefined }}
        style={styles.thumb}
        contentFit="cover"
        transition={150}
      />
      <View style={styles.rowBody}>
        <AppText variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
          {card?.name ?? 'Carte'}
          {event.finish !== 'nonfoil' ? ' ✦' : ''}
        </AppText>
        <AppText variant="small" numberOfLines={1}>
          {describeEvent(event)} · {formatDate(event.triggered_on)}
        </AppText>
      </View>
      <View style={styles.rowRight}>
        <AppText variant="price">{formatEur(event.price_now)}</AppText>
        {event.metric === 'pct_change' ? (
          <ChangeBadge pct={event.change_pct} />
        ) : (
          <AppText
            variant="small"
            style={{ color: event.direction === 'up' ? Colors.up : Colors.down, fontWeight: '700' }}>
            {event.direction === 'up' ? '▲' : '▼'}
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

function openCard(router: ReturnType<typeof useRouter>, event: AlertEvent) {
  router.push({ pathname: '/card/[cardId]', params: { cardId: event.card_id } });
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

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  back: { fontSize: 34, color: Colors.textSecondary, lineHeight: 38, paddingRight: Spacing.one },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  sectionTitle: { marginBottom: Spacing.one },
  ruleCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.two,
  },
  thumb: { width: 44, height: 62, borderRadius: 4, backgroundColor: Colors.surfaceAlt },
  rowBody: { flex: 1, gap: 3 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
});
