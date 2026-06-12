// Contenu d'un dossier : liste des cartes avec prix actuel et variation 7 j.

import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText, ChangeBadge, EmptyState, FinishBadge, Loading, Screen } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useDeleteItem, useFolder, type FolderItem } from '@/lib/collection';
import { formatEur } from '@/lib/format';
import { priceForFinish } from '@/lib/types';

export default function FolderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useFolder(id);
  const deleteItem = useDeleteItem();

  if (isLoading || !data) return <Loading />;
  const { folder, items } = data;

  const totalValue = items.reduce((sum, item) => {
    const price = item.stats ? priceForFinish(item.stats, item.finish) : null;
    return sum + (price ?? 0) * item.quantity;
  }, 0);

  function confirmDelete(item: FolderItem) {
    Alert.alert(`Retirer « ${item.card.name} » ?`, undefined, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => deleteItem.mutate(item.id) },
    ]);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <AppText style={styles.back}>‹</AppText>
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="heading" numberOfLines={1}>
            {folder.name}
          </AppText>
          <AppText variant="small">
            {items.length} carte{items.length > 1 ? 's' : ''} · {formatEur(totalValue)}
          </AppText>
        </View>
        <Pressable
          onPress={() => router.push({ pathname: '/add-card', params: { folderId: folder.id } })}
          style={styles.addButton}
          hitSlop={8}>
          <AppText style={{ color: Colors.bg, fontWeight: '700', fontSize: 22, lineHeight: 26 }}>＋</AppText>
        </Pressable>
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListEmptyComponent={
          <EmptyState
            glyph="✦"
            title="Dossier vide"
            hint="Appuie sur ＋ pour ajouter ta première carte."
          />
        }
        renderItem={({ item }) => {
          const price = item.stats ? priceForFinish(item.stats, item.finish) : null;
          const change = item.finish === 'foil' ? item.stats?.change_7d_pct_foil : item.stats?.change_7d_pct;
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
              onPress={() =>
                router.push({
                  pathname: '/card/[cardId]',
                  params: { cardId: item.card_id, itemId: item.id },
                })
              }
              onLongPress={() => confirmDelete(item)}>
              <Image source={{ uri: item.card.image_small ?? undefined }} style={styles.thumb} contentFit="cover" transition={150} />
              <View style={styles.rowBody}>
                <AppText variant="body" numberOfLines={1} style={{ fontWeight: '600' }}>
                  {item.card.name}
                </AppText>
                <AppText variant="small">
                  {item.card.set_code.toUpperCase()} · #{item.card.collector_number}
                  {item.quantity > 1 ? ` · ×${item.quantity}` : ''}
                </AppText>
                <FinishBadge finish={item.finish} />
              </View>
              <View style={styles.rowRight}>
                <AppText variant="price">{formatEur(price)}</AppText>
                <ChangeBadge pct={change ?? null} />
              </View>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
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
