// Dashboard : valeur totale de la collection + liste des dossiers.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icons';
import {
  AppBar,
  AppText,
  Button,
  EmptyState,
  FormField,
  IconButton,
  Loading,
  Pill,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  Surface,
  TextField,
} from '@/components/ui';
import { Colors, FolderColors, Radius, Space } from '@/constants/theme';
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
        : 'Ce dossier est vide.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => deleteFolder.mutate(folder.id) },
      ]
    );
  }

  if (isLoading || !data) return <Loading />;

  return (
    <Screen>
      <AppBar
        title="Collection"
        right={
          <IconButton
            name="logout"
            label="Se déconnecter"
            onPress={() => supabase.auth.signOut()}
          />
        }
      />

      <FlatList
        data={data.folders}
        keyExtractor={(f) => f.id}
        contentContainerStyle={styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View style={styles.header}>
            <Surface style={styles.valueCard}>
              <AppText variant="overline">Valeur de la collection</AppText>
              <AppText variant="display">{formatEur(data.totalValue)}</AppText>
              <AppText variant="caption">
                {data.totalCards} carte{data.totalCards > 1 ? 's' : ''} · prix Cardmarket via Scryfall
              </AppText>
            </Surface>

            <SectionHeader
              title="Dossiers"
              action={{ label: 'Nouveau', icon: 'plus', onPress: () => setCreating(true) }}
            />
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="folder"
            title="Aucun dossier"
            hint="Les dossiers rangent ta collection : un par deck, par édition, ou une wishlist. Les cartes s'ajoutent ensuite dedans."
            action={{ label: 'Créer un dossier', icon: 'plus', onPress: () => setCreating(true) }}
          />
        }
        renderItem={({ item }) => (
          <FolderRow
            folder={item}
            onOpen={() => router.push({ pathname: '/folder/[id]', params: { id: item.id } })}
            onDelete={() => confirmDeleteFolder(item)}
          />
        )}
      />

      <CreateFolderSheet visible={creating} onClose={() => setCreating(false)} />
    </Screen>
  );
}

function FolderRow({
  folder,
  onOpen,
  onDelete,
}: {
  folder: FolderEntry;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir le dossier ${folder.name}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={[styles.dot, { backgroundColor: folder.color ?? Colors.accent }]} />

      <View style={styles.rowBody}>
        <View style={styles.rowTitleLine}>
          <AppText variant="heading" numberOfLines={1}>
            {folder.name}
          </AppText>
          {folder.kind === 'wishlist' ? <Pill label="Wishlist" tone="accent" /> : null}
        </View>
        <AppText variant="caption">
          {folder.itemCount} carte{folder.itemCount > 1 ? 's' : ''}
        </AppText>
      </View>

      <AppText variant="price">{folder.value === null ? '—' : formatEur(folder.value)}</AppText>
      <IconButton
        name="trash"
        label={`Supprimer le dossier ${folder.name}`}
        onPress={onDelete}
        size="sm"
      />
      <Icon name="chevronRight" size={16} color={Colors.textTertiary} />
    </Pressable>
  );
}

function CreateFolderSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
          setKind('collection');
          onClose();
        },
      }
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Nouveau dossier"
      footer={
        <Button
          label="Créer le dossier"
          onPress={submit}
          loading={createFolder.isPending}
          disabled={name.trim().length === 0}
        />
      }>
      <TextField
        label="Nom"
        placeholder="Commander, Modern, Wishlist…"
        value={name}
        onChangeText={setName}
        autoFocus
      />

      <FormField label="Couleur">
        <View style={styles.swatchRow}>
          {FolderColors.map((c) => (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ selected: color === c }}
              accessibilityLabel={`Couleur ${c}`}
              onPress={() => setColor(c)}
              style={[styles.swatch, color === c && styles.swatchSelected]}>
              <View style={[styles.swatchFill, { backgroundColor: c }]}>
                {color === c ? <Icon name="check" size={14} color={Colors.bg} strokeWidth={2.6} /> : null}
              </View>
            </Pressable>
          ))}
        </View>
      </FormField>

      <FormField label="Type">
        <Segmented
          options={[
            { value: 'collection', label: 'Collection' },
            { value: 'wishlist', label: 'Wishlist' },
          ]}
          value={kind}
          onChange={setKind}
        />
        <AppText variant="caption">
          {kind === 'collection'
            ? 'Des cartes que tu possèdes, comptées dans la valeur totale.'
            : 'Des cartes que tu vises : utile pour être alerté quand le prix baisse.'}
        </AppText>
      </FormField>

      {createFolder.isError ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          {createFolder.error.message}
        </AppText>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: Space.lg, paddingBottom: Space.xxl, gap: Space.sm, flexGrow: 1 },
  header: { gap: Space.lg, marginBottom: Space.sm },
  valueCard: { gap: Space.xs, alignItems: 'flex-start' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  rowPressed: { backgroundColor: Colors.surfaceHover },
  rowBody: { flex: 1, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },

  swatchRow: { flexDirection: 'row', gap: Space.sm },
  swatch: { padding: 2, borderRadius: Radius.pill, borderWidth: 1.5, borderColor: 'transparent' },
  swatchSelected: { borderColor: Colors.text },
  swatchFill: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
