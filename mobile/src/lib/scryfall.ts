// Client minimal pour l'API Scryfall (recherche, impressions, bloc de set).
// Doc : https://scryfall.com/docs/api — attribution « Powered by Scryfall » requise.

import { Platform } from 'react-native';

const BASE = 'https://api.scryfall.com';

// Scryfall demande un User-Agent identifiable. Sur le web c'est un en-tête
// interdit : le navigateur le supprime et envoie le sien, on ne le pose donc
// qu'en natif plutôt que de le voir ignoré silencieusement.
const HEADERS = {
  Accept: 'application/json',
  ...(Platform.OS === 'web' ? {} : { 'User-Agent': 'Grimoire/0.1 (collection MTG)' }),
};

/** Scryfall demande 50–100 ms entre deux requêtes. On tient 120 ms. */
const PAGE_DELAY_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ScryfallCard = {
  id: string;
  oracle_id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: string;
  released_at: string;
  finishes: string[];
  games: string[];
  image_uris?: { small?: string; normal?: string };
  card_faces?: { image_uris?: { small?: string; normal?: string } }[];
  prices: {
    eur: string | null;
    eur_foil: string | null;
    eur_etched?: string | null;
    usd: string | null;
    usd_foil: string | null;
    usd_etched: string | null;
  };
};

export function cardImages(card: ScryfallCard): { small?: string; normal?: string } {
  return card.image_uris ?? card.card_faces?.[0]?.image_uris ?? {};
}

/** Suggestions de noms dès 2 caractères tapés. */
export async function autocompleteNames(query: string): Promise<string[]> {
  if (query.trim().length < 2) return [];
  const res = await fetch(`${BASE}/cards/autocomplete?q=${encodeURIComponent(query)}`, {
    headers: HEADERS,
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.data ?? [];
}

/** Toutes les impressions papier d'une carte, de la plus récente à la plus ancienne. */
export async function searchPrintings(name: string): Promise<ScryfallCard[]> {
  const q = encodeURIComponent(`!"${name}" game:paper`);
  const res = await fetch(`${BASE}/cards/search?q=${q}&unique=prints&order=released&dir=desc`, {
    headers: HEADERS,
  });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data ?? []) as ScryfallCard[];
}

/** Une impression précise, par son identifiant Scryfall. Utilisé après un
 *  scan : la référence du scanner ne stocke que l'identité de la carte, les
 *  prix du jour viennent d'ici au moment de l'ajout. */
export async function fetchCardById(id: string): Promise<ScryfallCard> {
  const res = await fetch(`${BASE}/cards/${encodeURIComponent(id)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall a répondu ${res.status} pour la carte ${id}.`);
  return (await res.json()) as ScryfallCard;
}

/* -------------------------------------------------------------------------- */
/* Bloc de set                                                                 */
/* -------------------------------------------------------------------------- */

export type ScryfallSet = {
  code: string;
  name: string;
  card_count: number;
  released_at: string | null;
  set_type: string;
  digital: boolean;
};

/** Le bloc, en une requête. Trois filtres portent une décision :
 *
 *  - `unique=cards` : une seule entrée par carte. Sans lui, un set moderne
 *    renvoie aussi les showcase et extended-art, et on ajouterait la même
 *    commune quatre fois.
 *  - `-t:basic` : les terrains de base sont des communes, mais personne ne
 *    suit le cours d'une Plaine. L'écran le dit explicitement.
 *  - `game:paper` : pas de cartes Arena/MTGO, elles n'ont pas de prix papier.
 */
const bulkQuery = (setCode: string) =>
  `set:${setCode.trim().toLowerCase()} (r:c or r:u) game:paper -t:basic`;

/** Fiche d'un set par son code. `null` si le code n'existe pas. */
export async function fetchSet(code: string): Promise<ScryfallSet | null> {
  const clean = code.trim().toLowerCase();
  if (clean.length < 3) return null;
  const res = await fetch(`${BASE}/sets/${encodeURIComponent(clean)}`, { headers: HEADERS });
  if (!res.ok) return null;
  return (await res.json()) as ScryfallSet;
}

/** Combien de cartes le bloc ajouterait, sans les télécharger. */
export async function countSetBulk(code: string): Promise<number> {
  const q = encodeURIComponent(bulkQuery(code));
  const res = await fetch(`${BASE}/cards/search?q=${q}&unique=cards`, { headers: HEADERS });
  // 404 = « aucune carte ne correspond », le cas normal d'un set sans
  // commune (produits spéciaux, decks Commander). Ce n'est pas une panne.
  if (res.status === 404) return 0;
  if (!res.ok) throw new Error(`Scryfall a répondu ${res.status}.`);
  const json = await res.json();
  return (json.total_cards as number) ?? 0;
}

/** Le bloc complet, page par page (175 cartes par page chez Scryfall). */
export async function fetchSetBulk(
  code: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<ScryfallCard[]> {
  const q = encodeURIComponent(bulkQuery(code));
  let url: string | null = `${BASE}/cards/search?q=${q}&unique=cards&order=set`;
  const cards: ScryfallCard[] = [];
  let total = 0;

  while (url) {
    const res: Response = await fetch(url, { headers: HEADERS });
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`Scryfall a répondu ${res.status}.`);
    const json = await res.json();

    total = (json.total_cards as number) ?? cards.length;
    cards.push(...((json.data ?? []) as ScryfallCard[]));
    onProgress?.(cards.length, total);

    url = json.has_more ? (json.next_page as string) : null;
    if (url) await sleep(PAGE_DELAY_MS);
  }

  return cards;
}
