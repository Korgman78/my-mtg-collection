// Couche données : requêtes et mutations Supabase, mises en cache par React Query.
// Toutes les clés sont préfixées ['collection'] pour invalider d'un seul geste.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cardImages, fetchCardById, fetchSetBulk, type ScryfallCard } from '@/lib/scryfall';
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

/** Taille de page pour les listes qui peuvent grandir avec la collection.
 *
 *  PostgREST plafonne toute réponse à 1000 lignes, et le fait EN SILENCE :
 *  pas d'erreur, pas de drapeau, une liste tronquée se lit exactement comme
 *  une liste complète. C'est ce qui a fait disparaître deux dossiers entiers
 *  du tableau de bord le 2026-08-19, au 1343e exemplaire.
 *
 *  Règle qui en découle : toute requête dont le nombre de lignes croît avec
 *  la collection passe par `selectAll`, ou agrège en base. Un `.select()` nu
 *  sur une table qui grandit est un compte à rebours. */
const PAGE = 1000;

/** Rapatrie toutes les pages d'une requête, jusqu'à en recevoir une
 *  incomplète — c'est le seul signal de fin que PostgREST donne. */
async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = throwIfError(await page(from, from + PAGE - 1)) as T[];
    all.push(...rows);
    if (rows.length < PAGE) return all;
  }
}

/** Taille de lot pour les filtres `in.(…)`.
 *
 *  PostgREST passe ses filtres dans l'URL, et la passerelle Supabase refuse
 *  toute requête au-delà de 24 Ko — sans message utile : un `400 Bad Request`
 *  en texte brut. Un UUID pèse 37 caractères virgule comprise, si bien que la
 *  collection a franchi le seuil dans la nuit du 2026-08-19 (780 cartes,
 *  29 Ko d'URL) et que le tableau de bord ne chargeait plus du tout.
 *
 *  200 ids font 7,5 Ko, soit trois fois moins que la limite. Ne pas remonter
 *  ce nombre pour « économiser une requête » : la marge absorbe l'URL de base
 *  et la croissance de la collection, elle n'est pas de la prudence gratuite. */
const STATS_CHUNK = 200;

async function fetchStats(cardIds: string[]): Promise<Map<string, CardPriceStats>> {
  if (cardIds.length === 0) return new Map();

  const chunks: string[][] = [];
  for (let i = 0; i < cardIds.length; i += STATS_CHUNK) {
    chunks.push(cardIds.slice(i, i + STATS_CHUNK));
  }

  const batches = await Promise.all(
    chunks.map(
      async (chunk) =>
        throwIfError(
          await supabase.from('card_price_stats').select('*').in('card_id', chunk)
        ) as CardPriceStats[]
    )
  );

  return new Map(batches.flat().map((r) => [r.card_id, r]));
}

export type DashboardData = {
  folders: (Folder & { itemCount: number; value: number | null })[];
  totalValue: number;
  totalCards: number;
};

/** Une ligne d'agrégat renvoyée par `collection_summary`. */
type FolderSummary = { folder_id: string; item_count: number; value_eur: number | null };

export function useDashboard() {
  return useQuery({
    queryKey: ['collection', 'dashboard'],
    queryFn: async (): Promise<DashboardData> => {
      // Les sommes se font en base. L'écran téléchargeait auparavant chaque
      // exemplaire pour les calculer ici, et PostgREST tronquait la réponse à
      // 1000 lignes sans le dire : passé ce seuil, des dossiers entiers
      // disparaissaient du décompte. Le nombre de dossiers, lui, ne risque
      // pas d'atteindre le plafond.
      const [folders, summary] = await Promise.all([
        supabase.from('folders').select('*').order('position').order('created_at'),
        supabase.rpc('collection_summary'),
      ]).then((r) => r.map(throwIfError)) as [Folder[], FolderSummary[]];

      const byFolder = new Map(summary.map((s) => [s.folder_id, s]));

      const enriched = folders.map((f) => {
        const acc = byFolder.get(f.id);
        // `value_eur` est nul quand aucune carte du dossier n'a de prix connu :
        // une valeur inconnue, qu'il ne faut pas confondre avec zéro.
        return {
          ...f,
          itemCount: acc?.item_count ?? 0,
          value: acc?.value_eur === null || acc?.value_eur === undefined ? null : Number(acc.value_eur),
        };
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
      const [folderRes, items] = await Promise.all([
        supabase.from('folders').select('*').eq('id', folderId).single(),
        selectAll<FolderItem>((from, to) =>
          supabase
            .from('collection_items')
            .select('*, card:cards(*)')
            .eq('folder_id', folderId)
            .order('added_at', { ascending: false })
            .range(from, to)
        ),
      ]);
      const folder = throwIfError(folderRes) as Folder;

      const stats = await fetchStats([...new Set(items.map((i) => i.card_id))]);
      for (const item of items) item.stats = stats.get(item.card_id);
      return { folder, items };
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Tendances de prix                                                           */
/* -------------------------------------------------------------------------- */

export type MoverWindow = 1 | 3 | 7 | 30;
export type MoverOrder = 'pct' | 'eur';

export type PriceMover = {
  card_id: string;
  name: string;
  set_code: string;
  collector_number: string;
  rarity: string | null;
  image_small: string | null;
  finish: Finish;
  quantity: number;
  price_now: number;
  price_then: number;
  change_pct: number;
  change_eur: number;
};

/** Les plus fortes hausses ou baisses de la collection.
 *
 *  Le classement est fait en base : une collection qui a reçu deux blocs de
 *  set dépasse le millier de lignes, et rapatrier tout ça pour n'en afficher
 *  que douze serait absurde. */
export function usePriceMovers(
  windowDays: MoverWindow,
  order: MoverOrder,
  direction: 'up' | 'down'
) {
  return useQuery({
    queryKey: ['collection', 'movers', windowDays, order, direction],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('collection_price_movers', {
        window_days: windowDays,
        order_by: order,
        direction,
        max_results: 12,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as PriceMover[];
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Tri d'un dossier                                                            */
/* -------------------------------------------------------------------------- */

export type SortKey = 'name' | 'value' | 'gainPct' | 'gainEur';

export const SORT_LABELS: Record<SortKey, string> = {
  name: 'Nom (A → Z)',
  value: 'Valeur de la ligne',
  gainPct: 'Plus forte hausse (%)',
  gainEur: 'Plus forte hausse (€)',
};

/** Les chiffres d'une ligne, calculés une fois pour le tri comme pour l'affichage.
 *
 *  `gainEur` répond à une question que le pourcentage ne pose pas : une
 *  commune qui prend 300 % gagne trois centimes, une rare qui prend 4 % en
 *  gagne douze. Trier par pourcentage remonte la première, trier par euros
 *  remonte la seconde — et ce sont deux questions légitimes, d'où les deux
 *  critères plutôt qu'un seul. */
export function itemMetrics(item: FolderItem) {
  const unit = item.stats ? priceForFinish(item.stats, item.finish) : null;
  const pct =
    (item.finish === 'foil' ? item.stats?.change_7d_pct_foil : item.stats?.change_7d_pct) ?? null;

  const value = unit === null ? null : unit * item.quantity;

  // Le prix d'il y a sept jours se déduit du prix courant et de la variation.
  // À −100 % la carte ne valait rien : on refuse la division.
  //
  // Écart UNITAIRE, jamais multiplié par le nombre d'exemplaires. Multiplier
  // mélange deux questions : de combien la carte a bougé, et combien j’en
  // possède. Trois communes à deux centimes passaient alors devant une rare
  // qui en prend cinq, ce qui ne dit rien du marché et tout de mes achats.
  const gainEur =
    unit === null || pct === null || pct <= -100
      ? null
      : unit - unit / (1 + pct / 100);

  return { unit, value, pct, gainEur };
}

/** Trie une liste d'items. Les lignes sans prix connu finissent en bas :
 *  elles ne sont pas « à zéro », elles sont inconnues. */
export function sortItems(items: FolderItem[], key: SortKey): FolderItem[] {
  const sorted = [...items];

  if (key === 'name') {
    return sorted.sort((a, b) => a.card.name.localeCompare(b.card.name, 'fr'));
  }

  const pick = (item: FolderItem) => {
    const m = itemMetrics(item);
    if (key === 'value') return m.value;
    if (key === 'gainPct') return m.pct;
    return m.gainEur;
  };

  return sorted.sort((a, b) => {
    const va = pick(a);
    const vb = pick(b);
    if (va === null && vb === null) return a.card.name.localeCompare(b.card.name, 'fr');
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va;
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

/** Liste courte des dossiers, pour les sélecteurs (scanner, alertes). */
export function useFoldersLite() {
  return useQuery({
    queryKey: ['collection', 'folders-lite'],
    queryFn: async () =>
      throwIfError(
        await supabase.from('folders').select('id, name, color, kind').order('position')
      ) as Pick<Folder, 'id' | 'name' | 'color' | 'kind'>[],
  });
}

/** Sets dont la référence perceptuelle est construite — c'est-à-dire ce que
 *  le scanner sait reconnaître. Affiché à l'écran pour qu'un échec de scan
 *  sur un set jamais indexé ne passe pas pour une panne. */
export function useHashedSets() {
  return useQuery({
    queryKey: ['scanner', 'hashed-sets'],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      throwIfError(
        await supabase.from('hashed_sets').select('*').order('hashed_at', { ascending: false })
      ) as { set_code: string; set_name: string; card_count: number; hashed_at: string }[],
  });
}

/** Ajoute une carte reconnue par le scanner : la référence ne connaît que
 *  son identité, on repasse par Scryfall pour les prix du jour. */
export function useAddScannedCard() {
  const addCard = useAddCard();
  return useMutation({
    mutationFn: async (input: { folderId: string; cardId: string; finish: Finish }) => {
      const card = await fetchCardById(input.cardId);
      const result = await addCard.mutateAsync({
        folderId: input.folderId,
        card,
        finish: input.finish,
        quantity: 1,
      });
      return { card, ...result };
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
      const today = new Date().toISOString().slice(0, 10);
      const rows = cardRows(card, today);

      // 1. Cache de la carte (ignoré si déjà présente).
      throwIfError(
        await supabase.from('cards').upsert(rows.card, { onConflict: 'id', ignoreDuplicates: true })
      );

      // 2. Prix du jour, pour ne pas attendre l'ingestion nocturne.
      throwIfError(
        await supabase
          .from('price_snapshots')
          .upsert(rows.price, { onConflict: 'card_id,snapped_on', ignoreDuplicates: true })
      );

      // 3. Le finish, borné à ce que l'impression propose réellement.
      //
      //    Certaines cartes n'existent qu'en foil, d'autres qu'en normal.
      //    Enregistrer un finish absent donnerait une ligne sans prix : on
      //    suivrait une carte qui n'existe pas. On retombe alors sur ce que
      //    l'impression a, et on remonte le finish retenu pour que l'écran
      //    puisse dire ce qui a vraiment été enregistré.
      const available = (card.finishes ?? []) as Finish[];
      const finish = available.includes(input.finish) ? input.finish : (available[0] ?? 'nonfoil');

      // 4. L'item lui-même — en cumulant si la carte est déjà là. La clé
      //    inclut le finish : une foil et une normale sont deux lignes.
      const result = await addOrIncrement(input.folderId, card.id, finish, input.quantity);
      return { ...result, finish };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  });
}

/* -------------------------------------------------------------------------- */
/* Bloc de set                                                                 */
/* -------------------------------------------------------------------------- */

/** Lignes d'une carte Scryfall vers nos trois tables. Partagé par l'ajout à
 *  l'unité et par le bloc de set, pour qu'ils écrivent exactement la même chose. */
function cardRows(card: ScryfallCard, today: string) {
  const images = cardImages(card);
  return {
    card: {
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
    price: {
      card_id: card.id,
      snapped_on: today,
      eur: card.prices.eur,
      eur_foil: card.prices.eur_foil,
      eur_etched: card.prices.eur_etched ?? null,
      usd: card.prices.usd,
      usd_foil: card.prices.usd_foil,
      usd_etched: card.prices.usd_etched,
    },
  };
}

/** PostgREST encaisse quelques centaines de lignes d'un coup, mais un lot
 *  plus petit donne une progression lisible et un échec moins coûteux. */
const CHUNK = 100;

function chunked<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/** Les card_id déjà dans le dossier, en pages de 1000.
 *
 *  Pourquoi paginer : PostgREST plafonne une réponse et le fait en silence.
 *  Un dossier qui a reçu deux blocs dépasse le millier de lignes ; une liste
 *  tronquée nous ferait ré-ajouter des cartes déjà présentes, c'est-à-dire
 *  exactement le doublon que cette fonction existe pour éviter. */
async function existingCardIds(folderId: string): Promise<Set<string>> {
  const rows = await selectAll<{ card_id: string }>((from, to) =>
    supabase
      .from('collection_items')
      .select('card_id')
      .eq('folder_id', folderId)
      .range(from, to)
  );
  return new Set(rows.map((r) => r.card_id));
}

export type SetBulkResult = { added: number; skipped: number };

export type SetBulkPhase =
  | { step: 'fetching'; loaded: number; total: number }
  | { step: 'writing'; loaded: number; total: number };

/** Ajoute une copie de chaque commune et peu commune d'un set.
 *
 *  Le but n'est pas de saisir une collection mais de la *suivre* : une fois
 *  ces cartes en base, l'ingestion nocturne leur construit un historique de
 *  prix, et les alertes peuvent porter sur le bulk d'un set entier.
 *
 *  Les cartes déjà présentes dans le dossier sont ignorées, pas dupliquées :
 *  relancer le bloc sur un set complété est sans effet. */
export function useAddSetBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      folderId: string;
      setCode: string;
      onProgress?: (phase: SetBulkPhase) => void;
    }): Promise<SetBulkResult> => {
      const { folderId, setCode, onProgress } = input;

      const cards = await fetchSetBulk(setCode, (loaded, total) =>
        onProgress?.({ step: 'fetching', loaded, total })
      );
      if (cards.length === 0) {
        throw new Error(`Aucune commune ni peu commune trouvée pour « ${setCode.toUpperCase()} ».`);
      }

      const already = await existingCardIds(folderId);
      const toAdd = cards.filter((c) => !already.has(c.id));
      if (toAdd.length === 0) return { added: 0, skipped: cards.length };

      const today = new Date().toISOString().slice(0, 10);
      const rows = toAdd.map((c) => cardRows(c, today));
      let written = 0;
      const progress = () => onProgress?.({ step: 'writing', loaded: written, total: toAdd.length });

      // Trois passes, dans cet ordre : les items référencent les cartes.
      for (const batch of chunked(rows)) {
        throwIfError(
          await supabase
            .from('cards')
            .upsert(batch.map((r) => r.card), { onConflict: 'id', ignoreDuplicates: true })
        );
      }
      for (const batch of chunked(rows)) {
        throwIfError(
          await supabase
            .from('price_snapshots')
            .upsert(batch.map((r) => r.price), {
              onConflict: 'card_id,snapped_on',
              ignoreDuplicates: true,
            })
        );
      }
      for (const batch of chunked(toAdd)) {
        throwIfError(
          await supabase.from('collection_items').insert(
            batch.map((c) => ({
              folder_id: folderId,
              card_id: c.id,
              finish: 'nonfoil' as const,
              quantity: 1,
            }))
          )
        );
        written += batch.length;
        progress();
      }

      return { added: toAdd.length, skipped: cards.length - toAdd.length };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection'] }),
  });
}

/** Ajoute une carte, ou incrémente l'exemplaire existant.
 *
 *  Pourquoi cumuler plutôt qu'insérer une seconde ligne : scanner les quatre
 *  copies d'un playset doit donner « ×4 », pas quatre lignes identiques dans
 *  le dossier. Le cumul ne vaut qu'à finish égal — une foil n'est pas un
 *  exemplaire de plus de la version normale, c'est une autre carte. */
async function addOrIncrement(
  folderId: string,
  cardId: string,
  finish: Finish,
  quantity: number
): Promise<{ merged: boolean; quantity: number }> {
  const existing = (await supabase
    .from('collection_items')
    .select('id, quantity')
    .eq('folder_id', folderId)
    .eq('card_id', cardId)
    .eq('finish', finish)
    .maybeSingle()
    .then(throwIfError)) as { id: string; quantity: number } | null;

  if (existing) {
    const next = existing.quantity + quantity;
    throwIfError(
      await supabase.from('collection_items').update({ quantity: next }).eq('id', existing.id)
    );
    return { merged: true, quantity: next };
  }

  throwIfError(
    await supabase
      .from('collection_items')
      .insert({ folder_id: folderId, card_id: cardId, finish, quantity })
  );
  return { merged: false, quantity };
}

/** Change le nombre d'exemplaires. À zéro, la ligne disparaît : la contrainte
 *  SQL interdit `quantity <= 0`, et un exemplaire à zéro n'a aucun sens. */
export function useSetItemQuantity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { itemId: string; quantity: number }) => {
      if (input.quantity <= 0) {
        throwIfError(await supabase.from('collection_items').delete().eq('id', input.itemId));
        return { removed: true };
      }
      throwIfError(
        await supabase
          .from('collection_items')
          .update({ quantity: input.quantity })
          .eq('id', input.itemId)
      );
      return { removed: false };
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
