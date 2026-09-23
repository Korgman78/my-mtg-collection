// Un cube : ses cartes (filtrables), ses statistiques, ses archétypes.
//
// Trois vues d'une même liste, sur un seul écran. Les statistiques mènent
// aux cartes : toucher « Rouge » ou la colonne « 2 » de la courbe ouvre la
// liste filtrée d'autant. Un chiffre qui étonne doit pouvoir s'expliquer
// d'un geste.

import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BarRow, ColorPip, ColorPips, CubeCardTile, CurveChart, ManaCost } from '@/components/cube';
import { ArchetypeFormSheet } from '@/components/archetype-form-sheet';
import { CubeCardSheet } from '@/components/cube-card-sheet';
import { Icon } from '@/components/icons';
import {
  AppBar,
  AppText,
  Button,
  EmptyState,
  ErrorState,
  FormField,
  IconButton,
  Loading,
  Screen,
  SectionHeader,
  Segmented,
  Sheet,
  Surface,
  TextField,
} from '@/components/ui';
import { Colors, Radius, Space } from '@/constants/theme';
import {
  applyFilter,
  archetypeSummaries,
  CARD_TYPES,
  CMC_BUCKETS,
  cmcLabel,
  cubeStats,
  EMPTY_FILTER,
  isFiltering,
  MANA_COLORS,
  PAIRS,
  SECTION_COLORS,
  SECTION_LABELS,
  SECTIONS,
  sortCards,
  SORT_LABELS,
  TYPE_LABELS,
  type CardType,
  type CubeFilter,
  type CubeSort,
  type CubeStats,
  type Section,
} from '@/lib/cube-stats';
import { useCube, useSaveArchetype, useUpdateCube, type CubeData } from '@/lib/cubes';
import { goBack } from '@/lib/nav';
import type { CubeCard, ManaColor } from '@/lib/types';

type Tab = 'cards' | 'stats' | 'archetypes';

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)} %` : '—');

export default function CubeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data, error, isLoading, refetch, isRefetching } = useCube(id);
  const [tab, setTab] = useState<Tab>('cards');
  const [filter, setFilter] = useState<CubeFilter>(EMPTY_FILTER);
  const [editing, setEditing] = useState(false);

  if (isLoading) return <Loading />;
  if (!data) return <ErrorState detail={error?.message} onRetry={() => refetch()} />;
  const { cube, cards } = data;

  /** Depuis les stats : ouvrir la liste avec ce filtre, et rien d'autre. */
  const drill = (patch: Partial<CubeFilter>) => {
    setFilter({ ...EMPTY_FILTER, ...patch });
    setTab('cards');
  };

  const openAdd = () => router.push({ pathname: '/cube-add', params: { cubeId: cube.id } });
  const openScanner = () => router.push({ pathname: '/scan', params: { cubeId: cube.id } });

  return (
    <Screen>
      <AppBar
        title={cube.name}
        subtitle={
          cube.target_size
            ? `${cards.length} / ${cube.target_size} cartes`
            : `${cards.length} carte${cards.length > 1 ? 's' : ''}`
        }
        onBack={() => goBack('/cubes')}
        backLabel="Retour aux cubes"
        right={<IconButton name="pencil" label="Modifier le cube" onPress={() => setEditing(true)} />}
      />

      <View style={styles.toolbar}>
        <Button label="Ajouter" icon="plus" size="sm" onPress={openAdd} />
        <Button label="Scanner" icon="card" size="sm" variant="secondary" onPress={openScanner} />
      </View>

      <View style={styles.tabs}>
        <Segmented
          options={[
            { value: 'cards', label: 'Cartes' },
            { value: 'stats', label: 'Stats' },
            { value: 'archetypes', label: 'Archétypes' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>

      {cards.length === 0 ? (
        <EmptyState
          icon="cube"
          title="Cube vide"
          hint="Ajoute des cartes par leur nom, colle une liste entière (CubeCobra, Moxfield, MTGO…), ou scanne-les."
          action={{ label: 'Ajouter des cartes', icon: 'plus', onPress: openAdd }}
        />
      ) : tab === 'cards' ? (
        <CardsView data={data} filter={filter} onFilter={setFilter} refreshing={isRefetching} onRefresh={refetch} />
      ) : tab === 'stats' ? (
        <StatsView data={data} onDrill={drill} />
      ) : (
        <ArchetypesView data={data} onDrill={drill} />
      )}

      <EditCubeSheet key={`${cube.name}|${cube.target_size}`} data={data} visible={editing} onClose={() => setEditing(false)} />
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/* Cartes                                                                      */
/* -------------------------------------------------------------------------- */

function CardsView({
  data,
  filter,
  onFilter,
  refreshing,
  onRefresh,
}: {
  data: CubeData;
  filter: CubeFilter;
  onFilter: (f: CubeFilter) => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { cards, archetypes, links } = data;
  const [sort, setSort] = useState<CubeSort>('section');
  const [mode, setMode] = useState<'grid' | 'list'>('grid');
  const [sheet, setSheet] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const shown = useMemo(
    () => sortCards(applyFilter(cards, filter, links), sort),
    [cards, filter, links, sort]
  );
  // Par identifiant, pas par objet : après une modification, la fiche doit
  // relire la carte dans les données rafraîchies.
  const selected = cards.find((c) => c.id === selectedId) ?? null;
  const filtering = isFiltering(filter);
  const extraFilters = filter.types.length + filter.cmcs.length + (filter.archetype ? 1 : 0);

  return (
    <>
      <View style={styles.filters}>
        <TextField
          icon="search"
          placeholder="Nom, type, texte… (« flying », « Goblin »)"
          value={filter.query}
          onChangeText={(query) => onFilter({ ...filter, query })}
          autoCapitalize="none"
          autoCorrect={false}
          right={
            filter.query ? (
              <IconButton name="close" label="Effacer" size="sm" onPress={() => onFilter({ ...filter, query: '' })} />
            ) : undefined
          }
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sectionChips}>
          {SECTIONS.map((s) => {
            const on = filter.sections.includes(s);
            return (
              <Pressable
                key={s}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={SECTION_LABELS[s]}
                onPress={() => onFilter({ ...filter, sections: toggle(filter.sections, s) })}
                style={[styles.sectionChip, on && styles.sectionChipOn]}>
                <ColorPip color={s} size={16} />
                {s === 'M' || s === 'C' || s === 'L' ? (
                  <AppText variant="caption" style={on ? styles.chipTextOn : undefined}>
                    {SECTION_LABELS[s]}
                  </AppText>
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.filterLine}>
          <AppText variant="caption" style={{ flex: 1 }}>
            {filtering ? `${shown.length} sur ${cards.length} cartes` : `${cards.length} cartes`} ·{' '}
            {SORT_LABELS[sort].toLowerCase()}
          </AppText>
          {filtering ? (
            <Button label="Tout effacer" size="sm" variant="ghost" onPress={() => onFilter(EMPTY_FILTER)} />
          ) : null}
          <Button
            label={extraFilters ? `Filtres · ${extraFilters}` : 'Filtres'}
            icon="filter"
            size="sm"
            variant="secondary"
            onPress={() => setSheet(true)}
          />
        </View>
      </View>

      <FlatList
        key={mode}
        data={shown}
        keyExtractor={(c) => c.id}
        numColumns={mode === 'grid' ? 3 : 1}
        columnWrapperStyle={mode === 'grid' ? styles.gridRow : undefined}
        contentContainerStyle={mode === 'grid' ? styles.grid : styles.listBody}
        refreshing={refreshing}
        onRefresh={onRefresh}
        initialNumToRender={18}
        ListEmptyComponent={
          <EmptyState
            icon="search"
            title="Aucune carte ne correspond"
            hint="Les critères se cumulent : essaie d'en retirer un."
            action={{ label: 'Tout effacer', onPress: () => onFilter(EMPTY_FILTER) }}
          />
        }
        renderItem={({ item, index }) =>
          mode === 'grid' ? (
            <GridCell item={item} index={index} total={shown.length} onPress={() => setSelectedId(item.id)} />
          ) : (
            <CardLine item={item} onPress={() => setSelectedId(item.id)} />
          )
        }
      />

      <Sheet visible={sheet} onClose={() => setSheet(false)} title="Filtres et tri">
        <FormField label="Type">
          <View style={styles.wrap}>
            {CARD_TYPES.map((t) => (
              <Chip
                key={t}
                label={TYPE_LABELS[t]}
                on={filter.types.includes(t)}
                onPress={() => onFilter({ ...filter, types: toggle<CardType>(filter.types, t) })}
              />
            ))}
          </View>
        </FormField>
        <FormField label="Coût de mana (terrains exclus)">
          <View style={styles.wrap}>
            {CMC_BUCKETS.map((b) => (
              <Chip
                key={b}
                label={cmcLabel(b)}
                on={filter.cmcs.includes(b)}
                onPress={() => onFilter({ ...filter, cmcs: toggle(filter.cmcs, b) })}
              />
            ))}
          </View>
        </FormField>
        {archetypes.length > 0 ? (
          <FormField label="Archétype">
            <View style={styles.wrap}>
              {archetypes.map((a) => (
                <Chip
                  key={a.id}
                  label={a.name}
                  on={filter.archetype === a.id}
                  onPress={() => onFilter({ ...filter, archetype: filter.archetype === a.id ? null : a.id })}
                />
              ))}
              <Chip
                label="Sans archétype"
                on={filter.archetype === 'none'}
                onPress={() => onFilter({ ...filter, archetype: filter.archetype === 'none' ? null : 'none' })}
              />
            </View>
          </FormField>
        ) : null}
        <FormField label="Tri">
          <Segmented
            columns
            options={(Object.keys(SORT_LABELS) as CubeSort[]).map((k) => ({ value: k, label: SORT_LABELS[k] }))}
            value={sort}
            onChange={setSort}
          />
        </FormField>
        <FormField label="Affichage">
          <Segmented
            options={[
              { value: 'grid', label: 'Grille' },
              { value: 'list', label: 'Liste' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </FormField>
      </Sheet>

      <CubeCardSheet item={selected} archetypes={archetypes} links={links} onClose={() => setSelectedId(null)} />
    </>
  );
}

/** Une case de la grille. La dernière rangée incomplète est comblée par des
 *  cases vides : sans elles, `flex: 1` étirerait les dernières cartes. */
function GridCell({
  item,
  index,
  total,
  onPress,
}: {
  item: CubeCard;
  index: number;
  total: number;
  onPress: () => void;
}) {
  const lastRow = index >= total - (total % 3 || 3);
  const pad = lastRow && index === total - 1 ? (3 - (total % 3)) % 3 : 0;
  return (
    <>
      <CubeCardTile card={item.card} onPress={onPress} />
      {Array.from({ length: pad }, (_, i) => (
        <View key={i} style={{ flex: 1 }} />
      ))}
    </>
  );
}

function CardLine({ item, onPress }: { item: CubeCard; onPress: () => void }) {
  const { card } = item;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={card.name}
      onPress={onPress}
      style={({ pressed }) => [styles.line, pressed && { backgroundColor: Colors.surfaceHover }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" numberOfLines={1} style={{ color: Colors.text }}>
          {card.name}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {card.type_line ?? '…'}
        </AppText>
      </View>
      <ManaCost cost={card.mana_cost} size={14} />
    </Pressable>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn]}>
      <AppText variant="caption" style={on ? styles.chipTextOn : undefined}>
        {label}
      </AppText>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/* Statistiques                                                                */
/* -------------------------------------------------------------------------- */

function StatsView({ data, onDrill }: { data: CubeData; onDrill: (f: Partial<CubeFilter>) => void }) {
  const stats = useMemo(() => cubeStats(data.cards), [data.cards]);
  const [curveOf, setCurveOf] = useState<Section | 'all'>('all');
  const { cube } = data;

  const maxSection = Math.max(...SECTIONS.map((s) => stats.sections[s]));
  const monoCounts = MANA_COLORS.map((c) => stats.sections[c]);
  const monoAvg = monoCounts.reduce((a, b) => a + b, 0) / 5;
  const curve = curveOf === 'all' ? stats.curve : stats.curveBySection[curveOf];
  const maxType = Math.max(...CARD_TYPES.map((t) => stats.types[t]));
  const maxPair = Math.max(1, ...PAIRS.map((p) => stats.pairs[p.key].cards));
  const maxPresence = Math.max(...MANA_COLORS.map((c) => stats.colorPresence[c]));

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Surface tone="plate" style={styles.headline}>
        <Headline value={String(stats.total)} label={cube.target_size ? `sur ${cube.target_size} visées` : 'cartes'} />
        <Headline value={stats.avgCmc === null ? '—' : stats.avgCmc.toFixed(2).replace('.', ',')} label="coût moyen" />
        <Headline value={pct(stats.creatures, stats.nonLand)} label="de créatures" />
      </Surface>

      {stats.unknown > 0 ? (
        <AppText variant="caption" style={{ color: Colors.accent }}>
          {stats.unknown} carte{stats.unknown > 1 ? 's' : ''} sans données de jeu : exclues des calculs
          en attendant d&apos;être complétées (au prochain chargement ou cette nuit).
        </AppText>
      ) : null}

      <SectionHeader title="Répartition par couleur" />
      <View style={styles.block}>
        {SECTIONS.map((s) => (
          <BarRow
            key={s}
            lead={<ColorPip color={s} size={16} />}
            label={SECTION_LABELS[s]}
            value={stats.sections[s]}
            max={maxSection}
            color={SECTION_COLORS[s]}
            note={pct(stats.sections[s], stats.total)}
            onPress={() => onDrill({ sections: [s] })}
          />
        ))}
        <BalanceNote counts={monoCounts} avg={monoAvg} />
      </View>

      <SectionHeader title="Présence de chaque couleur" />
      <View style={styles.block}>
        <AppText variant="caption">
          Multicolores comprises : une carte blanc-bleu compte pour les deux. C&apos;est ce qu&apos;un
          joueur engagé dans la couleur verra passer.
        </AppText>
        {MANA_COLORS.map((c) => (
          <BarRow
            key={c}
            lead={<ColorPip color={c} size={16} />}
            label={SECTION_LABELS[c]}
            value={stats.colorPresence[c]}
            max={maxPresence}
            color={SECTION_COLORS[c]}
          />
        ))}
      </View>

      <SectionHeader title="Courbe de mana" />
      <View style={styles.block}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sectionChips}>
          <Chip label="Tout" on={curveOf === 'all'} onPress={() => setCurveOf('all')} />
          {SECTIONS.filter((s) => s !== 'L').map((s) => (
            <Pressable
              key={s}
              accessibilityRole="radio"
              accessibilityState={{ selected: curveOf === s }}
              accessibilityLabel={SECTION_LABELS[s]}
              onPress={() => setCurveOf(s)}
              style={[styles.sectionChip, curveOf === s && styles.sectionChipOn]}>
              <ColorPip color={s} size={16} />
            </Pressable>
          ))}
        </ScrollView>
        <CurveChart
          curve={curve}
          color={curveOf === 'all' ? Colors.accent : SECTION_COLORS[curveOf]}
          onPressBucket={(b) => onDrill({ cmcs: [b], sections: curveOf === 'all' ? [] : [curveOf] })}
        />
        <AppText variant="caption">
          {curveOf === 'all'
            ? `${stats.nonLand} sorts, terrains exclus.`
            : `${SECTION_LABELS[curveOf]} : coût moyen ${
                stats.avgCmcBySection[curveOf]?.toFixed(2).replace('.', ',') ?? '—'
              }.`}{' '}
          Touche une colonne pour voir ses cartes.
        </AppText>
      </View>

      <SectionHeader title="Créatures et sorts" />
      <View style={styles.block}>
        {SECTIONS.filter((s) => s !== 'L').map((s) => (
          <CreatureSplit key={s} section={s} stats={stats} onPress={() => onDrill({ sections: [s], types: ['creature'] })} />
        ))}
        <AppText variant="caption">
          Barre pleine : créatures. Repère usuel en cube : autour de 40 à 50 % de créatures par couleur,
          davantage dans les couleurs agressives.
        </AppText>
      </View>

      <SectionHeader title="Types de cartes" />
      <View style={styles.block}>
        {CARD_TYPES.filter((t) => stats.types[t] > 0).map((t) => (
          <BarRow
            key={t}
            label={TYPE_LABELS[t]}
            value={stats.types[t]}
            max={maxType}
            note={pct(stats.types[t], stats.total)}
            onPress={() => onDrill({ types: [t] })}
          />
        ))}
      </View>

      <SectionHeader title="Paires de couleurs" />
      <View style={styles.block}>
        {PAIRS.map((p) => (
          <BarRow
            key={p.key}
            lead={<ColorPips colors={p.key.split('') as ManaColor[]} size={13} />}
            label={p.name}
            value={stats.pairs[p.key].cards}
            max={maxPair}
            note={`· ${stats.pairs[p.key].fixing} t.`}
          />
        ))}
        <AppText variant="caption">
          Cartes bicolores de la paire, puis « t. » : les terrains qui produisent ses deux couleurs.
          {stats.threePlus > 0 ? ` Plus ${stats.threePlus} carte${stats.threePlus > 1 ? 's' : ''} de trois couleurs ou plus.` : ''}
        </AppText>
      </View>

      <SectionHeader title="Couleur × coût" />
      <CurveMatrix stats={stats} onDrill={onDrill} />
    </ScrollView>
  );
}

function Headline({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.headlineCell}>
      <AppText variant="title">{value}</AppText>
      <AppText variant="caption">{label}</AppText>
    </View>
  );
}

/** Le verdict d'équilibre, en mots : un écart de 3 cartes sur 50 ne mérite
 *  pas d'alerte, un écart de 15 oui. */
function BalanceNote({ counts, avg }: { counts: number[]; avg: number }) {
  if (avg === 0) return null;
  const outliers = MANA_COLORS.map((c, i) => ({ c, n: counts[i] })).filter(
    ({ n }) => Math.abs(n - avg) / avg > 0.15
  );
  return (
    <AppText variant="caption" style={{ color: outliers.length ? Colors.accent : Colors.up }}>
      {outliers.length === 0
        ? `Couleurs équilibrées : moyenne de ${avg.toFixed(0)} cartes, aucune ne s'en écarte de plus de 15 %.`
        : `Moyenne de ${avg.toFixed(0)} cartes par couleur. Hors de ±15 % : ${outliers
            .map(({ c, n }) => `${SECTION_LABELS[c]} (${n > avg ? '+' : ''}${Math.round(n - avg)})`)
            .join(', ')}.`}
    </AppText>
  );
}

function CreatureSplit({ section, stats, onPress }: { section: Section; stats: CubeStats; onPress: () => void }) {
  const { creatures, spells } = stats.creaturesBySection[section];
  const total = creatures + spells;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${SECTION_LABELS[section]} : ${creatures} créatures, ${spells} autres sorts`}
      onPress={onPress}
      style={({ pressed }) => [styles.split, pressed && { opacity: 0.6 }]}>
      <View style={styles.splitLabel}>
        <ColorPip color={section} size={16} />
        <AppText variant="caption" numberOfLines={1} style={{ color: Colors.text }}>
          {SECTION_LABELS[section]}
        </AppText>
      </View>
      <View style={styles.splitTrack}>
        {total > 0 ? (
          <View style={[styles.splitFill, { flex: creatures, backgroundColor: SECTION_COLORS[section] }]} />
        ) : null}
        {total > 0 ? <View style={{ flex: spells }} /> : null}
      </View>
      <AppText variant="caption" style={styles.splitValue}>
        {creatures} / {total} · {pct(creatures, total)}
      </AppText>
    </Pressable>
  );
}

function CurveMatrix({ stats, onDrill }: { stats: CubeStats; onDrill: (f: Partial<CubeFilter>) => void }) {
  const rows = SECTIONS.filter((s) => s !== 'L');
  const max = Math.max(1, ...rows.flatMap((s) => stats.curveBySection[s]));
  return (
    <View style={styles.matrix}>
      <View style={styles.matrixRow}>
        <View style={styles.matrixHead} />
        {CMC_BUCKETS.map((b) => (
          <AppText key={b} variant="caption" style={styles.matrixCol}>
            {cmcLabel(b)}
          </AppText>
        ))}
      </View>
      {rows.map((s) => (
        <View key={s} style={styles.matrixRow}>
          <View style={styles.matrixHead}>
            <ColorPip color={s} size={16} />
          </View>
          {CMC_BUCKETS.map((b) => {
            const v = stats.curveBySection[s][b];
            return (
              <Pressable
                key={b}
                disabled={v === 0}
                accessibilityRole="button"
                accessibilityLabel={`${SECTION_LABELS[s]}, coût ${cmcLabel(b)} : ${v}`}
                onPress={() => onDrill({ sections: [s], cmcs: [b] })}
                style={[styles.matrixCell, { backgroundColor: `rgba(201, 162, 39, ${(v / max) * 0.45})` }]}>
                <AppText variant="caption" style={v ? styles.matrixValue : undefined}>
                  {v || '·'}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Archétypes                                                                  */
/* -------------------------------------------------------------------------- */

function ArchetypesView({ data, onDrill }: { data: CubeData; onDrill: (f: Partial<CubeFilter>) => void }) {
  const router = useRouter();
  const { cube, cards, archetypes, links } = data;
  const save = useSaveArchetype();
  const [creating, setCreating] = useState(false);
  const summaries = useMemo(() => archetypeSummaries(archetypes, cards, links), [archetypes, cards, links]);
  const orphans = useMemo(() => {
    const linked = new Set(links.map((l) => l.cube_card_id));
    return cards.filter((c) => !linked.has(c.id)).length;
  }, [cards, links]);
  const maxMembers = Math.max(1, ...summaries.map((s) => s.members.length));
  const avg = summaries.length ? summaries.reduce((a, s) => a + s.members.length, 0) / summaries.length : 0;

  /** Point de départ classique : un archétype par paire de couleurs. */
  async function createPairs() {
    for (const [i, p] of PAIRS.entries()) {
      await save.mutateAsync({
        cubeId: cube.id,
        name: p.name,
        colors: p.key.split('') as ManaColor[],
        description: null,
        position: i,
      });
    }
  }

  const open = (archetypeId: string) =>
    router.push({ pathname: '/archetype/[id]', params: { id: archetypeId, cubeId: cube.id } });

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <SectionHeader title="Archétypes" action={{ label: 'Nouveau', icon: 'plus', onPress: () => setCreating(true) }} />

      {archetypes.length === 0 ? (
        <View style={{ gap: Space.md }}>
          <EmptyState
            icon="layers"
            title="Aucun archétype"
            hint="Un archétype, c'est un plan de jeu que le cube doit soutenir (Boros aggro, Dimir contrôle…). Définis-les, range-y les cartes qui les portent, et vois lesquels sont trop minces."
            action={{ label: 'Créer un archétype', icon: 'plus', onPress: () => setCreating(true) }}
          />
          <Button
            label="Partir des 10 paires de couleurs"
            variant="secondary"
            onPress={createPairs}
            loading={save.isPending}
          />
        </View>
      ) : (
        <>
          <View style={styles.block}>
            <AppText variant="overline">Équilibre</AppText>
            {summaries.map((s) => (
              <BarRow
                key={s.archetype.id}
                lead={<ColorPips colors={s.archetype.colors} size={12} />}
                label={s.archetype.name}
                value={s.members.length}
                max={maxMembers}
                color={s.members.length < avg * 0.6 ? Colors.down : Colors.accent}
                onPress={() => open(s.archetype.id)}
              />
            ))}
            <AppText variant="caption">
              Cartes rangées dans chaque archétype. En rouge, ceux sous 60 % de la moyenne (
              {avg.toFixed(0)}) : trop minces pour être draftés de façon fiable.
            </AppText>
            <Pressable
              accessibilityRole="button"
              onPress={() => onDrill({ archetype: 'none' })}
              style={({ pressed }) => [styles.orphans, pressed && { opacity: 0.6 }]}>
              <AppText variant="caption" style={{ color: Colors.text, flex: 1 }}>
                {orphans} carte{orphans > 1 ? 's' : ''} sans archétype
              </AppText>
              <Icon name="chevronRight" size={14} color={Colors.textTertiary} />
            </Pressable>
          </View>

          {summaries.map((s) => (
            <Pressable
              key={s.archetype.id}
              accessibilityRole="button"
              accessibilityLabel={`Ouvrir l'archétype ${s.archetype.name}`}
              onPress={() => open(s.archetype.id)}
              style={({ pressed }) => [styles.archetype, pressed && { backgroundColor: Colors.surfaceHover }]}>
              <View style={styles.archetypeHead}>
                <ColorPips colors={s.archetype.colors} size={16} />
                <AppText variant="heading" numberOfLines={1} style={{ flex: 1 }}>
                  {s.archetype.name}
                </AppText>
                <Icon name="chevronRight" size={16} color={Colors.textTertiary} />
              </View>
              {s.archetype.description ? (
                <AppText variant="caption" numberOfLines={2}>
                  {s.archetype.description}
                </AppText>
              ) : null}
              <AppText variant="caption">
                {s.members.length} carte{s.members.length > 1 ? 's' : ''} · {s.keyCards.length} clé
                {s.keyCards.length > 1 ? 's' : ''} · {s.creatures} créature{s.creatures > 1 ? 's' : ''} ·{' '}
                {s.playable} jouables dans ses couleurs
              </AppText>
              {s.keyCards.length > 0 ? (
                <View style={styles.keyRow}>
                  {s.keyCards.slice(0, 5).map((k) => (
                    <Image
                      key={k.id}
                      source={{ uri: k.card.image_small ?? undefined }}
                      style={styles.keyThumb}
                      contentFit="cover"
                    />
                  ))}
                </View>
              ) : null}
            </Pressable>
          ))}
        </>
      )}

      <ArchetypeFormSheet
        visible={creating}
        cubeId={cube.id}
        position={archetypes.length}
        onClose={() => setCreating(false)}
      />
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/* Modifier le cube                                                            */
/* -------------------------------------------------------------------------- */

function EditCubeSheet({ data, visible, onClose }: { data: CubeData; visible: boolean; onClose: () => void }) {
  const update = useUpdateCube();
  const { cube } = data;
  const [name, setName] = useState(cube.name);
  const [description, setDescription] = useState(cube.description ?? '');
  const [size, setSize] = useState(cube.target_size ? String(cube.target_size) : '');

  function submit() {
    const target = Number.parseInt(size, 10);
    update.mutate(
      {
        id: cube.id,
        name: name.trim(),
        description: description.trim() || null,
        target_size: Number.isFinite(target) && target > 0 ? target : null,
      },
      { onSuccess: onClose }
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Modifier le cube"
      footer={<Button label="Enregistrer" onPress={submit} loading={update.isPending} disabled={!name.trim()} />}>
      <TextField label="Nom" value={name} onChangeText={setName} />
      <TextField label="Description" value={description} onChangeText={setDescription} />
      <TextField
        label="Taille visée (vide = libre)"
        value={size}
        onChangeText={(t) => setSize(t.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
      />
      {update.isError ? (
        <AppText variant="caption" style={{ color: Colors.danger }}>
          {update.error.message}
        </AppText>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', gap: Space.sm, paddingHorizontal: Space.lg, paddingBottom: Space.md },
  tabs: { paddingHorizontal: Space.lg, paddingBottom: Space.md },
  filters: { paddingHorizontal: Space.lg, gap: Space.sm, paddingBottom: Space.sm },
  filterLine: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  sectionChips: { gap: Space.sm, paddingVertical: 2 },
  sectionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  sectionChipOn: { borderColor: Colors.accentBorder, backgroundColor: Colors.accentSoft },
  chip: {
    height: 32,
    paddingHorizontal: Space.md,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipOn: { borderColor: Colors.accentBorder, backgroundColor: Colors.accentSoft },
  chipTextOn: { color: Colors.text, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },

  grid: { paddingHorizontal: Space.lg, paddingBottom: Space.xxl, gap: Space.sm, flexGrow: 1 },
  gridRow: { gap: Space.sm },
  listBody: { paddingHorizontal: Space.lg, paddingBottom: Space.xxl, flexGrow: 1 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
    paddingHorizontal: Space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },

  scroll: { paddingHorizontal: Space.lg, paddingBottom: Space.xxxl, gap: Space.lg },
  block: { gap: Space.sm },
  headline: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Space.xl },
  headlineCell: { alignItems: 'center', gap: 2 },

  split: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 26 },
  splitLabel: { width: 108, flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  splitTrack: {
    flex: 1,
    height: 10,
    flexDirection: 'row',
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceAlt,
    overflow: 'hidden',
  },
  splitFill: { borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  splitValue: { minWidth: 92, textAlign: 'right', color: Colors.text, fontVariant: ['tabular-nums'] },

  matrix: { gap: 3 },
  matrixRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  matrixHead: { width: 26, alignItems: 'center' },
  matrixCol: { flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'] },
  matrixCell: {
    flex: 1,
    height: 30,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  matrixValue: { color: Colors.text, fontWeight: '600', fontVariant: ['tabular-nums'] },

  orphans: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  archetype: {
    gap: Space.sm,
    padding: Space.lg,
    borderRadius: Radius.lg,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  archetypeHead: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  keyRow: { flexDirection: 'row', gap: Space.xs },
  keyThumb: { width: 52, aspectRatio: 488 / 680, borderRadius: Radius.sm, backgroundColor: Colors.surfaceAlt },
});
