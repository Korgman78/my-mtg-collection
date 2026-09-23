// Lecture d'un cube : classement des cartes, filtres et statistiques.
//
// Fonctions pures, sans React ni réseau : tout se calcule à partir de la
// liste des cartes déjà chargée. Un cube de 540 cartes se parcourt en une
// fraction de milliseconde, rien ne justifie d'aller agréger en base.

import type { ArchetypeLink, CardRow, CubeArchetype, CubeCard, ManaColor } from '@/lib/types';

export const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];

/** Section d'une carte dans le cube, au sens où les cubeurs l'entendent :
 *  une couleur, multicolore, incolore, ou terrain. */
export type Section = ManaColor | 'M' | 'C' | 'L';

export const SECTIONS: Section[] = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L'];

export const SECTION_LABELS: Record<Section, string> = {
  W: 'Blanc',
  U: 'Bleu',
  B: 'Noir',
  R: 'Rouge',
  G: 'Vert',
  M: 'Multicolore',
  C: 'Incolore',
  L: 'Terrains',
};

/** Pigments des sections. Les cinq couleurs reprennent la palette des
 *  dossiers (même monde) ; le blanc y était de l'or, trop proche de
 *  l'accent pour une donnée — on l'éclaircit en parchemin. */
export const SECTION_COLORS: Record<Section, string> = {
  W: '#E4D6AE',
  U: '#5A8FC7',
  B: '#8A72C9',
  R: '#C4564B',
  G: '#63A96F',
  M: '#C9A227',
  C: '#9D9179',
  L: '#B0754A',
};

export type CardType =
  | 'creature'
  | 'planeswalker'
  | 'instant'
  | 'sorcery'
  | 'artifact'
  | 'enchantment'
  | 'battle'
  | 'land';

export const CARD_TYPES: CardType[] = [
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'planeswalker',
  'battle',
  'land',
];

export const TYPE_LABELS: Record<CardType, string> = {
  creature: 'Créature',
  planeswalker: 'Planeswalker',
  instant: 'Éphémère',
  sorcery: 'Rituel',
  artifact: 'Artefact',
  enchantment: 'Enchantement',
  battle: 'Bataille',
  land: 'Terrain',
};

/** Type de la face avant. Une carte modale « Éphémère // Terrain » se joue
 *  d'abord comme un sort, et c'est ainsi qu'un cube la compte. */
function frontType(card: CardRow): string {
  return (card.type_line ?? '').split(' // ')[0];
}

/** Le type qui décide du rôle de la carte. Une créature-artefact est une
 *  créature : c'est elle qui tient le terrain, pas son sous-type. */
export function primaryType(card: CardRow): CardType | null {
  const t = frontType(card);
  if (!t) return null;
  if (t.includes('Creature')) return 'creature';
  if (t.includes('Planeswalker')) return 'planeswalker';
  if (t.includes('Battle')) return 'battle';
  if (t.includes('Instant')) return 'instant';
  if (t.includes('Sorcery')) return 'sorcery';
  if (t.includes('Land')) return 'land';
  if (t.includes('Artifact')) return 'artifact';
  if (t.includes('Enchantment')) return 'enchantment';
  return null;
}

export function isLand(card: CardRow): boolean {
  return frontType(card).includes('Land');
}

/** `null` quand les données de jeu manquent encore : une carte inconnue ne
 *  doit pas gonfler la section « Incolore » en douce. */
export function sectionOf(card: CardRow): Section | null {
  if (card.type_line == null) return null;
  if (isLand(card)) return 'L';
  const colors = card.colors ?? [];
  if (colors.length === 0) return 'C';
  if (colors.length > 1) return 'M';
  return colors[0] as ManaColor;
}

/** Tranche de courbe : 0 à 6, et 7 pour « 7 et plus ». */
export function cmcBucket(card: CardRow): number {
  return Math.min(7, Math.floor(card.cmc ?? 0));
}

export const CMC_BUCKETS = [0, 1, 2, 3, 4, 5, 6, 7];
export const cmcLabel = (b: number) => (b === 7 ? '7+' : String(b));

/** Ordre d'affichage WUBRG d'un ensemble de couleurs. */
export function sortColors(colors: readonly string[]): ManaColor[] {
  return MANA_COLORS.filter((c) => colors.includes(c));
}

/* -------------------------------------------------------------------------- */
/* Filtres                                                                     */
/* -------------------------------------------------------------------------- */

export type CubeFilter = {
  sections: Section[];
  types: CardType[];
  cmcs: number[];
  query: string;
  /** `'none'` = cartes rattachées à aucun archétype. */
  archetype: string | 'none' | null;
};

export const EMPTY_FILTER: CubeFilter = {
  sections: [],
  types: [],
  cmcs: [],
  query: '',
  archetype: null,
};

export function isFiltering(f: CubeFilter): boolean {
  return (
    f.sections.length > 0 ||
    f.types.length > 0 ||
    f.cmcs.length > 0 ||
    f.query.trim().length > 0 ||
    f.archetype !== null
  );
}

/** Minuscules sans accents, comme `normalize` de format.ts — recopié ici
 *  pour garder ce module sans dépendance. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Filtre une liste. Chaque critère est un OU en interne (« Blanc ou
 *  Bleu »), et les critères se combinent en ET (« … et à 2 »). La recherche
 *  porte sur le nom, la ligne de type et le texte : « flying » ou « Goblin »
 *  trouvent ce qu'on attend. */
export function applyFilter(
  cards: CubeCard[],
  f: CubeFilter,
  links: ArchetypeLink[] = []
): CubeCard[] {
  const needle = fold(f.query);
  const inArchetype =
    f.archetype === null
      ? null
      : f.archetype === 'none'
        ? new Set(links.map((l) => l.cube_card_id))
        : new Set(links.filter((l) => l.archetype_id === f.archetype).map((l) => l.cube_card_id));

  return cards.filter((cc) => {
    const card = cc.card;
    if (f.sections.length) {
      const s = sectionOf(card);
      if (!s || !f.sections.includes(s)) return false;
    }
    if (f.types.length) {
      const t = primaryType(card);
      if (!t || !f.types.includes(t)) return false;
    }
    if (f.cmcs.length) {
      if (isLand(card) || !f.cmcs.includes(cmcBucket(card))) return false;
    }
    if (inArchetype) {
      const member = inArchetype.has(cc.id);
      if (f.archetype === 'none' ? member : !member) return false;
    }
    if (needle) {
      const hay = fold(`${card.name} ${card.type_line ?? ''} ${card.oracle_text ?? ''}`);
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export type CubeSort = 'section' | 'cmc' | 'name' | 'added';

export const SORT_LABELS: Record<CubeSort, string> = {
  section: 'Couleur puis coût',
  cmc: 'Coût de mana',
  name: 'Nom (A → Z)',
  added: 'Ajout récent',
};

export function sortCards(cards: CubeCard[], sort: CubeSort): CubeCard[] {
  const byName = (a: CubeCard, b: CubeCard) => a.card.name.localeCompare(b.card.name, 'fr');
  const byCmc = (a: CubeCard, b: CubeCard) => (a.card.cmc ?? 0) - (b.card.cmc ?? 0);
  const sectionIndex = (cc: CubeCard) => {
    const s = sectionOf(cc.card);
    return s ? SECTIONS.indexOf(s) : SECTIONS.length;
  };
  const out = [...cards];
  if (sort === 'name') return out.sort(byName);
  if (sort === 'added') return out.sort((a, b) => b.added_at.localeCompare(a.added_at));
  if (sort === 'cmc') return out.sort((a, b) => byCmc(a, b) || byName(a, b));
  return out.sort((a, b) => sectionIndex(a) - sectionIndex(b) || byCmc(a, b) || byName(a, b));
}

/* -------------------------------------------------------------------------- */
/* Statistiques                                                                */
/* -------------------------------------------------------------------------- */

/** Les dix paires de couleurs, dans l'ordre du cercle (alliées puis ennemies). */
export const PAIRS: { key: string; name: string }[] = [
  { key: 'WU', name: 'Azorius' },
  { key: 'UB', name: 'Dimir' },
  { key: 'BR', name: 'Rakdos' },
  { key: 'RG', name: 'Gruul' },
  { key: 'GW', name: 'Selesnya' },
  { key: 'WB', name: 'Orzhov' },
  { key: 'UR', name: 'Izzet' },
  { key: 'BG', name: 'Golgari' },
  { key: 'RW', name: 'Boros' },
  { key: 'GU', name: 'Simic' },
];

const pairKey = (colors: readonly string[]) => {
  const set = new Set(colors);
  return PAIRS.find((p) => set.has(p.key[0]) && set.has(p.key[1]))?.key ?? null;
};

export type CubeStats = {
  total: number;
  /** Cartes dont les données de jeu ne sont pas encore connues. */
  unknown: number;
  sections: Record<Section, number>;
  types: Record<CardType, number>;
  /** Courbe des sorts (terrains exclus), toutes couleurs. */
  curve: number[];
  /** Courbe par section, pour la matrice couleur × coût. */
  curveBySection: Record<Section, number[]>;
  nonLand: number;
  creatures: number;
  avgCmc: number | null;
  avgCmcBySection: Record<Section, number | null>;
  creaturesBySection: Record<Section, { creatures: number; spells: number }>;
  /** Cartes bicolores par paire, et terrains qui produisent les deux couleurs. */
  pairs: Record<string, { cards: number; fixing: number }>;
  threePlus: number;
  /** Présence de chaque couleur, multicolores comprises (une carte WU compte
   *  pour W et pour U) : ce que chaque couleur offre vraiment en draft. */
  colorPresence: Record<ManaColor, number>;
};

const zeroSections = <T>(make: () => T) =>
  Object.fromEntries(SECTIONS.map((s) => [s, make()])) as Record<Section, T>;

export function cubeStats(cards: CubeCard[]): CubeStats {
  const sections = zeroSections(() => 0);
  const curveBySection = zeroSections(() => CMC_BUCKETS.map(() => 0));
  const cmcSum = zeroSections(() => 0);
  const creaturesBySection = zeroSections(() => ({ creatures: 0, spells: 0 }));
  const types = Object.fromEntries(CARD_TYPES.map((t) => [t, 0])) as Record<CardType, number>;
  const curve = CMC_BUCKETS.map(() => 0);
  const pairs = Object.fromEntries(PAIRS.map((p) => [p.key, { cards: 0, fixing: 0 }]));
  const colorPresence = { W: 0, U: 0, B: 0, R: 0, G: 0 } as Record<ManaColor, number>;
  let unknown = 0;
  let nonLand = 0;
  let creatures = 0;
  let cmcTotal = 0;
  let threePlus = 0;

  for (const { card } of cards) {
    const section = sectionOf(card);
    if (!section) {
      unknown++;
      continue;
    }
    sections[section]++;
    const type = primaryType(card);
    if (type) types[type]++;

    for (const c of card.colors ?? []) {
      if (c in colorPresence) colorPresence[c as ManaColor]++;
    }

    if (section === 'L') {
      // Un terrain qui produit deux couleurs d'une paire la « fixe ».
      const produced = (card.produced_mana ?? []).filter((c) => c !== 'C');
      if (produced.length >= 2) {
        for (const p of PAIRS) {
          if (produced.includes(p.key[0]) && produced.includes(p.key[1])) pairs[p.key].fixing++;
        }
      }
      continue;
    }

    nonLand++;
    const b = cmcBucket(card);
    curve[b]++;
    curveBySection[section][b]++;
    cmcTotal += card.cmc ?? 0;
    cmcSum[section] += card.cmc ?? 0;
    if (type === 'creature') {
      creatures++;
      creaturesBySection[section].creatures++;
    } else {
      creaturesBySection[section].spells++;
    }

    if (section === 'M') {
      const colors = card.colors ?? [];
      if (colors.length === 2) {
        const key = pairKey(colors);
        if (key) pairs[key].cards++;
      } else {
        threePlus++;
      }
    }
  }

  const avgCmcBySection = Object.fromEntries(
    SECTIONS.map((s) => {
      const n = sections[s] && s !== 'L' ? sections[s] : 0;
      return [s, n ? cmcSum[s] / n : null];
    })
  ) as Record<Section, number | null>;

  return {
    total: cards.length,
    unknown,
    sections,
    types,
    curve,
    curveBySection,
    nonLand,
    creatures,
    avgCmc: nonLand ? cmcTotal / nonLand : null,
    avgCmcBySection,
    creaturesBySection,
    pairs,
    threePlus,
    colorPresence,
  };
}

/* -------------------------------------------------------------------------- */
/* Archétypes                                                                  */
/* -------------------------------------------------------------------------- */

/** Une carte se joue dans un archétype si ses couleurs y sont toutes. Les
 *  incolores se jouent partout — on les compte à part, sinon elles gonflent
 *  tous les archétypes du même nombre et l'équilibre ne dit plus rien. */
export function fitsColors(card: CardRow, colors: readonly string[]): 'colored' | 'colorless' | null {
  if (isLand(card) || card.type_line == null) return null;
  const own = card.colors ?? [];
  if (own.length === 0) return 'colorless';
  return own.every((c) => colors.includes(c)) ? 'colored' : null;
}

export type ArchetypeSummary = {
  archetype: CubeArchetype;
  /** Cartes rattachées explicitement. */
  members: CubeCard[];
  keyCards: CubeCard[];
  /** Cartes colorées jouables dans ses couleurs, rattachées ou non. */
  playable: number;
  creatures: number;
  curve: number[];
};

export function archetypeSummaries(
  archetypes: CubeArchetype[],
  cards: CubeCard[],
  links: ArchetypeLink[]
): ArchetypeSummary[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return archetypes.map((archetype) => {
    const own = links.filter((l) => l.archetype_id === archetype.id);
    const members = own.map((l) => byId.get(l.cube_card_id)).filter((c): c is CubeCard => !!c);
    const keyIds = new Set(own.filter((l) => l.is_key).map((l) => l.cube_card_id));
    const curve = CMC_BUCKETS.map(() => 0);
    let creatures = 0;
    for (const m of members) {
      if (isLand(m.card)) continue;
      curve[cmcBucket(m.card)]++;
      if (primaryType(m.card) === 'creature') creatures++;
    }
    return {
      archetype,
      members: sortCards(members, 'cmc'),
      keyCards: members.filter((m) => keyIds.has(m.id)),
      playable: cards.filter((c) => fitsColors(c.card, archetype.colors) === 'colored').length,
      creatures,
      curve,
    };
  });
}
