// Ajout d'une carte : autocomplete Scryfall dès 2 caractères → choix de
// l'impression (set) → finish + quantité → ajout au dossier.

import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Loading, Screen, TextField } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
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

  function pickCard(card: ScryfallCard) {
    setSelectedCard(card);
    const finishes = card.finishes ?? [];
    setFinish(
      finishes.includes('nonfoil') ? 'nonfoil' : finishes.includes('foil') ? 'foil' : 'etched'
    );
  }

  function submit() {
    if (!selectedCard || !folderId) return;
    addCard.mutate(
      { folderId, card: selectedCard, finish, quantity },
      { onSuccess: () => router.back() }
    );
  }

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <AppText variant="heading">Ajouter une carte</AppText>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <AppText variant="secondary" style={{ fontSize: 17 }}>
            Fermer
          </AppText>
        </Pressable>
      </View>

      <TextField
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

      {/* Étape 1 : suggestions de noms */}
      {!selectedName && (
        <FlatList
          data={suggestions.data ?? []}
          keyExtractor={(name) => name}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.suggestionList}
          renderItem={({ item: name }) => (
            <Pressable
              style={({ pressed }) => [styles.suggestion, pressed && { opacity: 0.7 }]}
              onPress={() => {
                setSelectedName(name);
                setQuery(name);
              }}>
              <AppText>{name}</AppText>
            </Pressable>
          )}
        />
      )}

      {/* Étape 2 : choix de l'impression */}
      {selectedName && !selectedCard && (
        <>
          <AppText variant="small" style={{ marginTop: Spacing.two }}>
            Choisis l&apos;édition
          </AppText>
          {printings.isLoading ? (
            <Loading />
          ) : (
            <FlatList
              data={printings.data ?? []}
              keyExtractor={(card) => card.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.suggestionList}
              renderItem={({ item: card }) => (
                <Pressable
                  style={({ pressed }) => [styles.printing, pressed && { opacity: 0.7 }]}
                  onPress={() => pickCard(card)}>
                  <Image
                    source={{ uri: cardImages(card).small }}
                    style={styles.printingThumb}
                    contentFit="cover"
                    transition={150}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText numberOfLines={1} style={{ fontWeight: '600' }}>
                      {card.set_name}
                    </AppText>
                    <AppText variant="small">
                      {card.set.toUpperCase()} · #{card.collector_number} · {card.released_at?.slice(0, 4)}
                    </AppText>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <AppText variant="price" style={{ fontSize: 15 }}>
                      {card.prices.eur ? formatEur(Number(card.prices.eur)) : '—'}
                    </AppText>
                    {card.prices.eur_foil ? (
                      <AppText variant="small" style={{ color: Colors.foil }}>
                        ✦ {formatEur(Number(card.prices.eur_foil))}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>
              )}
            />
          )}
        </>
      )}

      {/* Étape 3 : finish + quantité */}
      {selectedCard && (
        <View style={styles.confirm}>
          <View style={styles.confirmCard}>
            <Image
              source={{ uri: cardImages(selectedCard).normal }}
              style={styles.confirmImage}
              contentFit="contain"
              transition={200}
            />
            <AppText variant="small">
              {selectedCard.set_name} · #{selectedCard.collector_number}
            </AppText>
          </View>

          <View style={styles.optionRow}>
            {(['nonfoil', 'foil', 'etched'] as const)
              .filter((f) => selectedCard.finishes?.includes(f))
              .map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFinish(f)}
                  style={[styles.option, finish === f && styles.optionSelected]}>
                  <AppText
                    variant="small"
                    style={{
                      fontWeight: '600',
                      color: finish === f ? Colors.text : Colors.textSecondary,
                    }}>
                    {f === 'nonfoil' ? 'Normale' : f === 'foil' ? '✦ Foil' : '✦ Etched'}
                  </AppText>
                </Pressable>
              ))}
          </View>

          <View style={styles.qtyRow}>
            <Pressable onPress={() => setQuantity(Math.max(1, quantity - 1))} style={styles.qtyButton}>
              <AppText style={styles.qtyGlyph}>−</AppText>
            </Pressable>
            <AppText variant="heading" style={{ minWidth: 40, textAlign: 'center' }}>
              {quantity}
            </AppText>
            <Pressable onPress={() => setQuantity(quantity + 1)} style={styles.qtyButton}>
              <AppText style={styles.qtyGlyph}>＋</AppText>
            </Pressable>
          </View>

          {addCard.isError ? (
            <AppText style={{ color: Colors.danger, textAlign: 'center' }}>
              {addCard.error.message}
            </AppText>
          ) : null}

          <Button label="Ajouter au dossier" onPress={submit} loading={addCard.isPending} />
          <Button label="Changer d'édition" variant="ghost" onPress={() => setSelectedCard(null)} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Spacing.three, gap: Spacing.three },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suggestionList: { gap: Spacing.one, paddingTop: Spacing.two },
  suggestion: {
    paddingVertical: Spacing.two + 4,
    paddingHorizontal: Spacing.three,
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
  },
  printing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.two,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  printingThumb: { width: 40, height: 56, borderRadius: 4, backgroundColor: Colors.surfaceAlt },
  confirm: { flex: 1, gap: Spacing.three },
  confirmCard: { alignItems: 'center', gap: Spacing.two },
  confirmImage: { width: '52%', aspectRatio: 63 / 88, borderRadius: Radius.md },
  optionRow: { flexDirection: 'row', gap: Spacing.two },
  option: {
    flex: 1,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  optionSelected: { backgroundColor: Colors.accentSoft, borderWidth: 1, borderColor: Colors.accent },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  qtyButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyGlyph: { fontSize: 22, color: Colors.text, lineHeight: 26 },
});
