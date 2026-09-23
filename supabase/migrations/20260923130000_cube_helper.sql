-- Cube helper : verrous, statut peasant, sens des cartes, propositions.
--
-- Le helper se joue en trois temps (voir .claude/skills/cube-helper) :
-- un script exporte le cube et les candidats de la collection, une session
-- Claude Code tague les cartes et propose des archétypes, un second script
-- réécrit le tout ici. L'app fait ensuite le reste — scores, équilibre,
-- suggestions — sans jamais rappeler un LLM.

-- Une carte verrouillée ne sort jamais du cube, quoi que suggère le helper.
alter table public.cube_cards
  add column if not exists locked boolean not null default false;

-- Peasant : la carte existe en papier en commune ou en peu commune, dans au
-- moins une impression. Calculé chaque nuit par l'ingestion à partir de
-- toutes les impressions (une impression seule ne suffit pas à le dire :
-- l'Éclair d'une édition peut être rare, celui d'une autre commune).
-- Nul = pas encore calculé.
alter table public.cards
  add column if not exists peasant boolean;

-- ---------------------------------------------------------------------------
-- Sens d'une carte : ses thèmes (avec son rôle dans chacun), ses fonctions,
-- sa puissance en peasant. Clé = le NOM : le sens est celui de la carte,
-- pas d'une impression, et `oracle_id` est nul sur les cartes réversibles.
-- Partagé entre tous les cubes : taguer une carte une fois suffit.
--
-- `source` distingue le tag proposé par le helper de celui corrigé à la
-- main : un nouveau passage du helper ne doit jamais écraser une correction.
-- ---------------------------------------------------------------------------
create table public.card_tags (
  name text primary key,
  -- [{ "theme": "sacrifice", "role": "enabler" | "payoff" }]
  themes jsonb not null default '[]',
  -- ["removal", "card-advantage", …]
  functions text[] not null default '{}',
  -- 1 (remplissage) à 5 (bombe du format), jugée en peasant.
  power smallint check (power between 1 and 5),
  note text,
  vocab_version int not null default 1,
  source text not null default 'helper' check (source in ('helper', 'manual')),
  updated_at timestamptz not null default now()
);

alter table public.card_tags enable row level security;

-- Lisible par tous les connectés ; corrigeable depuis l'app (source =
-- 'manual'). Le helper écrit par le script, avec la connexion directe.
create policy "tags are readable" on public.card_tags
  for select to authenticated using (true);
create policy "tags can be corrected" on public.card_tags
  for update to authenticated using (true) with check (source = 'manual');

-- ---------------------------------------------------------------------------
-- Propositions du helper pour un cube. Une ligne par passage ; l'app montre
-- la dernière et laisse accepter ou refuser chaque archétype proposé.
-- ---------------------------------------------------------------------------
create table public.cube_helper_runs (
  id uuid primary key default gen_random_uuid(),
  cube_id uuid not null references public.cubes (id) on delete cascade,
  -- { archetypes: [{ name, colors, plan, wants, key_cards, cards }], notes }
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index cube_helper_runs_cube_idx on public.cube_helper_runs (cube_id, created_at desc);

alter table public.cube_helper_runs enable row level security;

create policy "own helper runs" on public.cube_helper_runs
  for all to authenticated
  using (exists (select 1 from cubes c where c.id = cube_id and c.user_id = auth.uid()))
  with check (exists (select 1 from cubes c where c.id = cube_id and c.user_id = auth.uid()));
