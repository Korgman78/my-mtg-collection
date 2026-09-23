// Client minimal pour l'API Scryfall (recherche, impressions, bloc de set).
// Doc : https://scryfall.com/docs/api — attribution « Powered by Scryfall » requise.

import { Platform } from 'react-native';

const BASE = 'https://api.scryfall.com';

// Scryfall demande un User-Agent identifiable. Sur le web c'est un en-tête
// interdit : le navigateur le supprime et envoie le sien, on ne le pose donc
// qu'en natif plutôt que de le voir ignoré silencieusement.
const HEADERS = {
  Accept: 'application/json',
  ...(Platform.OS === 'web' ? {} : { 'User-Agent': 'MyMTGCollection/0.1 (collection MTG)' }),
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
  card_faces?: {
    image_uris?: { small?: string; normal?: string };
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    colors?: string[];
  }[];
  // Données de jeu, utilisées par le cube builder.
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  produced_mana?: string[];
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

/** Données de jeu d'une carte, au format des colonnes de `cards`.
 *
 *  Une carte double face n'a ni coût ni couleurs à la racine : on prend le
 *  coût de la face avant et l'union des couleurs des faces. Même règle que
 *  `cardRules` dans scripts/ingest.mjs — les deux doivent écrire la même
 *  chose, sinon une carte changerait de couleur à la première nuit. */
export function cardRules(card: ScryfallCard) {
  const faces = card.card_faces ?? [];
  return {
    mana_cost: card.mana_cost ?? faces[0]?.mana_cost ?? null,
    cmc: card.cmc ?? null,
    type_line: card.type_line ?? null,
    oracle_text:
      card.oracle_text ??
      (faces.length ? faces.map((f) => f.oracle_text ?? '').join('\n//\n') : null),
    colors: card.colors ?? [...new Set(faces.flatMap((f) => f.colors ?? []))],
    color_identity: card.color_identity ?? [],
    keywords: card.keywords ?? [],
    produced_mana: card.produced_mana ?? null,
  };
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

/** Plusieurs impressions d'un coup, par leurs identifiants.
 *
 *  Endpoint `/cards/collection` : une seule requête pour jusqu'à 75 cartes,
 *  là où `fetchCardById` en demanderait une par carte. Le scanner propose
 *  jusqu'à cinq candidats et veut le prix de chacun — cinq allers-retours se
 *  verraient à l'écran, et Scryfall demande 120 ms entre deux requêtes.
 *
 *  Renvoie une table id → impression plutôt qu'un tableau : Scryfall ne
 *  garantit pas l'ordre, et il écarte silencieusement les identifiants qu'il
 *  ne connaît pas (`not_found`). Chercher par clé évite de croire qu'on lit
 *  le prix d'une carte alors qu'on lit celui de la suivante. */
export async function fetchCardsByIds(ids: string[]): Promise<Map<string, ScryfallCard>> {
  if (ids.length === 0) return new Map();

  const res = await fetch(`${BASE}/cards/collection`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiers: ids.slice(0, 75).map((id) => ({ id })) }),
  });
  if (!res.ok) throw new Error(`Scryfall a répondu ${res.status}.`);

  const json = await res.json();
  return new Map(((json.data ?? []) as ScryfallCard[]).map((card) => [card.id, card]));
}

/** L'impression par défaut d'une carte, par son nom exact. C'est celle que
 *  Scryfall montre en tête de fiche : la plus récente en papier, hors
 *  variantes. Pour un cube, l'édition importe peu — l'illustration suffit. */
export async function fetchNamedCard(name: string): Promise<ScryfallCard> {
  const res = await fetch(`${BASE}/cards/named?exact=${encodeURIComponent(name)}`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`Scryfall ne connaît pas « ${name} ».`);
  return (await res.json()) as ScryfallCard;
}

/** Résolution d'une liste de noms, par lots de 75 (`/cards/collection`).
 *
 *  Scryfall renvoie à part, dans `not_found`, les noms qu'il ne reconnaît
 *  pas : on les remonte tels quels pour que l'écran les montre, plutôt que
 *  de laisser une liste de 360 cartes arriver à 352 sans dire lesquelles
 *  manquent. */
export async function fetchCardsByNames(
  names: string[],
  onProgress?: (done: number, total: number) => void
): Promise<{ found: ScryfallCard[]; notFound: string[] }> {
  const found: ScryfallCard[] = [];
  const notFound: string[] = [];

  for (let i = 0; i < names.length; i += 75) {
    if (i > 0) await sleep(PAGE_DELAY_MS);
    const batch = names.slice(i, i + 75);
    const res = await fetch(`${BASE}/cards/collection`, {
      method: 'POST',
      headers: { ...HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) }),
    });
    if (!res.ok) throw new Error(`Scryfall a répondu ${res.status}.`);
    const json = await res.json();
    found.push(...((json.data ?? []) as ScryfallCard[]));
    notFound.push(...((json.not_found ?? []) as { name?: string }[]).map((n) => n.name ?? '?'));
    onProgress?.(Math.min(i + 75, names.length), names.length);
  }

  // Seconde chance, une par une, en recherche approximative. Le lot exige
  // le nom exact, et refuse même certains noms exacts : « Fire // Ice » y
  // est introuvable (mesuré), alors que `named?fuzzy` la trouve — comme il
  // rattrape « lightning blot ». Au-delà de 40 ratés, la liste a un autre
  // problème qu'une faute de frappe : on ne martèle pas Scryfall pour ça.
  const stillMissing: string[] = [];
  for (const name of notFound) {
    if (notFound.length > 40) {
      stillMissing.push(name);
      continue;
    }
    await sleep(PAGE_DELAY_MS);
    const res = await fetch(`${BASE}/cards/named?fuzzy=${encodeURIComponent(name)}`, {
      headers: HEADERS,
    });
    if (res.ok) found.push((await res.json()) as ScryfallCard);
    else stillMissing.push(name);
  }

  return { found, notFound: stillMissing };
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
