-- Phase 3 — Scanner v1 : base de référence perceptuelle.
--
-- Principe : l'app calcule le pHash de la photo sur le téléphone et n'envoie
-- que 64 bits. La reconnaissance est une distance de Hamming, que Postgres
-- sait faire nativement (`bit_count(a # b)` depuis PG 14). Pas d'upload
-- d'image, pas de Storage, pas d'Edge Function.

-- ---------------------------------------------------------------------------
-- Empreintes. Volontairement SANS clé étrangère vers `cards` : on doit
-- pouvoir reconnaître une carte qu'on ne possède pas encore — c'est même
-- tout l'intérêt du scanner. La table porte donc sa propre identité, et
-- l'ajout à la collection passera ensuite par Scryfall comme d'habitude.
-- ---------------------------------------------------------------------------
create table public.card_hashes (
  card_id uuid primary key,
  set_code text not null,
  name text not null,
  collector_number text not null,
  rarity text,
  image_small text,
  image_normal text,
  released_at date,
  -- 64 bits en `bit(64)` et non en bigint : un bigint est signé, et faire
  -- transiter 64 bits par un nombre JSON les tronquerait silencieusement
  -- côté client (JavaScript ne tient que 53 bits d'entier exact).
  phash bit(64) not null,
  hashed_at timestamptz not null default now()
);

create index card_hashes_set_idx on public.card_hashes (set_code);

-- ---------------------------------------------------------------------------
-- Sets déjà indexés : permet à l'app d'annoncer ce qu'elle sait reconnaître
-- au lieu d'échouer sans explication sur un set jamais haché.
-- ---------------------------------------------------------------------------
create table public.hashed_sets (
  set_code text primary key,
  set_name text not null,
  card_count int not null default 0,
  hashed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- La reconnaissance elle-même.
--
-- Elle prend un LOT de hachages, pas un seul. Raison mesurée sur 60 cartes
-- d'OTP (scripts/phash-eval-multicrop.mjs) : le cadrage écrase tous les
-- autres facteurs. Avec un seul hachage, une photo laissant 10 % de fond
-- autour de la carte n'est reconnue que 31 fois sur 60 ; en interrogeant
-- avec 25 fenêtres (5 échelles × 5 centres) on remonte à 60/60, et à 58/60
-- si la carte est en plus décentrée. La lumière, elle, ne coûte rien :
-- pénombre et surexposition restent à 60/60 même avec un seul hachage.
--
-- Les paramètres sont des text de 64 caractères '0'/'1' plutôt que des
-- bit(64) : PostgREST transporte les paramètres en texte, et un cast
-- explicite ici vaut mieux qu'une conversion implicite invisible.
--
-- Seuil par défaut à 14 : les bonnes réponses montent jusqu'à ~12 dans les
-- cas difficiles, tandis que les deux cartes DIFFÉRENTES les plus proches
-- du set testé sont à 8 bits l'une de l'autre. Les deux plages se
-- chevauchent — c'est pourquoi cette fonction renvoie plusieurs candidats
-- classés et laisse l'app faire confirmer, au lieu de trancher seule.
-- ---------------------------------------------------------------------------
create or replace function public.match_card_hashes(
  query_hashes text[],
  max_distance int default 14,
  max_results int default 5
)
returns table (
  card_id uuid,
  name text,
  set_code text,
  collector_number text,
  rarity text,
  image_small text,
  image_normal text,
  distance int
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    h.card_id,
    h.name,
    h.set_code,
    h.collector_number,
    h.rarity,
    h.image_small,
    h.image_normal,
    min(bit_count(h.phash # q::bit(64)))::int as distance
  from card_hashes h
  cross join unnest(query_hashes) as q
  group by h.card_id, h.name, h.set_code, h.collector_number, h.rarity,
           h.image_normal, h.image_small, h.released_at
  having min(bit_count(h.phash # q::bit(64))) <= max_distance
  -- À égalité de distance, on propose l'impression la plus récente :
  -- c'est celle qu'un joueur a statistiquement le plus de chances d'avoir
  -- en main quand il scanne.
  order by distance, h.released_at desc nulls last
  limit max_results;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security : référence publique en lecture, écriture réservée au
-- job (service role, qui contourne la RLS).
-- ---------------------------------------------------------------------------
alter table public.card_hashes enable row level security;
alter table public.hashed_sets enable row level security;

create policy "hashes are readable" on public.card_hashes
  for select to authenticated using (true);

create policy "hashed sets are readable" on public.hashed_sets
  for select to authenticated using (true);
