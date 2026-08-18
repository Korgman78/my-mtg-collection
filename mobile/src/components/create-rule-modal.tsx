// Création d'une règle d'alerte. Utilisée depuis l'écran Alertes (portée
// collection/dossier) et depuis la fiche carte (portée carte, pré-remplie).
//
// Le formulaire affiche en permanence une phrase qui résume la règle en
// cours : c'est ce qui rend compréhensible un réglage à cinq dimensions.

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, FormField, Segmented, Sheet, TextField } from '@/components/ui';
import { Colors, Control, Radius, Space } from '@/constants/theme';
import {
  useCreateRule,
  RARITIES,
  RARITY_LABELS,
  type AlertMetric,
  type Rarity,
} from '@/lib/alerts';
import { supabase } from '@/lib/supabase';
import type { Finish, Folder } from '@/lib/types';

type Preset = { cardId: string; cardName: string; finish: Finish };

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
  // Aucune rareté cochée = toutes, ce qui reproduit le comportement d'avant
  // ce filtre. On n'oblige donc personne à choisir.
  const [rarities, setRarities] = useState<Rarity[]>([]);

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
  const thresholdValid = !needsThreshold || (Number.isFinite(parsedThreshold) && parsedThreshold > 0);
  const scopeValid = !!preset || scope === 'collection' || !!folderId;

  const scopeText = preset
    ? preset.cardName
    : scope === 'collection'
      ? 'ta collection'
      : (folders.data?.find((f) => f.id === folderId)?.name ?? 'un dossier');

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
        direction:
          metric === 'threshold_above' ? 'up' : metric === 'threshold_below' ? 'down' : direction,
        channel,
        rarities: rarities.length > 0 ? rarities : null,
      },
      { onSuccess: onClose }
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={preset ? `Alerte · ${preset.cardName}` : 'Nouvelle alerte'}
      footer={
        <Button
          label="Créer l'alerte"
          icon="check"
          onPress={submit}
          loading={createRule.isPending}
          disabled={!thresholdValid || !scopeValid}
        />
      }>
      <View style={styles.summary}>
        <AppText variant="overline">Résumé</AppText>
        <AppText variant="body">
          {summarise({
            scopeText,
            metric,
            windowDays,
            direction,
            threshold: parsedThreshold,
            channel,
            rarities,
          })}
        </AppText>
      </View>

      {!preset && (
        <FormField label="Portée">
          <Segmented
            options={[
              { value: 'collection', label: 'Toute la collection' },
              { value: 'folder', label: 'Un dossier' },
            ]}
            value={scope}
            onChange={setScope}
          />
          {scope === 'folder' && (
            <View style={styles.folderList}>
              {(folders.data ?? []).map((f) => {
                const active = folderId === f.id;
                return (
                  <Pressable
                    key={f.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => setFolderId(f.id)}
                    style={[styles.folderChip, active && styles.folderChipActive]}>
                    <AppText
                      variant="caption"
                      numberOfLines={1}
                      style={active ? { color: Colors.text, fontWeight: '600' } : undefined}>
                      {f.name}
                    </AppText>
                  </Pressable>
                );
              })}
              {folders.data?.length === 0 ? (
                <AppText variant="caption">Aucun dossier à surveiller pour l&apos;instant.</AppText>
              ) : null}
            </View>
          )}
        </FormField>
      )}

      {/* Le filtre n'a de sens qu'à portée collection ou dossier : sur une
          carte précise, sa rareté est déjà connue. */}
      {!preset && (
        <FormField label="Raretés surveillées">
          <View style={styles.rarityRow}>
            {RARITIES.map((r) => {
              const active = rarities.includes(r);
              return (
                <Pressable
                  key={r}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  accessibilityLabel={RARITY_LABELS[r]}
                  onPress={() =>
                    setRarities((current) =>
                      current.includes(r) ? current.filter((x) => x !== r) : [...current, r]
                    )
                  }
                  style={[styles.folderChip, active && styles.folderChipActive]}>
                  <AppText
                    variant="caption"
                    numberOfLines={1}
                    style={active ? { color: Colors.text, fontWeight: '600' } : undefined}>
                    {RARITY_LABELS[r]}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          <AppText variant="caption">
            {rarities.length === 0
              ? 'Aucune cochée : toutes les raretés sont surveillées.'
              : 'Une commune qui prend 100 % gagne quelques centimes ; une mythique qui prend 20 % en gagne plusieurs euros. Sépare les deux en créant une règle par groupe, avec son propre seuil.'}
          </AppText>
        </FormField>
      )}

      <FormField label="Déclencheur">
        <Segmented
          columns
          options={[
            { value: 'pct_change', label: 'Variation %' },
            { value: 'corridor_breakout', label: 'Sortie du couloir' },
            { value: 'threshold_above', label: 'Prix ≥ seuil' },
            { value: 'threshold_below', label: 'Prix ≤ seuil' },
          ]}
          value={metric}
          onChange={setMetric}
        />
        <AppText variant="caption">{METRIC_HELP[metric]}</AppText>
      </FormField>

      {metric === 'pct_change' && (
        <>
          <FormField label="Fenêtre">
            <Segmented
              options={[
                { value: '1', label: '1 jour' },
                { value: '7', label: '7 jours' },
                { value: '30', label: '30 jours' },
              ]}
              value={String(windowDays) as '1' | '7' | '30'}
              onChange={(v) => setWindowDays(Number(v) as 1 | 7 | 30)}
            />
          </FormField>
          <FormField label="Direction">
            <Segmented
              options={[
                { value: 'both', label: 'Les deux' },
                { value: 'up', label: 'Hausses' },
                { value: 'down', label: 'Baisses' },
              ]}
              value={direction}
              onChange={setDirection}
            />
          </FormField>
        </>
      )}

      {needsThreshold && (
        <TextField
          label={metric === 'pct_change' ? 'Seuil (%)' : 'Seuil (€)'}
          value={threshold}
          onChangeText={setThreshold}
          keyboardType="decimal-pad"
          placeholder={metric === 'pct_change' ? '10' : '50'}
          error={thresholdValid ? undefined : 'Entre un nombre supérieur à 0.'}
        />
      )}

      <FormField label="Notification">
        <Segmented
          options={[
            { value: 'digest', label: 'Récap hebdo' },
            { value: 'immediate', label: 'Email immédiat' },
          ]}
          value={channel}
          onChange={setChannel}
        />
      </FormField>

      {createRule.isError ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          {createRule.error.message}
        </AppText>
      ) : null}
    </Sheet>
  );
}

const METRIC_HELP: Record<AlertMetric, string> = {
  pct_change: 'Se déclenche quand le prix bouge de plus que le seuil sur la fenêtre choisie.',
  corridor_breakout:
    'Se déclenche quand le prix sort de son couloir habituel (percentiles 10 et 90 sur 30 jours). Pas de seuil à régler.',
  threshold_above: 'Se déclenche quand le prix atteint ou dépasse le montant fixé.',
  threshold_below: 'Se déclenche quand le prix descend au niveau du montant fixé ou en dessous.',
};

function summarise({
  scopeText,
  metric,
  windowDays,
  direction,
  threshold,
  channel,
  rarities,
}: {
  scopeText: string;
  metric: AlertMetric;
  windowDays: number;
  direction: 'up' | 'down' | 'both';
  threshold: number;
  channel: 'digest' | 'immediate';
  rarities: Rarity[];
}): string {
  const amount = Number.isFinite(threshold) ? threshold.toString().replace('.', ',') : '…';
  const how =
    channel === 'immediate' ? 'par email dès le lendemain' : 'dans le récap hebdomadaire du dimanche';

  // La rareté s'insère dans la phrase plutôt qu'en suffixe : « une commune ou
  // peu commune de ta collection » se lit, « ta collection · commune » non.
  const kinds =
    rarities.length === 0 || rarities.length === RARITIES.length
      ? 'carte'
      : rarities.map((r) => RARITY_LABELS[r].toLowerCase()).join(' ou ');

  if (metric === 'corridor_breakout')
    return `On te prévient ${how} quand une ${kinds} de ${scopeText} sort de son couloir de prix habituel.`;
  if (metric === 'threshold_above')
    return `On te prévient ${how} quand une ${kinds} de ${scopeText} atteint ${amount} €.`;
  if (metric === 'threshold_below')
    return `On te prévient ${how} quand une ${kinds} de ${scopeText} descend à ${amount} €.`;

  const move =
    direction === 'up' ? 'monte' : direction === 'down' ? 'baisse' : 'bouge';
  return `On te prévient ${how} quand une ${kinds} de ${scopeText} ${move} de plus de ${amount} % sur ${windowDays} jour${windowDays > 1 ? 's' : ''}.`;
}

const styles = StyleSheet.create({
  summary: {
    gap: Space.xs,
    padding: Space.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.accentBorder,
  },
  rarityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  folderList: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm, marginTop: Space.xs },
  folderChip: {
    minHeight: Control.sm,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },
  folderChipActive: { backgroundColor: Colors.surfaceHover, borderColor: Colors.borderStrong },
});
