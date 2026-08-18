// Contenu d'un dossier, en grille : l'objet Magic prime, on veut voir
// ses cartes. Le détail chiffré vit sur la fiche carte.

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import {
  AppBar,
  AppText,
  Button,
  ChangeBadge,
  EmptyState,
  FinishBadge,
  Loading,
  Screen,
  Sheet,
  Surface,
  TextField,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { useAddSetBulk, useFolder, type FolderItem, type SetBulkPhase } from '@/lib/collection';
import { formatEur } from '@/lib/format';
import { countSetBulk, fetchSet } from '@/lib/scryfall';
import { priceForFinish } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useFolder(id);
  const [bulking, setBulking] = useState(false);

  if (isLoading || !data) return <Loading />;
  const { folder, items } = data;

  const totalValue = items.reduce((sum, item) => {
    const price = item.stats ? priceForFinish(item.stats, item.finish) : null;
    return sum + (price ?? 0) * item.quantity;
  }, 0);

  const openAddCard = () =>
    router.push({ pathname: '/add-card', params: { folderId: folder.id } });

  return (
    <Screen>
      <AppBar
        title={folder.name}
        subtitle={`${items.length} carte${items.length > 1 ? 's' : ''} · ${formatEur(totalValue)}`}
        onBack={() => router.back()}
      />

      {/* Deux façons de remplir un dossier, toutes deux nommées. L'ajout en
          bloc derrière une icône muette ne serait jamais trouvé. */}
      <View style={styles.toolbar}>
        <Button
          label="Ajouter une carte"
          icon="plus"
          size="sm"
          variant="secondary"
          onPress={openAddCard}
        />
        <Button
          label="Bulk d'un set"
          icon="layers"
          size="sm"
          variant="secondary"
          onPress={() => setBulking(true)}
        />
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.grid}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListEmptyComponent={
          <EmptyState
            icon="card"
            title="Dossier vide"
            hint="Cherche une carte par son nom, choisis l'édition, et elle rejoint ce dossier avec son prix du jour."
            action={{ label: 'Ajouter une carte', icon: 'plus', onPress: openAddCard }}
          />
        }
        renderItem={({ item }) => (
          <CardTile
            item={item}
            onPress={() =>
              router.push({
                pathname: '/card/[cardId]',
                params: { cardId: item.card_id, itemId: item.id },
              })
            }
          />
        )}
      />

      <SetBulkSheet folderId={folder.id} visible={bulking} onClose={() => setBulking(false)} />
    </Screen>
  );
}

/** Ajout du bulk d'un set : on saisit le code (OTJ, MH3…), l'écran résout le
 *  set et annonce combien de cartes il ajouterait, puis on valide.
 *
 *  Annoncer le nombre AVANT est le point important : « OTJ » et « OTP » sont
 *  deux sets voisins d'un caractère, et l'un ajoute 191 cartes quand l'autre
 *  n'en a aucune. Le nom du set résolu sert de confirmation. */
function SetBulkSheet({
  folderId,
  visible,
  onClose,
}: {
  folderId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const addBulk = useAddSetBulk();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<SetBulkPhase | null>(null);
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null);
  const debouncedCode = useDebounced(code, 350);

  const lookup = useQuery({
    queryKey: ['scryfall', 'set-bulk', debouncedCode.trim().toLowerCase()],
    enabled: visible && debouncedCode.trim().length >= 3,
    queryFn: async () => {
      const set = await fetchSet(debouncedCode);
      if (!set) return { set: null, count: 0 };
      return { set, count: await countSetBulk(set.code) };
    },
  });

  const set = lookup.data?.set ?? null;
  const count = lookup.data?.count ?? 0;
  // Le code est extrait ici, pas dans `submit`. Le React Compiler remonte
  // les littéraux d'objet hors des callbacks pour les mémoïser : un
  // `set!.code` à l'intérieur serait évalué dès le rendu, alors que `set`
  // est nul tant que Scryfall n'a pas répondu.
  const resolvedCode = set?.code ?? null;
  const ready = !!resolvedCode && count > 0 && !addBulk.isPending;

  function close() {
    setCode('');
    setPhase(null);
    setDone(null);
    addBulk.reset();
    onClose();
  }

  function submit() {
    if (!resolvedCode) return;
    setDone(null);
    addBulk.mutate(
      { folderId, setCode: resolvedCode, onProgress: setPhase },
      {
        onSuccess: (result) => setDone(result),
        onSettled: () => setPhase(null),
      }
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title="Bulk d'un set"
      footer={
        <Button
          label={ready ? `Ajouter ${count} carte${count > 1 ? 's' : ''}` : 'Ajouter le bulk'}
          icon="check"
          onPress={submit}
          loading={addBulk.isPending}
          disabled={!ready}
        />
      }>
      <TextField
        label="Code du set"
        placeholder="OTJ, MH3, LTR…"
        value={code}
        onChangeText={(t) => {
          setCode(t);
          setDone(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        autoFocus
      />

      {/* État de la résolution : on ne laisse jamais le champ muet. */}
      {debouncedCode.trim().length < 3 ? (
        <AppText variant="caption">
          Le code à trois lettres du set, celui imprimé en bas à gauche des cartes.
        </AppText>
      ) : lookup.isFetching ? (
        <AppText variant="caption">Recherche du set…</AppText>
      ) : !set ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          Aucun set ne porte le code « {debouncedCode.trim().toUpperCase()} ».
        </AppText>
      ) : (
        <Surface tone="plate" style={styles.setCard}>
          <AppText variant="overline">{set.code.toUpperCase()}</AppText>
          <AppText variant="heading">{set.name}</AppText>
          <AppText variant="caption">
            {count > 0
              ? `${count} commune${count > 1 ? 's' : ''} et peu commune${count > 1 ? 's' : ''} · sorti en ${set.released_at?.slice(0, 4) ?? '?'}`
              : 'Ce set ne contient aucune commune ni peu commune.'}
          </AppText>
        </Surface>
      )}

      <AppText variant="caption">
        Ajoute un exemplaire non-foil de chaque commune et peu commune, hors terrains de base. Les
        cartes déjà dans ce dossier sont ignorées. Une fois en base, elles reçoivent un point de
        prix chaque nuit : c&apos;est ce qui permet de voir monter une commune.
      </AppText>

      {phase ? (
        <AppText variant="caption" style={{ color: Colors.text }}>
          {phase.step === 'fetching'
            ? `Lecture du set… ${phase.loaded}/${phase.total}`
            : `Ajout… ${phase.loaded}/${phase.total}`}
        </AppText>
      ) : null}

      {done ? (
        <AppText variant="caption" style={{ color: Colors.up }}>
          {done.added} carte{done.added > 1 ? 's' : ''} ajoutée{done.added > 1 ? 's' : ''}
          {done.skipped > 0 ? ` · ${done.skipped} déjà présente${done.skipped > 1 ? 's' : ''}` : ''}.
        </AppText>
      ) : null}

      {addBulk.isError ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          {addBulk.error.message}
        </AppText>
      ) : null}
    </Sheet>
  );
}

function CardTile({ item, onPress }: { item: FolderItem; onPress: () => void }) {
  const price = item.stats ? priceForFinish(item.stats, item.finish) : null;
  const change = item.finish === 'foil' ? item.stats?.change_7d_pct_foil : item.stats?.change_7d_pct;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.card.name}, ${formatEur(price)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}>
      <View style={styles.artWrap}>
        <Image
          source={{ uri: item.card.image_normal ?? item.card.image_small ?? undefined }}
          style={styles.art}
          contentFit="cover"
          transition={180}
        />
        {item.quantity > 1 ? (
          <View style={styles.qtyChip}>
            <AppText variant="caption" style={styles.qtyChipText}>
              ×{item.quantity}
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.tileBody}>
        <AppText variant="label" numberOfLines={1} style={{ color: Colors.text }}>
          {item.card.name}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {item.card.set_code.toUpperCase()} · #{item.card.collector_number}
        </AppText>
        <View style={styles.tileFooter}>
          <AppText variant="price">{formatEur(price)}</AppText>
          <ChangeBadge pct={change ?? null} size="sm" />
        </View>
        <FinishBadge finish={item.finish} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
  },
  setCard: { gap: Space.xs, alignItems: 'flex-start', paddingVertical: Space.lg },

  grid: { paddingHorizontal: Space.lg, paddingBottom: Space.xxl, gap: Space.lg, flexGrow: 1 },
  column: { gap: Space.lg },
  tile: { flex: 1, gap: Space.sm, maxWidth: '50%' },
  artWrap: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  art: { width: '100%', aspectRatio: 63 / 88 },
  qtyChip: {
    position: 'absolute',
    top: Space.sm,
    right: Space.sm,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(10, 10, 11, 0.82)',
  },
  qtyChipText: { color: Colors.text, fontWeight: '700' },
  tileBody: { gap: 2 },
  tileFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginTop: 2,
  },
});
