// Couche données du cube builder. Clés préfixées ['cubes'] : un cube vit à
// part de la collection, et invalider l'un ne doit pas recharger l'autre.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cardRows, selectAll, throwIfError } from '@/lib/collection';
import { cardRules, fetchCardsByIds, type ScryfallCard } from '@/lib/scryfall';
import { supabase } from '@/lib/supabase';
import type { ArchetypeLink, Cube, CubeArchetype, CubeCard, ManaColor } from '@/lib/types';

export type CubeEntry = Cube & { cardCount: number };

export function useCubes() {
  return useQuery({
    queryKey: ['cubes', 'list'],
    queryFn: async (): Promise<CubeEntry[]> => {
      // `cube_cards(count)` : PostgREST compte en base, on ne rapatrie pas
      // les cartes pour les dénombrer.
      const rows = throwIfError(
        await supabase
          .from('cubes')
          .select('*, cube_cards(count)')
          .order('created_at', { ascending: true })
      ) as (Cube & { cube_cards: { count: number }[] })[];
      return rows.map(({ cube_cards, ...cube }) => ({
        ...cube,
        cardCount: cube_cards?.[0]?.count ?? 0,
      }));
    },
  });
}

export type CubeData = {
  cube: Cube;
  cards: CubeCard[];
  archetypes: CubeArchetype[];
  links: ArchetypeLink[];
};

/** Données de jeu d'impressions déjà en base, prises chez Scryfall.
 *
 *  Une carte entrée par la collection avant la migration des cubes n'a ni
 *  coût ni type. L'ingestion de la nuit la complètera, mais un cube qui
 *  s'ouvre avec la moitié de ses cartes « inconnues » ne sert à rien d'ici
 *  là : on comble le trou tout de suite, en mémoire ET en base
 *  (`fill_card_rules`, qui ne touche qu'aux colonnes vides). */
async function fillMissingRules(cards: CubeCard[]) {
  const missing = cards.filter((c) => c.card.type_line == null);
  if (missing.length === 0) return;

  const ids = [...new Set(missing.map((c) => c.card_id))];
  const fetched = new Map<string, ScryfallCard>();
  for (let i = 0; i < ids.length; i += 75) {
    const batch = await fetchCardsByIds(ids.slice(i, i + 75));
    batch.forEach((card, id) => fetched.set(id, card));
  }

  const rows = [...fetched.values()].map((card) => ({ id: card.id, ...cardRules(card) }));
  for (const c of missing) {
    const card = fetched.get(c.card_id);
    if (card) Object.assign(c.card, cardRules(card));
  }
  // Échec toléré : l'affichage a déjà ses données, la nuit fera le reste.
  if (rows.length) await supabase.rpc('fill_card_rules', { p_rows: rows });
}

export function useCube(cubeId: string) {
  return useQuery({
    queryKey: ['cubes', 'cube', cubeId],
    queryFn: async (): Promise<CubeData> => {
      const [cubeRes, cards, archetypesRes] = await Promise.all([
        supabase.from('cubes').select('*').eq('id', cubeId).single(),
        // Paginé : PostgREST tronque en silence à 1000 lignes (voir
        // `selectAll`), et un cube de travail peut dépasser ce nombre.
        selectAll<CubeCard>((from, to) =>
          supabase
            .from('cube_cards')
            .select('*, card:cards(*)')
            .eq('cube_id', cubeId)
            .order('added_at', { ascending: false })
            .range(from, to)
        ),
        supabase.from('cube_archetypes').select('*').eq('cube_id', cubeId).order('position').order('created_at'),
      ]);
      const cube = throwIfError(cubeRes) as Cube;
      const archetypes = throwIfError(archetypesRes) as CubeArchetype[];

      const links =
        archetypes.length === 0
          ? []
          : (throwIfError(
              await supabase
                .from('cube_archetype_cards')
                .select('*')
                .in(
                  'archetype_id',
                  archetypes.map((a) => a.id)
                )
            ) as ArchetypeLink[]);

      await fillMissingRules(cards).catch((err) =>
        console.warn(`[cube] données de jeu non complétées : ${err.message}`)
      );

      return { cube, cards, archetypes, links };
    },
  });
}

export function useCreateCube() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description: string | null;
      target_size: number | null;
      color: string;
    }) => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('Non connecté');
      return throwIfError(
        await supabase
          .from('cubes')
          .insert({ ...input, user_id: user.id })
          .select('id')
          .single()
      ) as { id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
}

export function useUpdateCube() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      description?: string | null;
      target_size?: number | null;
    }) => {
      if (patch.name !== undefined && !patch.name.trim()) {
        throw new Error('Le nom ne peut pas être vide.');
      }
      throwIfError(await supabase.from('cubes').update(patch).eq('id', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
}

export function useDeleteCube() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      throwIfError(await supabase.from('cubes').delete().eq('id', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
}

/* -------------------------------------------------------------------------- */
/* Cartes                                                                      */
/* -------------------------------------------------------------------------- */

export type AddToCubeResult = {
  added: string[];
  /** Déjà dans le cube, sous ce nom ou une autre impression. */
  duplicates: string[];
};

/** Noms déjà présents, pour dédoublonner avant d'insérer. Un cube est
 *  singleton par NOM : deux impressions d'Éclair, c'est un Éclair de trop. */
async function existingNames(cubeId: string): Promise<Set<string>> {
  // Sans schéma généré, supabase-js type une jointure comme un tableau ;
  // PostgREST renvoie bien un objet pour une clé étrangère simple.
  const rows = await selectAll<{ card: unknown }>((from, to) =>
    supabase
      .from('cube_cards')
      .select('card:cards(name)')
      .eq('cube_id', cubeId)
      .range(from, to)
  );
  return new Set(rows.map((r) => (r.card as { name: string }).name));
}

const CHUNK = 100;

/** Ajoute des cartes à un cube — une seule (recherche, scan) ou une liste
 *  entière (import). Même chemin dans les deux cas. */
export async function addCardsToCube(cubeId: string, cards: ScryfallCard[]): Promise<AddToCubeResult> {
  const already = await existingNames(cubeId);
  const added: string[] = [];
  const duplicates: string[] = [];
  const toAdd: ScryfallCard[] = [];

  for (const card of cards) {
    if (already.has(card.name)) {
      duplicates.push(card.name);
    } else {
      already.add(card.name);
      added.push(card.name);
      toAdd.push(card);
    }
  }
  if (toAdd.length === 0) return { added, duplicates };

  const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < toAdd.length; i += CHUNK) {
    const batch = toAdd.slice(i, i + CHUNK);
    // Cache de la carte, données de jeu comprises. Pour une impression déjà
    // en base (entrée par la collection), l'insert est ignoré : c'est
    // `fill_card_rules` qui lui apporte ses données de jeu.
    throwIfError(
      await supabase.from('cards').upsert(
        batch.map((c) => ({ ...cardRows(c, today).card, ...cardRules(c) })),
        { onConflict: 'id', ignoreDuplicates: true }
      )
    );
    await supabase.rpc('fill_card_rules', {
      p_rows: batch.map((c) => ({ id: c.id, ...cardRules(c) })),
    });
    throwIfError(
      await supabase
        .from('cube_cards')
        .upsert(
          batch.map((c) => ({ cube_id: cubeId, card_id: c.id })),
          { onConflict: 'cube_id,card_id', ignoreDuplicates: true }
        )
    );
  }

  return { added, duplicates };
}

export function useAddToCube() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cubeId, cards }: { cubeId: string; cards: ScryfallCard[] }) =>
      addCardsToCube(cubeId, cards),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
}

export function useRemoveCubeCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cubeCardId: string) => {
      throwIfError(await supabase.from('cube_cards').delete().eq('id', cubeCardId));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
}

/* -------------------------------------------------------------------------- */
/* Archétypes                                                                  */
/* -------------------------------------------------------------------------- */

export function useSaveArchetype() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      cubeId: string;
      name: string;
      colors: ManaColor[];
      description: string | null;
      position?: number;
    }) => {
      const name = input.name.trim();
      if (!name) throw new Error("L'archétype a besoin d'un nom.");
      const row = { name, colors: input.colors, description: input.description };
      if (input.id) {
        throwIfError(await supabase.from('cube_archetypes').update(row).eq('id', input.id));
        return { id: input.id };
      }
      return throwIfError(
        await supabase
          .from('cube_archetypes')
          .insert({ ...row, cube_id: input.cubeId, position: input.position ?? 0 })
          .select('id')
          .single()
      ) as { id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
}

export function useDeleteArchetype() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      throwIfError(await supabase.from('cube_archetypes').delete().eq('id', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
}

/** Rattache, détache, ou (dé)signe une carte-clé d'un archétype.
 *  `state` : `null` = pas membre, `'member'`, ou `'key'`. */
export function useSetArchetypeCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      archetypeId: string;
      cubeCardId: string;
      state: null | 'member' | 'key';
    }) => {
      if (input.state === null) {
        throwIfError(
          await supabase
            .from('cube_archetype_cards')
            .delete()
            .eq('archetype_id', input.archetypeId)
            .eq('cube_card_id', input.cubeCardId)
        );
        return;
      }
      throwIfError(
        await supabase.from('cube_archetype_cards').upsert(
          {
            archetype_id: input.archetypeId,
            cube_card_id: input.cubeCardId,
            is_key: input.state === 'key',
          },
          { onConflict: 'archetype_id,cube_card_id' }
        )
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
}

/* -------------------------------------------------------------------------- */
/* Import de liste                                                             */
/* -------------------------------------------------------------------------- */

/** Extrait les noms d'une liste collée : une carte par ligne, dans les
 *  formats qu'on trouve en pratique (CubeCobra, Arena, MTGO, Moxfield).
 *
 *    Lightning Bolt
 *    1 Lightning Bolt
 *    1x Lightning Bolt
 *    1 Lightning Bolt (2XM) 117
 *    Lightning Bolt [2XM]
 *
 *  Les lignes vides, les commentaires (# ou //) et les en-têtes de section
 *  (« Deck », « Sideboard ») sont ignorés. Dédoublonné, ordre conservé. */
export function parseCardList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (/^(deck|sideboard|commander|companion|maybeboard|mainboard)\s*:?$/i.test(line)) continue;
    line = line
      .replace(/^\d+\s*x?\s+/i, '') // quantité
      .replace(/\s+\*[A-Z]+\*$/, '') // *F* (foil, MTGO)
      .replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+\S+)?$/, '') // (SET) 123
      .replace(/\s+\[[A-Za-z0-9]{2,6}\]$/, '') // [SET]
      .trim();
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}
