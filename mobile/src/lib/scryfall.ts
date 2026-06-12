// Client minimal pour l'API Scryfall (recherche et impressions).
// Doc : https://scryfall.com/docs/api — attribution « Powered by Scryfall » requise.

const BASE = 'https://api.scryfall.com';
const HEADERS = { Accept: 'application/json' };

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
