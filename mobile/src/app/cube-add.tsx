// Ajout de cartes à un cube, de deux façons :
//
//   - par le nom, à la chaîne : on tape, on touche, la carte entre et le
//     champ se vide pour la suivante. Pas d'étape « édition » ni
//     « finition » comme pour la collection : un cube compte des cartes,
//     pas des exemplaires, et l'impression par défaut suffit à l'illustrer.
//   - en collant une liste entière (CubeCobra, Moxfield, MTGO, Arena…).
//     C'est le vrai point d'entrée d'un cube : personne ne tape 360 noms.

import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icons';
import {
  AppBar,
  AppText,
  Button,
  EmptyState,
  IconButton,
  Screen,
  Segmented,
  Spinner,
  Surface,
  TextField,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { parseCardList, useAddToCube, type AddToCubeResult } from '@/lib/cubes';
import { goBack } from '@/lib/nav';
import { autocompleteNames, fetchCardsByNames, fetchNamedCard } from '@/lib/scryfall';
import { useDebounced } from '@/lib/use-debounced';

type Mode = 'search' | 'list';

export default function CubeAddScreen() {
  const { cubeId } = useLocalSearchParams<{ cubeId: string }>();
  const [mode, setMode] = useState<Mode>('search');
  const close = () => goBack({ pathname: '/cube/[id]', params: { id: cubeId } });

  return (
    <Screen safeBottom>
      <AppBar
        title="Ajouter au cube"
        subtitle={mode === 'search' ? 'Une carte après l’autre' : 'Une liste entière'}
        right={<IconButton name="close" label="Fermer" onPress={close} />}
      />
      <View style={styles.modes}>
        <Segmented
          options={[
            { value: 'search', label: 'Par le nom' },
            { value: 'list', label: 'Coller une liste' },
          ]}
          value={mode}
          onChange={setMode}
        />
      </View>
      {mode === 'search' ? <SearchMode cubeId={cubeId} /> : <ListMode cubeId={cubeId} onDone={close} />}
    </Screen>
  );
}

function SearchMode({ cubeId }: { cubeId: string }) {
  const add = useAddToCube();
  const [query, setQuery] = useState('');
  const [log, setLog] = useState<{ name: string; ok: boolean; note: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const debounced = useDebounced(query);

  const suggestions = useQuery({
    queryKey: ['scryfall', 'autocomplete', debounced],
    queryFn: () => autocompleteNames(debounced),
    enabled: debounced.trim().length >= 2,
  });

  async function pick(name: string) {
    setBusy(name);
    try {
      const card = await fetchNamedCard(name);
      const result = await add.mutateAsync({ cubeId, cards: [card] });
      const dup = result.duplicates.length > 0;
      setLog((l) => [{ name, ok: !dup, note: dup ? 'déjà dans le cube' : 'ajoutée' }, ...l].slice(0, 30));
      setQuery('');
    } catch (err) {
      setLog((l) => [{ name, ok: false, note: err instanceof Error ? err.message : String(err) }, ...l]);
    } finally {
      setBusy(null);
    }
  }

  const showSuggestions = debounced.trim().length >= 2;

  return (
    <View style={styles.body}>
      <TextField
        icon="search"
        placeholder="Nom de la carte…"
        value={query}
        onChangeText={setQuery}
        autoFocus
        autoCorrect={false}
        right={<View style={styles.busy}>{suggestions.isFetching || busy ? <Spinner /> : null}</View>}
      />
      <FlatList
        data={showSuggestions ? (suggestions.data ?? []) : []}
        keyExtractor={(n) => n}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          showSuggestions ? (
            suggestions.isFetching ? null : (
              <EmptyState icon="search" title="Aucun résultat" hint="Vérifie l'orthographe du nom." />
            )
          ) : log.length === 0 ? (
            <EmptyState
              icon="cube"
              title="Tape, touche, recommence"
              hint="Chaque carte touchée entre directement dans le cube, et le champ se vide pour la suivante."
            />
          ) : (
            <View style={{ gap: Space.xs }}>
              <AppText variant="overline">Ajouts récents</AppText>
              {log.map((l, i) => (
                <View key={`${l.name}-${i}`} style={styles.logLine}>
                  <Icon
                    name={l.ok ? 'check' : 'alert'}
                    size={14}
                    color={l.ok ? Colors.up : Colors.accent}
                    strokeWidth={2}
                  />
                  <AppText variant="caption" numberOfLines={1} style={{ flex: 1, color: Colors.text }}>
                    {l.name}
                  </AppText>
                  <AppText variant="caption">{l.note}</AppText>
                </View>
              ))}
            </View>
          )
        }
        renderItem={({ item: name }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Ajouter ${name} au cube`}
            disabled={busy !== null}
            onPress={() => pick(name)}
            style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: Colors.surfaceHover }]}>
            <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
              {name}
            </AppText>
            {busy === name ? <Spinner /> : <Icon name="plus" size={16} color={Colors.accent} />}
          </Pressable>
        )}
      />
    </View>
  );
}

type ImportState =
  | { step: 'idle' }
  | { step: 'resolving'; done: number; total: number }
  | { step: 'writing' }
  | { step: 'done'; result: AddToCubeResult; notFound: string[] }
  | { step: 'error'; message: string };

function ListMode({ cubeId, onDone }: { cubeId: string; onDone: () => void }) {
  const add = useAddToCube();
  const [text, setText] = useState('');
  const [state, setState] = useState<ImportState>({ step: 'idle' });
  const names = parseCardList(text);
  const working = state.step === 'resolving' || state.step === 'writing';

  async function run() {
    try {
      setState({ step: 'resolving', done: 0, total: names.length });
      const { found, notFound } = await fetchCardsByNames(names, (done, total) =>
        setState({ step: 'resolving', done, total })
      );
      setState({ step: 'writing' });
      const result = await add.mutateAsync({ cubeId, cards: found });
      setState({ step: 'done', result, notFound });
    } catch (err) {
      setState({ step: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (state.step === 'done') {
    const { result, notFound } = state;
    return (
      <ScrollView contentContainerStyle={styles.body}>
        <Surface tone="plate" style={{ gap: Space.xs }}>
          <AppText variant="overline">Import terminé</AppText>
          <AppText variant="title">
            {result.added.length} carte{result.added.length > 1 ? 's' : ''} ajoutée{result.added.length > 1 ? 's' : ''}
          </AppText>
          <AppText variant="caption">
            {result.duplicates.length} déjà présente{result.duplicates.length > 1 ? 's' : ''} ·{' '}
            {notFound.length} introuvable{notFound.length > 1 ? 's' : ''}
          </AppText>
        </Surface>
        {notFound.length > 0 ? (
          <View style={{ gap: Space.xs }}>
            <AppText variant="overline">Introuvables chez Scryfall</AppText>
            <AppText variant="caption">
              Souvent une faute de frappe, ou un nom de face seule pour une carte double. Corrige-les et
              recolle-les.
            </AppText>
            {notFound.map((n) => (
              <AppText key={n} variant="body" style={{ color: Colors.accent }}>
                {n}
              </AppText>
            ))}
          </View>
        ) : null}
        <View style={styles.row}>
          <Button
            label="Importer une autre liste"
            variant="secondary"
            onPress={() => {
              setText(notFound.join('\n'));
              setState({ step: 'idle' });
            }}
            style={{ flex: 1 }}
          />
          <Button label="Voir le cube" onPress={onDone} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <TextField
        placeholder={'Lightning Bolt\n1 Counterspell\n1x Swords to Plowshares (2XM) 34\n…'}
        value={text}
        onChangeText={setText}
        multiline
        autoCorrect={false}
        autoCapitalize="none"
        editable={!working}
        style={styles.textarea}
      />
      <AppText variant="caption">
        Une carte par ligne. Quantités, codes d&apos;édition et en-têtes (« Sideboard ») sont ignorés, et
        les doublons retirés. Les noms anglais exacts sont les plus sûrs.
      </AppText>
      {state.step === 'error' ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          {state.message}
        </AppText>
      ) : null}
      <Button
        label={
          state.step === 'resolving'
            ? `Recherche… ${state.done} / ${state.total}`
            : state.step === 'writing'
              ? 'Enregistrement…'
              : `Importer ${names.length} carte${names.length > 1 ? 's' : ''}`
        }
        icon="plus"
        size="lg"
        onPress={run}
        disabled={names.length === 0 || working}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  modes: { paddingHorizontal: Space.lg, paddingBottom: Space.md },
  body: { flexGrow: 1, paddingHorizontal: Space.lg, paddingBottom: Space.xl, gap: Space.md },
  list: { paddingVertical: Space.sm, gap: 2, flexGrow: 1 },
  busy: { width: 24, alignItems: 'center' },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 44,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
  },
  logLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 26 },
  textarea: { minHeight: 240, textAlignVertical: 'top', paddingTop: Space.md, fontSize: 14 },
  row: { flexDirection: 'row', gap: Space.sm },
});
