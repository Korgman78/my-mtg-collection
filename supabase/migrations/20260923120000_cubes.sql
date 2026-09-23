-- Cube builder : des cubes, leurs cartes, leurs archétypes.
--
-- Un cube n'est PAS un dossier. Un dossier compte des exemplaires possédés
-- (finish, état, quantité, valeur) ; un cube est une liste de conception,
-- une carte par nom, qu'on la possède ou non. Le ranger dans `folders`
-- l'aurait fait entrer dans la valeur de la collection, les tendances, les
-- alertes et le récap hebdo — quatre endroits où il n'a rien à faire.

-- ---------------------------------------------------------------------------
-- Données de jeu des cartes.
--
-- Jusqu'ici `cards` ne portait que l'identité et l'image : suffisant pour
-- suivre un prix, pas pour dire qu'un cube manque de créatures vertes à 2.
-- Ces colonnes sont remplies à l'ajout par l'app, et rafraîchies chaque nuit
-- par l'ingestion — qui comble aussi les cartes déjà en base.
-- ---------------------------------------------------------------------------
alter table public.cards
  add column if not exists mana_cost text,
  add column if not exists cmc numeric(4, 1),
  add column if not exists type_line text,
  add column if not exists oracle_text text,
  add column if not exists colors text[],
  add column if not exists color_identity text[],
  add column if not exists keywords text[],
  add column if not exists produced_mana text[];

-- L'app ne peut qu'INSÉRER dans `cards` (voir init.sql) : une carte déjà en
-- base sans données de jeu resterait vide jusqu'à l'ingestion de la nuit.
-- Cette fonction comble ces trous, et seulement eux — elle ne réécrit jamais
-- une donnée déjà présente, si bien qu'elle ne peut rien abîmer.
create or replace function public.fill_card_rules(p_rows jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  update cards c set
    mana_cost      = r.mana_cost,
    cmc            = r.cmc,
    type_line      = r.type_line,
    oracle_text    = r.oracle_text,
    colors         = r.colors,
    color_identity = r.color_identity,
    keywords       = r.keywords,
    produced_mana  = r.produced_mana
  from jsonb_to_recordset(p_rows) as r(
    id uuid,
    mana_cost text,
    cmc numeric,
    type_line text,
    oracle_text text,
    colors text[],
    color_identity text[],
    keywords text[],
    produced_mana text[]
  )
  where c.id = r.id and c.type_line is null;
$$;

grant execute on function public.fill_card_rules(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Cubes
-- ---------------------------------------------------------------------------
create table public.cubes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  -- Taille visée (360, 450, 540…). Nulle = pas d'objectif.
  target_size int check (target_size is null or target_size > 0),
  color text,
  created_at timestamptz not null default now()
);

create index cubes_user_idx on public.cubes (user_id);

-- Une ligne par carte. Pas de quantité : un cube est singleton, et la
-- même carte en deux impressions reste une seule carte (dédoublonné par
-- nom côté app, `oracle_id` étant nul sur certaines cartes réversibles).
create table public.cube_cards (
  id uuid primary key default gen_random_uuid(),
  cube_id uuid not null references public.cubes (id) on delete cascade,
  card_id uuid not null references public.cards (id),
  added_at timestamptz not null default now(),
  unique (cube_id, card_id)
);

create index cube_cards_cube_idx on public.cube_cards (cube_id);

-- ---------------------------------------------------------------------------
-- Archétypes : un nom, des couleurs, une description, et les cartes qui les
-- portent. Une carte peut servir plusieurs archétypes — c'est même ce qu'on
-- cherche dans un cube.
-- ---------------------------------------------------------------------------
create table public.cube_archetypes (
  id uuid primary key default gen_random_uuid(),
  cube_id uuid not null references public.cubes (id) on delete cascade,
  name text not null,
  -- Sous-ensemble de {W,U,B,R,G}. Vide = incolore / toutes couleurs.
  colors text[] not null default '{}',
  description text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index cube_archetypes_cube_idx on public.cube_archetypes (cube_id);

create table public.cube_archetype_cards (
  archetype_id uuid not null references public.cube_archetypes (id) on delete cascade,
  cube_card_id uuid not null references public.cube_cards (id) on delete cascade,
  -- Carte-signature : celle qui donne envie de draguer l'archétype.
  is_key boolean not null default false,
  primary key (archetype_id, cube_card_id)
);

create index cube_archetype_cards_card_idx on public.cube_archetype_cards (cube_card_id);

-- ---------------------------------------------------------------------------
-- RLS : chacun ne voit que ses cubes, et tout ce qui en dépend.
-- ---------------------------------------------------------------------------
alter table public.cubes enable row level security;
alter table public.cube_cards enable row level security;
alter table public.cube_archetypes enable row level security;
alter table public.cube_archetype_cards enable row level security;

create policy "own cubes" on public.cubes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "own cube cards" on public.cube_cards
  for all to authenticated
  using (exists (select 1 from cubes c where c.id = cube_id and c.user_id = auth.uid()))
  with check (exists (select 1 from cubes c where c.id = cube_id and c.user_id = auth.uid()));

create policy "own cube archetypes" on public.cube_archetypes
  for all to authenticated
  using (exists (select 1 from cubes c where c.id = cube_id and c.user_id = auth.uid()))
  with check (exists (select 1 from cubes c where c.id = cube_id and c.user_id = auth.uid()));

create policy "own archetype cards" on public.cube_archetype_cards
  for all to authenticated
  using (exists (
    select 1 from cube_archetypes a join cubes c on c.id = a.cube_id
    where a.id = archetype_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from cube_archetypes a join cubes c on c.id = a.cube_id
    where a.id = archetype_id and c.user_id = auth.uid()
  ));
