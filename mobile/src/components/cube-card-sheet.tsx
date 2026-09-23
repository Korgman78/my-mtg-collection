// Fiche d'une carte du cube : l'illustration, le texte, les archétypes
// auxquels elle appartient, et la sortie du cube.
//
// Le rattachement aux archétypes se fait ici, d'un toucher par archétype :
// absent → membre → carte-clé → absent. C'est là qu'on regarde la carte,
// c'est là qu'on décide à quoi elle sert.

import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ColorPips, ManaCost } from '@/components/cube';
import { Icon } from '@/components/icons';
import { AppText, Button, ConfirmDialog, Sheet } from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { fitsColors } from '@/lib/cube-stats';
import { useRemoveCubeCard, useSetArchetypeCard } from '@/lib/cubes';
import type { ArchetypeLink, CubeArchetype, CubeCard } from '@/lib/types';

export function CubeCardSheet({
  item,
  archetypes,
  links,
  onClose,
}: {
  item: CubeCard | null;
  archetypes: CubeArchetype[];
  links: ArchetypeLink[];
  onClose: () => void;
}) {
  const setLink = useSetArchetypeCard();
  const remove = useRemoveCubeCard();
  const [confirming, setConfirming] = useState(false);

  const card = item?.card;
  const stateOf = (archetypeId: string) => {
    const l = links.find((x) => x.archetype_id === archetypeId && x.cube_card_id === item?.id);
    return l ? (l.is_key ? 'key' : 'member') : null;
  };

  function cycle(archetypeId: string) {
    if (!item) return;
    const current = stateOf(archetypeId);
    const next = current === null ? 'member' : current === 'member' ? 'key' : null;
    setLink.mutate({ archetypeId, cubeCardId: item.id, state: next });
  }

  return (
    <>
      <Sheet visible={!!item && !confirming} onClose={onClose} title={card?.name ?? ''}>
        {card ? (
          <View style={{ gap: Space.md }}>
            <View style={styles.head}>
              <Image
                source={{ uri: card.image_normal ?? card.image_small ?? undefined }}
                style={styles.image}
                contentFit="cover"
                transition={120}
              />
              <View style={styles.headText}>
                <ManaCost cost={card.mana_cost} />
                <AppText variant="caption" style={{ color: Colors.text }}>
                  {card.type_line ?? 'Type inconnu'}
                </AppText>
                <AppText variant="caption">
                  {card.set_code.toUpperCase()} · #{card.collector_number}
                  {card.rarity ? ` · ${card.rarity}` : ''}
                </AppText>
              </View>
            </View>

            {card.oracle_text ? (
              <AppText variant="body" style={styles.oracle}>
                {card.oracle_text}
              </AppText>
            ) : null}

            <View style={{ gap: Space.sm }}>
              <AppText variant="overline">Archétypes</AppText>
              {archetypes.length === 0 ? (
                <AppText variant="caption">
                  Aucun archétype défini pour ce cube. Crée-les depuis l&apos;onglet Archétypes.
                </AppText>
              ) : (
                <>
                  <View style={styles.chips}>
                    {archetypes.map((a) => {
                      const state = stateOf(a.id);
                      const fits = fitsColors(card, a.colors) !== null;
                      return (
                        <Pressable
                          key={a.id}
                          accessibilityRole="button"
                          accessibilityLabel={`${a.name} : ${
                            state === 'key' ? 'carte-clé' : state === 'member' ? 'membre' : 'absente'
                          }`}
                          onPress={() => cycle(a.id)}
                          style={[
                            styles.chip,
                            state && styles.chipOn,
                            state === 'key' && styles.chipKey,
                            !fits && !state && styles.chipOff,
                          ]}>
                          {state === 'key' ? (
                            <Icon name="sparkle" size={12} color={Colors.accent} />
                          ) : state === 'member' ? (
                            <Icon name="check" size={12} color={Colors.text} strokeWidth={2.2} />
                          ) : null}
                          <ColorPips colors={a.colors} size={12} />
                          <AppText
                            variant="caption"
                            numberOfLines={1}
                            style={state ? { color: Colors.text, fontWeight: '600' } : undefined}>
                            {a.name}
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                  <AppText variant="caption">
                    Un toucher : membre. Deux : carte-clé ✦. Trois : retirée. Les archétypes
                    estompés ne partagent pas ses couleurs.
                  </AppText>
                </>
              )}
            </View>

            <Button
              label="Retirer du cube"
              icon="trash"
              variant="danger"
              size="sm"
              onPress={() => setConfirming(true)}
            />
          </View>
        ) : null}
      </Sheet>

      <ConfirmDialog
        visible={confirming}
        title={`Retirer « ${card?.name} » ?`}
        message="Elle quittera aussi les archétypes où elle était rangée."
        confirmLabel="Retirer du cube"
        loading={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          const id = item?.id;
          if (!id) return;
          remove.mutate(id, {
            onSettled: () => {
              setConfirming(false);
              onClose();
            },
          });
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: Space.md },
  image: {
    width: 140,
    aspectRatio: 488 / 680,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
  },
  headText: { flex: 1, gap: Space.sm },
  oracle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Space.md,
    height: 32,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  chipOn: { borderColor: Colors.borderStrong, backgroundColor: Colors.surfaceHover },
  chipKey: { borderColor: Colors.accentBorder, backgroundColor: Colors.accentSoft },
  chipOff: { opacity: 0.45 },
});
