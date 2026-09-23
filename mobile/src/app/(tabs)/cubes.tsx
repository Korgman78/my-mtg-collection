// Onglet Cubes : la liste des cubes, et leur création.
//
// Un cube est une liste de conception, pas une partie de la collection :
// aucune valeur en euros ici, on compte des cartes face à une taille visée.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icons';
import {
  AppBar,
  AppText,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormField,
  IconButton,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  Skeleton,
  TextField,
} from '@/components/ui';
import { Colors, FolderColors, Radius, Space } from '@/constants/theme';
import { useCreateCube, useCubes, useDeleteCube, type CubeEntry } from '@/lib/cubes';

/** Tailles usuelles : 45 cartes par joueur, pour 8, 10 ou 12 joueurs. */
const SIZES = ['360', '450', '540', 'libre'] as const;
type SizeChoice = (typeof SIZES)[number];

export default function CubesScreen() {
  const router = useRouter();
  const { data, error, isLoading, refetch, isRefetching } = useCubes();
  const deleteCube = useDeleteCube();
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CubeEntry | null>(null);

  if (isLoading) return <CubesSkeleton />;
  if (!data) return <ErrorState detail={error?.message} onRetry={() => refetch()} />;

  return (
    <Screen>
      <AppBar title="Cube builder" subtitle="Concevoir, équilibrer, découper en archétypes" />

      <FlatList
        data={data}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <SectionHeader
            title="Mes cubes"
            action={{ label: 'Nouveau', icon: 'plus', onPress: () => setCreating(true) }}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="cube"
            title="Aucun cube"
            hint="Un cube est une liste de cartes pensée pour être draftée. Crée-le, ajoute des cartes par nom, par scan ou en collant une liste, puis regarde son équilibre."
            action={{ label: 'Créer un cube', icon: 'plus', onPress: () => setCreating(true) }}
          />
        }
        renderItem={({ item }) => (
          <CubeRow
            cube={item}
            onOpen={() => router.push({ pathname: '/cube/[id]', params: { id: item.id } })}
            onDelete={() => setPendingDelete(item)}
          />
        )}
      />

      <CreateCubeSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => router.push({ pathname: '/cube/[id]', params: { id } })}
      />

      <ConfirmDialog
        visible={pendingDelete !== null}
        title={`Supprimer « ${pendingDelete?.name} » ?`}
        message={
          pendingDelete && pendingDelete.cardCount > 0
            ? `Ses ${pendingDelete.cardCount} cartes et ses archétypes seront perdus. Ta collection n'est pas touchée.`
            : 'Ce cube est vide.'
        }
        confirmLabel="Supprimer le cube"
        loading={deleteCube.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const id = pendingDelete?.id;
          if (!id) return;
          deleteCube.mutate(id, { onSettled: () => setPendingDelete(null) });
        }}
      />
    </Screen>
  );
}

function CubeRow({
  cube,
  onOpen,
  onDelete,
}: {
  cube: CubeEntry;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const progress = cube.target_size ? Math.min(1, cube.cardCount / cube.target_size) : null;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ouvrir le cube ${cube.name}`}
        onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}>
        <View style={[styles.glyph, { borderColor: cube.color ?? Colors.accent }]}>
          <Icon name="cube" size={18} color={cube.color ?? Colors.accent} />
        </View>
        <View style={styles.rowBody}>
          <AppText variant="heading" numberOfLines={1}>
            {cube.name}
          </AppText>
          <AppText variant="caption" numberOfLines={1}>
            {cube.target_size
              ? `${cube.cardCount} / ${cube.target_size} cartes`
              : `${cube.cardCount} carte${cube.cardCount > 1 ? 's' : ''}`}
            {cube.description ? ` · ${cube.description}` : ''}
          </AppText>
          {progress !== null ? (
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${progress * 100}%`,
                    backgroundColor: cube.cardCount > (cube.target_size ?? 0) ? Colors.down : Colors.accent,
                  },
                ]}
              />
            </View>
          ) : null}
        </View>
        <Icon name="chevronRight" size={16} color={Colors.textTertiary} />
      </Pressable>
      <IconButton name="trash" label={`Supprimer le cube ${cube.name}`} onPress={onDelete} size="sm" />
    </View>
  );
}

function CreateCubeSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createCube = useCreateCube();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [size, setSize] = useState<SizeChoice>('360');
  const [color, setColor] = useState<string>(FolderColors[0]);

  function submit() {
    createCube.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        target_size: size === 'libre' ? null : Number(size),
        color,
      },
      {
        onSuccess: ({ id }) => {
          setName('');
          setDescription('');
          onClose();
          onCreated(id);
        },
      }
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Nouveau cube"
      footer={
        <Button
          label="Créer le cube"
          onPress={submit}
          loading={createCube.isPending}
          disabled={name.trim().length === 0}
        />
      }>
      <TextField label="Nom" placeholder="Vintage, Pauper, Mon cube…" value={name} onChangeText={setName} autoFocus />
      <TextField
        label="Description (facultatif)"
        placeholder="Power level, thème, format…"
        value={description}
        onChangeText={setDescription}
      />
      <FormField label="Taille visée">
        <Segmented
          options={SIZES.map((s) => ({ value: s, label: s === 'libre' ? 'Libre' : s }))}
          value={size}
          onChange={setSize}
        />
        <AppText variant="caption">
          45 cartes par joueur : 360 pour 8, 450 pour 10, 540 pour 12. Modifiable ensuite.
        </AppText>
      </FormField>
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
      {createCube.isError ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          {createCube.error.message}
        </AppText>
      ) : null}
    </Sheet>
  );
}

function CubesSkeleton() {
  return (
    <Screen>
      <AppBar title="Cube builder" subtitle="Concevoir, équilibrer, découper en archétypes" />
      <View style={styles.list}>
        <SectionHeader title="Mes cubes" />
        {['58%', '44%'].map((w, i) => (
          <View key={i} style={styles.row}>
            <View style={styles.rowMain}>
              <Skeleton width={34} height={34} radius={Radius.md} />
              <View style={{ flex: 1, gap: Space.sm }}>
                <Skeleton width={w as `${number}%`} height={14} />
                <Skeleton width={90} height={10} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
    paddingVertical: Space.md,
    paddingLeft: Space.lg,
    paddingRight: Space.sm,
  },
  rowPressed: { backgroundColor: Colors.surfaceHover },
  rowBody: { flex: 1, gap: 3 },
  glyph: {
    width: 34,
    height: 34,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.surfaceAlt,
    overflow: 'hidden',
    marginTop: 2,
  },
  progressFill: { height: '100%', borderRadius: 2 },

  swatchRow: { flexDirection: 'row', gap: Space.sm },
  swatch: { padding: 2, borderRadius: Radius.pill, borderWidth: 1.5, borderColor: 'transparent' },
  swatchSelected: { borderColor: Colors.text },
  swatchFill: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
