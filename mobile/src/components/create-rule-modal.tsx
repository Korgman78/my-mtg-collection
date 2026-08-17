// Création d'une règle d'alerte. Utilisé depuis l'écran Alertes (portée
// collection/dossier) et depuis la fiche carte (portée carte, pré-remplie).

import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText, Button, TextField } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useCreateRule, type AlertMetric } from '@/lib/alerts';
import { supabase } from '@/lib/supabase';
import type { Finish, Folder } from '@/lib/types';

type Preset = { cardId: string; cardName: string; finish: Finish };

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.choiceRow}>
      {options.map((opt) => (
        <Pressable
          key={opt.value}
          onPress={() => onChange(opt.value)}
          style={[styles.choice, value === opt.value && styles.choiceSelected]}>
          <AppText
            variant="small"
            style={{
              fontWeight: '600',
              textAlign: 'center',
              color: value === opt.value ? Colors.text : Colors.textSecondary,
            }}>
            {opt.label}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: Spacing.one }}>
      <AppText variant="small" style={{ fontWeight: '600' }}>
        {label}
      </AppText>
      {children}
    </View>
  );
}

export function CreateRuleModal({
  visible,
  onClose,
  preset,
}: {
  visible: boolean;
  onClose: () => void;
  preset?: Preset;
}) {
  const createRule = useCreateRule();
  const [scope, setScope] = useState<'collection' | 'folder'>('collection');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [metric, setMetric] = useState<AlertMetric>('pct_change');
  const [windowDays, setWindowDays] = useState<1 | 7 | 30>(7);
  const [direction, setDirection] = useState<'up' | 'down' | 'both'>('both');
  const [channel, setChannel] = useState<'digest' | 'immediate'>('digest');
  const [threshold, setThreshold] = useState('10');

  const folders = useQuery({
    queryKey: ['collection', 'folders-lite'],
    queryFn: async () => {
      const { data, error } = await supabase.from('folders').select('id, name').order('position');
      if (error) throw new Error(error.message);
      return data as Pick<Folder, 'id' | 'name'>[];
    },
    enabled: visible && !preset,
  });

  const needsThreshold = metric !== 'corridor_breakout';
  const parsedThreshold = Number(threshold.replace(',', '.'));
  const valid = !needsThreshold || (Number.isFinite(parsedThreshold) && parsedThreshold > 0);

  function submit() {
    createRule.mutate(
      {
        name: preset ? preset.cardName : null,
        scope: preset ? 'card' : scope,
        folder_id: !preset && scope === 'folder' ? folderId : null,
        card_id: preset?.cardId ?? null,
        finish: preset?.finish ?? null,
        metric,
        window_days: windowDays,
        threshold: needsThreshold ? parsedThreshold : null,
        direction: metric === 'threshold_above' ? 'up' : metric === 'threshold_below' ? 'down' : direction,
        channel,
      },
      { onSuccess: onClose }
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <ScrollView contentContainerStyle={{ gap: Spacing.three }}>
            <AppText variant="heading">
              {preset ? `Alerte · ${preset.cardName}` : 'Nouvelle alerte'}
            </AppText>

            {!preset && (
              <Field label="Portée">
                <Choice
                  options={[
                    { value: 'collection', label: 'Toute la collection' },
                    { value: 'folder', label: 'Un dossier' },
                  ]}
                  value={scope}
                  onChange={setScope}
                />
                {scope === 'folder' && (
                  <View style={styles.folderList}>
                    {(folders.data ?? []).map((f) => (
                      <Pressable
                        key={f.id}
                        onPress={() => setFolderId(f.id)}
                        style={[styles.choice, folderId === f.id && styles.choiceSelected]}>
                        <AppText
                          variant="small"
                          numberOfLines={1}
                          style={{ color: folderId === f.id ? Colors.text : Colors.textSecondary }}>
                          {f.name}
                        </AppText>
                      </Pressable>
                    ))}
                  </View>
                )}
              </Field>
            )}

            <Field label="Déclencheur">
              <View style={styles.metricGrid}>
                {(
                  [
                    { value: 'pct_change', label: 'Variation %' },
                    { value: 'corridor_breakout', label: 'Sortie du couloir' },
                    { value: 'threshold_above', label: 'Prix ≥ seuil €' },
                    { value: 'threshold_below', label: 'Prix ≤ seuil €' },
                  ] as { value: AlertMetric; label: string }[]
                ).map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => setMetric(opt.value)}
                    style={[styles.metricCell, metric === opt.value && styles.choiceSelected]}>
                    <AppText
                      variant="small"
                      style={{
                        fontWeight: '600',
                        textAlign: 'center',
                        color: metric === opt.value ? Colors.text : Colors.textSecondary,
                      }}>
                      {opt.label}
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </Field>

            {metric === 'pct_change' && (
              <>
                <Field label="Fenêtre">
                  <Choice
                    options={[
                      { value: '1', label: '1 jour' },
                      { value: '7', label: '7 jours' },
                      { value: '30', label: '30 jours' },
                    ]}
                    value={String(windowDays) as '1' | '7' | '30'}
                    onChange={(v) => setWindowDays(Number(v) as 1 | 7 | 30)}
                  />
                </Field>
                <Field label="Direction">
                  <Choice
                    options={[
                      { value: 'both', label: 'Les deux' },
                      { value: 'up', label: 'Hausses' },
                      { value: 'down', label: 'Baisses' },
                    ]}
                    value={direction}
                    onChange={setDirection}
                  />
                </Field>
              </>
            )}

            {needsThreshold && (
              <Field label={metric === 'pct_change' ? 'Seuil (%)' : 'Seuil (€)'}>
                <TextField
                  value={threshold}
                  onChangeText={setThreshold}
                  keyboardType="decimal-pad"
                  placeholder={metric === 'pct_change' ? '10' : '50'}
                />
              </Field>
            )}

            <Field label="Notification">
              <Choice
                options={[
                  { value: 'digest', label: 'Récap hebdo' },
                  { value: 'immediate', label: 'Email immédiat' },
                ]}
                value={channel}
                onChange={setChannel}
              />
            </Field>

            {createRule.isError ? (
              <AppText style={{ color: Colors.danger }}>{createRule.error.message}</AppText>
            ) : null}

            <Button
              label="Créer l'alerte"
              onPress={submit}
              loading={createRule.isPending}
              disabled={!valid || (!preset && scope === 'folder' && !folderId)}
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.four,
    maxHeight: '85%',
  },
  choiceRow: { flexDirection: 'row', gap: Spacing.two },
  choice: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  choiceSelected: { backgroundColor: Colors.accentSoft, borderWidth: 1, borderColor: Colors.accent },
  folderList: { gap: Spacing.one, marginTop: Spacing.one },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  metricCell: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
});
