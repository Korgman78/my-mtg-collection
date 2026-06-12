// Dashboard : valeur totale de la collection + grille des folders.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, EmptyState, Loading, Screen, Surface, TextField } from '@/components/ui';
import { Colors, FolderColors, Radius, Spacing } from '@/constants/theme';
import { useCreateFolder, useDashboard, useDeleteFolder, type DashboardData } from '@/lib/collection';
import { formatEur } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type FolderEntry = DashboardData['folders'][number];

export default function DashboardScreen() {
  const router = useRouter();
  const { data, isLoading, refetch, isRefetching } = useDashboard();
  const deleteFolder = useDeleteFolder();
  const [creating, setCreating] = useState(false);

  function confirmDeleteFolder(folder: FolderEntry) {
    Alert.alert(
      `Supprimer « ${folder.name} » ?`,
      folder.itemCount > 0
        ? `Les ${folder.itemCount} cartes qu'il contient seront retirées de ta collection.`
        : undefined,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => deleteFolder.mutate(folder.id),
        },
      ]
    );
  }

  if (isLoading || !data) return <Loading />;

  return (
    <Screen>
      <FlatList
        data={data.folders}
        keyExtractor={(f) => f.id}
        numColumns={2}
        columnWrapperStyle={{ gap: Spacing.three }}
        contentContainerStyle={styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.topRow}>
              <AppText variant="title">Grimoire</AppText>
              <Pressable onPress={() => supabase.auth.signOut()} hitSlop={12}>
                <AppText variant="secondary">Déconnexion</AppText>
              </Pressable>
            </View>
            <Surface style={styles.valueCard}>
              <AppText variant="secondary">Valeur de la collection</AppText>
              <AppText style={styles.totalValue}>{formatEur(data.totalValue)}</AppText>
              <AppText variant="small">
                {data.totalCards} carte{data.totalCards > 1 ? 's' : ''} · prix Cardmarket via Scryfall
              </AppText>
            </Surface>
            <View style={styles.sectionRow}>
              <AppText variant="heading">Dossiers</AppText>
              <Pressable onPress={() => setCreating(true)} hitSlop={12}>
                <AppText style={{ color: Colors.accent, fontWeight: '700' }}>＋ Nouveau</AppText>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            glyph="🗂"
            title="Aucun dossier"
            hint="Crée ton premier dossier pour commencer à ranger ta collection."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.folderCard, pressed && { opacity: 0.8 }]}
            onPress={() => router.push({ pathname: '/folder/[id]', params: { id: item.id } })}
            onLongPress={() => confirmDeleteFolder(item)}>
            <View style={[styles.folderDot, { backgroundColor: item.color ?? Colors.accent }]} />
            <AppText variant="heading" numberOfLines={1}>
              {item.name}
            </AppText>
            <AppText variant="small">
              {item.kind === 'wishlist' ? '★ Wishlist · ' : ''}
              {item.itemCount} carte{item.itemCount > 1 ? 's' : ''}
            </AppText>
            <AppText variant="price" style={{ marginTop: Spacing.one }}>
              {item.value === null ? '—' : formatEur(item.value)}
            </AppText>
          </Pressable>
        )}
      />
      <CreateFolderModal visible={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}

function CreateFolderModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const createFolder = useCreateFolder();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(FolderColors[0]);
  const [kind, setKind] = useState<'collection' | 'wishlist'>('collection');

  function submit() {
    createFolder.mutate(
      { name: name.trim(), color, kind },
      {
        onSuccess: () => {
          setName('');
          onClose();
        },
      }
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <AppText variant="heading">Nouveau dossier</AppText>
          <TextField placeholder="Nom du dossier" value={name} onChangeText={setName} autoFocus />
          <View style={styles.colorRow}>
            {FolderColors.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: c },
                  color === c && styles.colorSwatchSelected,
                ]}
              />
            ))}
          </View>
          <View style={styles.kindRow}>
            {(['collection', 'wishlist'] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => setKind(k)}
                style={[styles.kindOption, kind === k && styles.kindOptionSelected]}>
                <AppText
                  variant="small"
                  style={{ color: kind === k ? Colors.text : Colors.textSecondary, fontWeight: '600' }}>
                  {k === 'collection' ? 'Collection' : 'Wishlist'}
                </AppText>
              </Pressable>
            ))}
          </View>
          <Button
            label="Créer"
            onPress={submit}
            loading={createFolder.isPending}
            disabled={name.trim().length === 0}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.three, gap: Spacing.three },
  header: { gap: Spacing.three, marginBottom: Spacing.one },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  valueCard: { gap: Spacing.one, alignItems: 'flex-start' },
  totalValue: {
    fontSize: 40,
    fontWeight: '700',
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  folderCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  folderDot: { width: 12, height: 12, borderRadius: 6, marginBottom: Spacing.one },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  colorRow: { flexDirection: 'row', gap: Spacing.two },
  colorSwatch: { width: 32, height: 32, borderRadius: 16 },
  colorSwatchSelected: { borderWidth: 3, borderColor: Colors.text },
  kindRow: { flexDirection: 'row', gap: Spacing.two },
  kindOption: {
    flex: 1,
    height: 40,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  kindOptionSelected: { backgroundColor: Colors.accentSoft, borderWidth: 1, borderColor: Colors.accent },
});
