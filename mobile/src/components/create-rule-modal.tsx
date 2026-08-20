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
  useUpdateRule,
  RARITIES,
  RARITY_LABELS,
  type AlertMetric,
  type Rarity,
  type AlertRule,
  type NewAlertRule,
} from '@/lib/alerts';
import { supabase } from '@/lib/supabase';
import type { Finish, Folder } from '@/lib/types';

type Preset = { cardId: string; cardName: string; finish: Finish };

export function CreateRuleModal({
  visible,
  onClose,
  preset,
  rule,
}: {
  visible: boolean;
  onClose: () => void;
  preset?: Preset;
  /** Règle à modifier. Absente = création.
   *
   *  L'état initial est lu une seule fois, au montage : l'appelant doit donc
   *  poser une `key` distincte par règle, faute de quoi rouvrir la modale sur
   *  une autre règle garderait les valeurs de la précédente. */
  rule?: AlertRule | null;
}) {
  const editing = rule ?? null;
  const createRule = useCreateRule();
  const updateRule = useUpdateRule();
  const pending = createRule.isPending || updateRule.isPending;
  const failure = createRule.error ?? updateRule.error;
  const [scope, setScope] = useState<'collection' | 'folder'>(
    editing?.scope === 'folder' ? 'folder' : 'collection'
  );
  const [folderId, setFolderId] = useState<string | null>(editing?.folder_id ?? null);
  const [metric, setMetric] = useState<AlertMetric>(editing?.metric ?? 'pct_change');
  const [windowDays, setWindowDays] = useState<1 | 7 | 30>(editing?.window_days ?? 7);
  const [direction, setDirection] = useState<'up' | 'down' | 'both'>(
    editing?.direction ?? 'both'
  );
  const [channel, setChannel] = useState<'digest' | 'immediate'>(
    editing?.channel ?? 'digest'
  );
  const [threshold, setThreshold] = useState(
    editing?.threshold != null ? String(editing.threshold) : '10'
  );
  // Champ vide = aucun plancher, ce qui reproduit le comportement d'avant.
  const [minPrice, setMinPrice] = useState(
    editing?.min_price != null ? String(editing.min_price) : ''
  );
  // Aucune rareté cochée = toutes, ce qui reproduit le comportement d'avant
  // ce filtre. On n'oblige donc personne à choisir.
  const [rarities, setRarities] = useState<Rarity[]>(editing?.rarities ?? []);

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

  const parsedMin = minPrice.trim() === '' ? null : Number(minPrice.replace(',', '.'));
  const minValid = parsedMin === null || (Number.isFinite(parsedMin) && parsedMin >= 0);

  const scopeText = preset
    ? preset.cardName
    : scope === 'collection'
      ? 'ta collection'
      : (folders.data?.find((f) => f.id === folderId)?.name ?? 'un dossier');

  function submit() {
    // Typé explicitement : sorti du `mutate`, l'objet perdrait le typage
    // contextuel et `scope` s'élargirait en `string`.
    const payload: NewAlertRule = {
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
      min_price: parsedMin,
    };

    if (editing) updateRule.mutate({ id: editing.id, ...payload }, { onSuccess: onClose });
    else createRule.mutate(payload, { onSuccess: onClose });
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={
        editing
          ? 'Modifier l’alerte'
          : preset
            ? `Alerte · ${preset.cardName}`
            : 'Nouvelle alerte'
      }
      footer={
        <Button
          label={editing ? 'Enregistrer' : "Créer l'alerte"}
          icon="check"
          onPress={submit}
          loading={pending}
          disabled={!thresholdValid || !scopeValid || !minValid}
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
            minPrice: parsedMin,
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

      {/* Le plancher porte sur le prix COURANT de la carte, pas sur son
          mouvement. Mesuré le 2026-08-20 : les 16 cartes ayant pris 50 % ou
          plus dans la journée valaient toutes moins de 20 centimes. Sans
          plancher, une règle en pourcentage ne parle que de monnaie. */}
      <TextField
        label="Prix plancher (€) — optionnel"
        value={minPrice}
        onChangeText={setMinPrice}
        keyboardType="decimal-pad"
        placeholder="Aucun"
        error={minValid ? undefined : 'Entre un nombre positif, ou laisse vide.'}
      />
      <AppText variant="caption">
        {parsedMin === null
          ? 'Sans plancher, les cartes à quelques centimes déclencheront la plupart des alertes.'
          : `Seules les cartes valant au moins ${String(parsedMin).replace('.', ',')} € aujourd’hui compteront.`}
      </AppText>

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

      {failure ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          {failure.message}
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
  minPrice,
}: {
  scopeText: string;
  metric: AlertMetric;
  windowDays: number;
  direction: 'up' | 'down' | 'both';
  threshold: number;
  channel: 'digest' | 'immediate';
  rarities: Rarity[];
  minPrice: number | null;
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

  // Le plancher se glisse dans la phrase : c'est la clause qui explique
  // pourquoi la règle ignorera l'essentiel des mouvements.
  const floor =
    minPrice === null ? '' : ` valant au moins ${String(minPrice).replace('.', ',')} €`;

  if (metric === 'corridor_breakout')
    return `On te prévient ${how} quand une ${kinds} de ${scopeText}${floor} sort de son couloir de prix habituel.`;
  if (metric === 'threshold_above')
    return `On te prévient ${how} quand une ${kinds} de ${scopeText}${floor} atteint ${amount} €.`;
  if (metric === 'threshold_below')
    return `On te prévient ${how} quand une ${kinds} de ${scopeText}${floor} descend à ${amount} €.`;

  const move =
    direction === 'up' ? 'monte' : direction === 'down' ? 'baisse' : 'bouge';
  return `On te prévient ${how} quand une ${kinds} de ${scopeText}${floor} ${move} de plus de ${amount} % sur ${windowDays} jour${windowDays > 1 ? 's' : ''}.`;
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
