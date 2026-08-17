// Ajout d'une carte, en trois temps : nom (autocomplete Scryfall) →
// édition → finish et quantité. Chaque étape est annoncée et réversible.

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icons';
import {
  AppBar,
  AppText,
  Button,
  EmptyState,
  FormField,
  IconButton,
  Loading,
  Screen,
  Segmented,
  Stepper,
  TextField,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import { useAddCard } from '@/lib/collection';
import { formatEur } from '@/lib/format';
import { autocompleteNames, cardImages, searchPrintings, type ScryfallCard } from '@/lib/scryfall';
import type { Finish } from '@/lib/types';

function useDebounced(value: string, delay = 200) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const FINISH_LABEL: Record<Finish, string> = {
  nonfoil: 'Normale',
  foil: 'Foil',
  etched: 'Etched',
};

export default function AddCardScreen() {
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const router = useRouter();
  const addCard = useAddCard();

  const [query, setQuery] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<ScryfallCard | null>(null);
  const [finish, setFinish] = useState<Finish>('nonfoil');
  const [quantity, setQuantity] = useState(1);

  const debouncedQuery = useDebounced(query);
  const suggestions = useQuery({
    queryKey: ['scryfall', 'autocomplete', debouncedQuery],
    queryFn: () => autocompleteNames(debouncedQuery),
    enabled: !selectedName && debouncedQuery.trim().length >= 2,
  });

  const printings = useQuery({
    queryKey: ['scryfall', 'printings', selectedName],
    queryFn: () => searchPrintings(selectedName!),
    enabled: !!selectedName,
  });

  const step = selectedCard ? 3 : selectedName ? 2 : 1;
  const stepLabel = { 1: 'Trouve la carte', 2: "Choisis l'édition", 3: 'Précise ton exemplaire' }[step];

  function pickCard(card: ScryfallCard) {
    setSelectedCard(card);
    const finishes = card.finishes ?? [];
    setFinish(
      finishes.includes('nonfoil') ? 'nonfoil' : finishes.includes('foil') ? 'foil' : 'etched'
    );
  }

  function submit() {
    if (!selectedCard || !folderId) return;
    addCard.mutate({ folderId, card: selectedCard, finish, quantity }, { onSuccess: () => router.back() });
  }

  return (
    <Screen>
      <AppBar
        title="Ajouter une carte"
        subtitle={`Étape ${step} sur 3 · ${stepLabel}`}
        right={<IconButton name="close" label="Fermer" onPress={() => router.back()} />}
      />

      <View style={styles.body}>
        {/* Étape 1 — nom */}
        {step === 1 && (
          <>
            <TextField
              icon="search"
              placeholder="Nom de la carte…"
              value={query}
              autoFocus
              autoCorrect={false}
              onChangeText={(text) => {
                setQuery(text);
                setSelectedName(null);
                setSelectedCard(null);
              }}
            />
            {debouncedQuery.trim().length < 2 ? (
              <EmptyState
                icon="search"
                title="Cherche par le nom"
                hint="Tape au moins deux lettres. Les suggestions viennent directement de Scryfall."
              />
            ) : (
              <FlatList
                data={suggestions.data ?? []}
                keyExtractor={(name) => name}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.list}
                ListEmptyComponent={
                  suggestions.isFetching ? (
                    <Loading />
                  ) : (
                    <EmptyState icon="search" title="Aucun résultat" hint="Vérifie l'orthographe du nom." />
                  )
                }
                renderItem={({ item: name }) => (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setSelectedName(name);
                      setQuery(name);
                    }}
                    style={({ pressed }) => [styles.suggestion, pressed && styles.rowPressed]}>
                    <AppText variant="body" numberOfLines={1} style={{ flex: 1 }}>
                      {name}
                    </AppText>
                    <Icon name="chevronRight" size={16} color={Colors.textTertiary} />
                  </Pressable>
                )}
              />
            )}
          </>
        )}

        {/* Étape 2 — édition */}
        {step === 2 && (
          <>
            <Button
              label={selectedName ?? 'Changer de carte'}
              icon="chevronLeft"
              variant="secondary"
              size="sm"
              style={{ alignSelf: 'flex-start' }}
              onPress={() => {
                setSelectedName(null);
                setQuery('');
              }}
            />
            {printings.isLoading ? (
              <Loading />
            ) : (
              <FlatList
                data={printings.data ?? []}
                keyExtractor={(card) => card.id}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.list}
                renderItem={({ item: card }) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Choisir l'édition ${card.set_name}`}
                    onPress={() => pickCard(card)}
                    style={({ pressed }) => [styles.printing, pressed && styles.rowPressed]}>
                    <Image
                      source={{ uri: cardImages(card).small }}
                      style={styles.printingThumb}
                      contentFit="cover"
                      transition={150}
                    />
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="heading" numberOfLines={1}>
                        {card.set_name}
                      </AppText>
                      <AppText variant="caption" numberOfLines={1}>
                        {card.set.toUpperCase()} · #{card.collector_number} ·{' '}
                        {card.released_at?.slice(0, 4)}
                      </AppText>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <AppText variant="price">
                        {card.prices.eur ? formatEur(Number(card.prices.eur)) : '—'}
                      </AppText>
                      {card.prices.eur_foil ? (
                        <AppText variant="caption" style={{ color: Colors.foil }}>
                          foil {formatEur(Number(card.prices.eur_foil))}
                        </AppText>
                      ) : null}
                    </View>
                  </Pressable>
                )}
              />
            )}
          </>
        )}

        {/* Étape 3 — finish et quantité */}
        {step === 3 && selectedCard && (
          <View style={styles.confirm}>
            <View style={styles.confirmHero}>
              <Image
                source={{ uri: cardImages(selectedCard).normal }}
                style={styles.confirmImage}
                contentFit="contain"
                transition={200}
              />
              <AppText variant="caption">
                {selectedCard.set_name} · #{selectedCard.collector_number}
              </AppText>
            </View>

            <FormField label="Finition">
              <Segmented
                options={(['nonfoil', 'foil', 'etched'] as const)
                  .filter((f) => selectedCard.finishes?.includes(f))
                  .map((f) => ({ value: f, label: FINISH_LABEL[f] }))}
                value={finish}
                onChange={setFinish}
              />
            </FormField>

            <FormField label="Quantité">
              <Stepper value={quantity} onChange={setQuantity} />
            </FormField>

            {addCard.isError ? (
              <AppText variant="caption" style={{ color: Colors.danger }}>
                {addCard.error.message}
              </AppText>
            ) : null}

            <View style={styles.confirmActions}>
              <Button
                label="Ajouter au dossier"
                icon="check"
                size="lg"
                onPress={submit}
                loading={addCard.isPending}
              />
              <Button
                label="Changer d'édition"
                icon="chevronLeft"
                variant="ghost"
                onPress={() => setSelectedCard(null)}
              />
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: Space.lg, paddingBottom: Space.lg, gap: Space.lg },
  list: { gap: Space.sm, paddingBottom: Space.xl, flexGrow: 1 },
  rowPressed: { backgroundColor: Colors.surfaceHover },

  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 48,
    paddingHorizontal: Space.lg,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  printing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  printingThumb: {
    width: 38,
    height: 53,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
  },

  confirm: { flex: 1, gap: Space.xl },
  confirmHero: { alignItems: 'center', gap: Space.sm },
  confirmImage: { width: '52%', maxWidth: 220, aspectRatio: 63 / 88, borderRadius: Radius.lg },
  confirmActions: { marginTop: 'auto', gap: Space.sm },
});
