// Un archétype : son plan de jeu, ses cartes-clés, ses cartes, sa courbe.
//
// On y range les cartes depuis la liste de celles du cube qui partagent ses
// couleurs — c'est là qu'on les cherche d'instinct. Une carte d'une autre
// couleur reste rattachable depuis sa fiche (écran du cube), pour les
// archétypes qui débordent de leur paire (un Reanimator qui vole des cibles).

import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ArchetypeFormSheet } from '@/components/archetype-form-sheet';
import { ColorPips, CubeCardTile, CurveChart, ManaCost } from '@/components/cube';
import { CubeCardSheet } from '@/components/cube-card-sheet';
import { Icon } from '@/components/icons';
import {
  AppBar,
  AppText,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  IconButton,
  Loading,
  Screen,
  SectionHeader,
  Sheet,
  Surface,
  TextField,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { archetypeSummaries, fitsColors, sortCards } from '@/lib/cube-stats';
import { useCube, useDeleteArchetype, useSetArchetypeCard } from '@/lib/cubes';
import { normalize } from '@/lib/format';
import { goBack } from '@/lib/nav';
import type { CubeCard } from '@/lib/types';

export default function ArchetypeScreen() {
  const { id, cubeId } = useLocalSearchParams<{ id: string; cubeId: string }>();
  const { data, error, isLoading, refetch } = useCube(cubeId);
  const remove = useDeleteArchetype();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const summary = useMemo(
    () => (data ? archetypeSummaries(data.archetypes, data.cards, data.links).find((s) => s.archetype.id === id) : undefined),
    [data, id]
  );

  const back = () => goBack({ pathname: '/cube/[id]', params: { id: cubeId } });

  if (isLoading) return <Loading />;
  if (!data) return <ErrorState detail={error?.message} onRetry={() => refetch()} />;
  if (!summary) {
    return (
      <Screen>
        <AppBar title="Archétype" onBack={back} />
        <EmptyState icon="layers" title="Archétype introuvable" hint="Il a peut-être été supprimé." />
      </Screen>
    );
  }

  const { archetype, members, keyCards, curve, creatures, playable } = summary;
  const selected = data.cards.find((c) => c.id === selectedId) ?? null;
  const others = members.filter((m) => !keyCards.includes(m));

  return (
    <Screen>
      <AppBar
        title={archetype.name}
        subtitle={`${members.length} carte${members.length > 1 ? 's' : ''} · ${playable} jouables dans ses couleurs`}
        onBack={back}
        backLabel="Retour au cube"
        right={
          <>
            <IconButton name="pencil" label="Modifier l'archétype" onPress={() => setEditing(true)} />
            <IconButton name="trash" label="Supprimer l'archétype" onPress={() => setDeleting(true)} />
          </>
        }
      />

      <FlatList
        data={others}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.body}
        ListHeaderComponent={
          <View style={styles.header}>
            <Surface tone="plate" style={styles.plan}>
              <View style={styles.planHead}>
                <ColorPips colors={archetype.colors} size={20} />
                <AppText variant="overline">Plan de jeu</AppText>
              </View>
              <AppText variant="body" style={{ color: archetype.description ? Colors.text : Colors.textTertiary }}>
                {archetype.description ?? 'Pas encore décrit. Le crayon, en haut, permet de le rédiger.'}
              </AppText>
            </Surface>

            <Button label="Ranger des cartes du cube" icon="plus" onPress={() => setAdding(true)} />

            {members.length > 0 ? (
              <>
                <SectionHeader title="Courbe" />
                <CurveChart curve={curve} height={72} />
                <AppText variant="caption">
                  {creatures} créature{creatures > 1 ? 's' : ''} sur {members.length} cartes rangées.
                </AppText>
              </>
            ) : null}

            <SectionHeader title={`Cartes-clés · ${keyCards.length}`} />
            {keyCards.length === 0 ? (
              <AppText variant="caption">
                Aucune. Les cartes-clés sont celles qui donnent envie de draguer l&apos;archétype : ouvre
                une carte et touche deux fois cet archétype pour la désigner.
              </AppText>
            ) : (
              <View style={styles.keyGrid}>
                {keyCards.map((k) => (
                  <View key={k.id} style={styles.keyCell}>
                    <CubeCardTile card={k.card} onPress={() => setSelectedId(k.id)} badge="✦" />
                  </View>
                ))}
              </View>
            )}

            <SectionHeader title={`Autres cartes · ${others.length}`} />
          </View>
        }
        ListEmptyComponent={
          <AppText variant="caption">
            {members.length === 0 ? 'Aucune carte rangée pour l’instant.' : 'Toutes ses cartes sont des cartes-clés.'}
          </AppText>
        }
        renderItem={({ item }) => <MemberLine item={item} onPress={() => setSelectedId(item.id)} />}
      />

      <AddCardsSheet
        visible={adding}
        onClose={() => setAdding(false)}
        archetypeId={archetype.id}
        colors={archetype.colors}
        cards={data.cards}
        memberIds={new Set(members.map((m) => m.id))}
      />

      <ArchetypeFormSheet
        key={`${archetype.name}|${archetype.colors.join('')}|${archetype.description}`}
        visible={editing}
        cubeId={cubeId}
        initial={archetype}
        onClose={() => setEditing(false)}
      />

      <CubeCardSheet item={selected} archetypes={data.archetypes} links={data.links} onClose={() => setSelectedId(null)} />

      <ConfirmDialog
        visible={deleting}
        title={`Supprimer « ${archetype.name} » ?`}
        message="Les cartes restent dans le cube : seul leur rangement dans cet archétype disparaît."
        confirmLabel="Supprimer l'archétype"
        loading={remove.isPending}
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          remove.mutate(archetype.id, {
            onSuccess: () => {
              setDeleting(false);
              back();
            },
          })
        }
      />
    </Screen>
  );
}

function MemberLine({ item, onPress }: { item: CubeCard; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.card.name}
      onPress={onPress}
      style={({ pressed }) => [styles.line, pressed && { backgroundColor: Colors.surfaceHover }]}>
      <Image source={{ uri: item.card.image_small ?? undefined }} style={styles.thumb} contentFit="cover" />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" numberOfLines={1} style={{ color: Colors.text }}>
          {item.card.name}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {item.card.type_line ?? '…'}
        </AppText>
      </View>
      <ManaCost cost={item.card.mana_cost} size={14} />
    </Pressable>
  );
}

/** Les cartes du cube jouables dans ses couleurs, cochables d'un toucher.
 *  Au-delà de 120 résultats on demande de préciser : une feuille modale
 *  n'est pas faite pour faire défiler un cube entier. */
function AddCardsSheet({
  visible,
  onClose,
  archetypeId,
  colors,
  cards,
  memberIds,
}: {
  visible: boolean;
  onClose: () => void;
  archetypeId: string;
  colors: string[];
  cards: CubeCard[];
  memberIds: Set<string>;
}) {
  const setLink = useSetArchetypeCard();
  const [query, setQuery] = useState('');
  const [withColorless, setWithColorless] = useState(false);

  const needle = normalize(query);
  const candidates = sortCards(
    cards.filter((c) => {
      const fit = fitsColors(c.card, colors);
      if (fit === null || (fit === 'colorless' && !withColorless)) return false;
      if (!needle) return true;
      return normalize(`${c.card.name} ${c.card.type_line ?? ''} ${c.card.oracle_text ?? ''}`).includes(needle);
    }),
    'cmc'
  );
  const LIMIT = 120;

  return (
    <Sheet visible={visible} onClose={onClose} title="Ranger des cartes">
      <TextField
        icon="search"
        placeholder="Filtrer : nom, type, texte"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: withColorless }}
        onPress={() => setWithColorless(!withColorless)}
        style={styles.toggleLine}>
        <View style={[styles.box, withColorless && styles.boxOn]}>
          {withColorless ? <Icon name="check" size={12} color={Colors.onAccent} strokeWidth={2.4} /> : null}
        </View>
        <AppText variant="caption">Inclure les incolores</AppText>
      </Pressable>

      <AppText variant="caption">
        {candidates.length} carte{candidates.length > 1 ? 's' : ''} du cube dans ses couleurs. Touche pour ranger ou
        retirer.
      </AppText>

      {candidates.slice(0, LIMIT).map((c) => {
        const on = memberIds.has(c.id);
        return (
          <Pressable
            key={c.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={c.card.name}
            onPress={() => setLink.mutate({ archetypeId, cubeCardId: c.id, state: on ? null : 'member' })}
            style={[styles.pickLine, on && styles.pickLineOn]}>
            <View style={[styles.box, on && styles.boxOn]}>
              {on ? <Icon name="check" size={12} color={Colors.onAccent} strokeWidth={2.4} /> : null}
            </View>
            <AppText variant="body" numberOfLines={1} style={{ flex: 1, color: Colors.text }}>
              {c.card.name}
            </AppText>
            <ManaCost cost={c.card.mana_cost} size={13} />
          </Pressable>
        );
      })}
      {candidates.length > LIMIT ? (
        <AppText variant="caption">
          {candidates.length - LIMIT} de plus : précise le filtre pour les voir.
        </AppText>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Space.lg, paddingBottom: Space.xxxl, flexGrow: 1 },
  header: { gap: Space.lg, paddingBottom: Space.sm },
  plan: { gap: Space.sm },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  keyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  keyCell: { width: '31%' },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  thumb: { width: 34, aspectRatio: 488 / 680, borderRadius: 3, backgroundColor: Colors.surfaceAlt },
  toggleLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 32 },
  pickLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 40,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.md,
  },
  pickLineOn: { backgroundColor: Colors.accentSoft },
  box: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: Colors.accent, borderColor: Colors.accent },
});
