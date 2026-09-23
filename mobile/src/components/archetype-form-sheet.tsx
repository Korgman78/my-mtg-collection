// Formulaire d'un archétype : nom, couleurs, plan de jeu. Sert à la
// création (écran du cube) comme à la modification (écran de l'archétype).

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ColorPip } from '@/components/cube';
import { AppText, Button, FormField, Sheet, TextField } from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { MANA_COLORS, SECTION_LABELS } from '@/lib/cube-stats';
import { useSaveArchetype } from '@/lib/cubes';
import type { ManaColor } from '@/lib/types';

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function ArchetypeFormSheet({
  visible,
  cubeId,
  position = 0,
  initial,
  onClose,
}: {
  visible: boolean;
  cubeId: string;
  position?: number;
  initial?: { id: string; name: string; colors: ManaColor[]; description: string | null };
  onClose: () => void;
}) {
  const save = useSaveArchetype();
  const [name, setName] = useState(initial?.name ?? '');
  const [colors, setColors] = useState<ManaColor[]>(initial?.colors ?? []);
  const [description, setDescription] = useState(initial?.description ?? '');

  function submit() {
    save.mutate(
      {
        id: initial?.id,
        cubeId,
        name,
        colors: MANA_COLORS.filter((c) => colors.includes(c)),
        description: description.trim() || null,
        position,
      },
      {
        onSuccess: () => {
          if (!initial) {
            setName('');
            setColors([]);
            setDescription('');
          }
          onClose();
        },
      }
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={initial ? "Modifier l'archétype" : 'Nouvel archétype'}
      footer={
        <Button
          label={initial ? 'Enregistrer' : "Créer l'archétype"}
          onPress={submit}
          loading={save.isPending}
          disabled={!name.trim()}
        />
      }>
      <TextField label="Nom" placeholder="Boros aggro, Reanimator, Artefacts…" value={name} onChangeText={setName} />
      <FormField label="Couleurs">
        <View style={styles.wrap}>
          {MANA_COLORS.map((c) => {
            const on = colors.includes(c);
            return (
              <Pressable
                key={c}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={SECTION_LABELS[c]}
                onPress={() => setColors(toggle(colors, c))}
                style={[styles.sectionChip, on && styles.sectionChipOn]}>
                <ColorPip color={c} size={20} />
                <AppText variant="caption" style={on ? styles.chipTextOn : undefined}>
                  {SECTION_LABELS[c]}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </FormField>
      <TextField
        label="Plan de jeu"
        placeholder="Ce que l'archétype cherche à faire, ses cartes-signatures, ses faiblesses…"
        value={description}
        onChangeText={setDescription}
        multiline
        style={{ minHeight: 96, textAlignVertical: 'top', paddingTop: Space.sm }}
      />
      {save.isError ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          {save.error.message}
        </AppText>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  sectionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  sectionChipOn: { borderColor: Colors.accentBorder, backgroundColor: Colors.accentSoft },
  chipTextOn: { color: Colors.text, fontWeight: '600' },
});
