// Couche données : requêtes et mutations Supabase, mises en cache par React Query.
// Toutes les clés sont préfixées ['collection'] pour invalider d'un seul geste.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cardImages, type ScryfallCard } from '@/lib/scryfall';
import { supabase } from '@/lib/supabase';
import {
  priceForFinish,
  type CardPriceStats,
  type CardRow,
  type CollectionItem,
  type Finish,
  type Folder,
  type PriceSnapshot,
} from '@/lib/types';

function throwIfError<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

async function fetchStats(cardIds: string[]): Promise<Map<string, CardPriceStats>> {
  if (cardIds.length === 0) return new Map();
  const rows = throwIfError(
    await supabase.from('card_price_stats').select('*').in('card_id', cardIds)
  ) as CardPriceStats[];
  return new Map(rows.map((r) => [r.card_id, r]));
}

export type DashboardData = {
  folders: (Folder & { itemCount: number; value: number | null })[];
  totalValue: number;
  totalCards: number;
};

export function useDashboard() {
  return useQuery({
    queryKey: ['collection', 'dashboard'],
    queryFn: async (): Promise<DashboardData> => {
      const [folders, items] = await Promise.all([
        supabase.from('folders').select('*').order('position').order('created_at'),
        supabase.from('collection_items').select('id, folder_id, card_id, finish, quantity'),
      ]).then((r) => r.map(throwIfError)) as [Folder[], CollectionItem[]];

      const stats = await fetchStats([...new Set(items.map((i) => i.card_id))]);

      const byFolder = new Map<string, { count: number; value: number; priced: boolean }>();
      for (const item of items) {
        const acc = byFolder.get(item.folder_id) ?? { count: 0, value: 0, priced: false };
        acc.count += item.quantity;
        const stat = stats.get(item.card_id);
        const price = stat ? priceForFinish(stat, item.finish) : null;
        if (price !== null) {
          acc.value += price * item.quantity;
          acc.priced = true;
        }
        byFolder.set(item.folder_id, acc);
      }

      const enriched = folders.map((f) => {
        const acc = byFolder.get(f.id);
        return { ...f, itemCount: acc?.count ?? 0, value: acc?.priced ? acc.value : null };
      });
      return {
        folders: enriched,
        totalValue: enriched
          .filter((f) => f.kind === 'collection')
          .reduce((sum, f) => sum + (f.value ?? 0), 0),
        totalCards: enriched
          .filter((f) => f.kind === 'collection')
          .reduce((sum, f) => sum + f.itemCount, 0),
      };
    },
  });
}

export type FolderItem = CollectionItem & { card: CardRow; stats?: CardPriceStats };

export function useFolder(folderId: string) {
  return useQuery({
    queryKey: ['collection', 'folder', folderId],
    queryFn: async () => {
      const [folder, items] = await Promise.all([
        supabase.from('folders').select('*').eq('id', folderId).single(),
        supabase
          .from('collection_items')
          .select('*, card:cards(*)')
          .eq('folder_id', folderId)
          .order('added_at', { ascending: false }),
      ]).then((r) => r.map(throwIfError)) as [Folder, FolderItem[]];

      const stats = await fetchStats([...new Set(items.map((i) => i.card_id))]);
      for (const item of items) item.stats = stats.get(item.card_id);
      return { folder, items };
    },
  });
}

export function useCardDetail(cardId: string, itemId?: string) {
  return useQuery({
    queryKey: ['collection', 'card', cardId, itemId ?? null],
    queryFn: async () => {
      const [card, snapshots, statsMap, item] = await Promise.all([
        supabase.from('cards').select('*').eq('id', cardId).single().then(throwIfError) as Promise<CardRow>,
        supabase
          .from('price_snapshots')
          .select('*')
          .eq('card_id', cardId)
          .order('snapped_on')
          .then(throwIfError) as Promise<PriceSnapshot[]>,
        fetchStats([cardId]),
        itemId
          ? (supabase
              .from('collection_items')
              .select('*')
              .eq('id', itemId)
              .maybeSingle()
              .then(throwIfError) as Promise<CollectionItem | null>)
          : Promise.resolve(null),
      ]);
      return { card, snapshots, stats: statsMap.get(cardId) ?? null, item };
    },
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; color: string; kind: 'collection' | 'wishlist' }) => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('Non connecté');
      throwIfError(await supabase.from('folders').insert({ ...input, user_id: user.id }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (folderId: string) => {
      throwIfError(await supabase.from('folders').delete().eq('id', folderId));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  });
}

export function useAddCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      folderId: string;
      card: ScryfallCard;
      finish: Finish;
      quantity: number;
    }) => {
      const { card } = input;
      const images = cardImages(card);

      // 1. Cache de la carte (ignoré si déjà présente).
      throwIfError(
        await supabase.from('cards').upsert(
          {
            id: card.id,
            oracle_id: card.oracle_id,
            name: card.name,
            set_code: card.set,
            collector_number: card.collector_number,
            rarity: card.rarity,
            image_normal: images.normal ?? null,
            image_small: images.small ?? null,
            finishes: card.finishes,
            released_at: card.released_at,
          },
          { onConflict: 'id', ignoreDuplicates: true }
        )
      );

      // 2. Prix du jour, pour ne pas attendre l'ingestion nocturne.
      const today = new Date().toISOString().slice(0, 10);
      const p = card.prices;
      throwIfError(
        await supabase.from('price_snapshots').upsert(
          {
            card_id: card.id,
            snapped_on: today,
            eur: p.eur,
            eur_foil: p.eur_foil,
            eur_etched: p.eur_etched ?? null,
            usd: p.usd,
            usd_foil: p.usd_foil,
            usd_etched: p.usd_etched,
          },
          { onConflict: 'card_id,snapped_on', ignoreDuplicates: true }
        )
      );

      // 3. L'item de collection lui-même.
      throwIfError(
        await supabase.from('collection_items').insert({
          folder_id: input.folderId,
          card_id: card.id,
          finish: input.finish,
          quantity: input.quantity,
        })
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      throwIfError(await supabase.from('collection_items').delete().eq('id', itemId));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  });
}
