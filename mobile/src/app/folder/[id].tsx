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
  IconButton,
  Loading,
  Screen,
  Segmented,
  Sheet,
  Surface,
  TextField,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import {
  useAddSetBulk,
  useFolder,
  useSetItemQuantity,
  type FolderItem,
  type SetBulkPhase,
} from '@/lib/collection';
import { formatEur } from '@/lib/format';
import { goBack } from '@/lib/nav';
import { countSetBulk, fetchSet } from '@/lib/scryfall';
import { priceForFinish } from '@/lib/types';
import { useDebounced } from '@/lib/use-debounced';

/** Deux façons de lire un dossier. La grille montre les illustrations —
 *  c'est ce qu'on veut pour retrouver une carte à l'œil. La liste montre les
 *  chiffres et le nombre d'exemplaires, et laisse le corriger sans ouvrir la
 *  fiche : c'est ce qu'on veut quand on range un lot. */
type ViewMode = 'grid' | 'list';

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useFolder(id);
  const [bulking, setBulking] = useState(false);
  const [mode, setMode] = useState<ViewMode>('grid');
  const setQuantity = useSetItemQuantity();

  if (isLoading || !data) return <Loading />;
  const { folder, items } = data;

  const totalValue = items.reduce((sum, item) => {
    const price = item.stats ? priceForFinish(item.stats, item.finish) : null;
    return sum + (price ?? 0) * item.quantity;
  }, 0);
  const totalCopies = items.reduce((sum, item) => sum + item.quantity, 0);

  const openAddCard = () =>
    router.push({ pathname: '/add-card', params: { folderId: folder.id } });
  const openScanner = () => router.push({ pathname: '/scan', params: { folderId: folder.id } });
  const openCard = (item: FolderItem) =>
    router.push({
      pathname: '/card/[cardId]',
      params: { cardId: item.card_id, itemId: item.id },
    });

  return (
    <Screen>
      <AppBar
        title={folder.name}
        subtitle={`${totalCopies} exemplaire${totalCopies > 1 ? 's' : ''} · ${items.length} référence${items.length > 1 ? 's' : ''} · ${formatEur(totalValue)}`}
        onBack={() => goBack('/')}
      />

      {/* Trois façons de remplir un dossier, toutes nommées. Une action de
          remplissage derrière une icône muette ne serait jamais trouvée. */}
      <View style={styles.toolbar}>
        <Button label="Scanner" icon="card" size="sm" onPress={openScanner} />
        <Button
          label="Chercher"
          icon="search"
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

      {items.length > 0 ? (
        <View style={styles.modeRow}>
          <Segmented
            options={[
              { value: 'grid', label: 'Grille' },
              { value: 'list', label: 'Liste' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </View>
      ) : null}

      <FlatList
        // `key` force le remontage : une FlatList ne change pas de nombre de
        // colonnes en vol, elle lève une erreur.
        key={mode}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={mode === 'grid' ? 2 : 1}
        columnWrapperStyle={mode === 'grid' ? styles.column : undefined}
        contentContainerStyle={mode === 'grid' ? styles.grid : styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListEmptyComponent={
          <EmptyState
            icon="card"
            title="Dossier vide"
            hint="Scanne une carte, cherche-la par son nom, ou ajoute d'un coup toutes les communes et peu communes d'un set."
            action={{ label: 'Scanner une carte', icon: 'card', onPress: openScanner }}
          />
        }
        renderItem={({ item }) =>
          mode === 'grid' ? (
            <CardTile item={item} onPress={() => openCard(item)} />
          ) : (
            <CardRow
              item={item}
              onPress={() => openCard(item)}
              onQuantity={(quantity) => setQuantity.mutate({ itemId: item.id, quantity })}
            />
          )
        }
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

/** Ligne compacte : les chiffres priment, et le nombre d'exemplaires se
 *  corrige sans ouvrir la fiche.
 *
 *  Le « − » et le « + » sont des contrôles à part entière, posés à côté de
 *  la zone cliquable et non dedans : un bouton dans un bouton est du HTML
 *  invalide sur le web, et le clic partirait au mauvais. */
function CardRow({
  item,
  onPress,
  onQuantity,
}: {
  item: FolderItem;
  onPress: () => void;
  onQuantity: (quantity: number) => void;
}) {
  const unitPrice = item.stats ? priceForFinish(item.stats, item.finish) : null;
  const lineTotal = unitPrice === null ? null : unitPrice * item.quantity;
  const change = item.finish === 'foil' ? item.stats?.change_7d_pct_foil : item.stats?.change_7d_pct;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ouvrir ${item.card.name}`}
        onPress={onPress}
        style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}>
        <Image
          source={{ uri: item.card.image_small ?? undefined }}
          style={styles.rowThumb}
          contentFit="cover"
          transition={120}
        />
        <View style={styles.rowBody}>
          <AppText variant="heading" numberOfLines={1}>
            {item.card.name}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {item.card.set_code.toUpperCase()} · #{item.card.collector_number}
            {item.quantity > 1 && unitPrice !== null ? ` · ${formatEur(unitPrice)} l’unité` : ''}
          </AppText>
          <View style={styles.rowBadges}>
            <FinishBadge finish={item.finish} />
            <ChangeBadge pct={change ?? null} size="sm" />
          </View>
        </View>
        <AppText variant="price">{formatEur(lineTotal)}</AppText>
      </Pressable>

      <View style={styles.quantity}>
        <IconButton
          name="minus"
          label={`Retirer un exemplaire de ${item.card.name}`}
          size="sm"
          onPress={() => onQuantity(item.quantity - 1)}
        />
        <AppText variant="price" style={styles.quantityValue}>
          {item.quantity}
        </AppText>
        <IconButton
          name="plus"
          label={`Ajouter un exemplaire de ${item.card.name}`}
          size="sm"
          onPress={() => onQuantity(item.quantity + 1)}
        />
      </View>
    </View>
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
  modeRow: { paddingHorizontal: Space.lg, paddingBottom: Space.md },

  list: { paddingHorizontal: Space.lg, paddingBottom: Space.xxl, gap: Space.sm, flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: Space.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
  },
  rowPressed: { backgroundColor: Colors.surfaceHover },
  rowThumb: { width: 38, height: 53, borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt },
  rowBody: { flex: 1, gap: 2 },
  rowBadges: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  quantity: { flexDirection: 'row', alignItems: 'center' },
  quantityValue: {
    minWidth: 22,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

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
