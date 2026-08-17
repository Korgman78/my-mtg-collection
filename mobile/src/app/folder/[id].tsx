// Contenu d'un dossier, en grille : l'objet Magic prime, on veut voir
// ses cartes. Le détail chiffré vit sur la fiche carte.

import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { useFolder, type FolderItem } from '@/lib/collection';
import { formatEur } from '@/lib/format';
import { priceForFinish } from '@/lib/types';

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useFolder(id);

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
        right={
          <Button label="Ajouter" icon="plus" size="sm" variant="secondary" onPress={openAddCard} />
        }
      />

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
    </Screen>
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
