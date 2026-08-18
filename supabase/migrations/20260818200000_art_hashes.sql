-- Scanner : hachage de l'illustration, en plus de la carte entière.
--
-- Pourquoi ce changement, mesuré et non supposé : hacher la carte entière
-- ne discrimine pas assez. Toutes les cartes Magic partagent la même
-- charpente (bordure, bandeau de titre, cadre d'illustration, bloc de
-- texte), qui occupe l'essentiel des basses fréquences à 32×32.
--
-- Sur 40 cartes de Final Fantasy :
--   carte entière  — écart moyen entre cartes 22,7 ; paire la plus proche 10
--   illustration   — écart moyen 31,1            ; paire la plus proche 16
--
-- Or une photo à main levée dégrade d'environ 14 bits. Sur la carte entière
-- le bruit dépassait donc l'écart minimal entre deux cartes différentes :
-- en conditions réelles, tous les candidats revenaient entre 10 et 14 bits,
-- c'est-à-dire à égale distance de tout. La reconnaissance était impossible,
-- quel que soit le seuil.
--
-- En ne comparant que l'illustration : 38/40 contre 30/40 sur photo à main
-- levée simulée.

alter table public.card_hashes add column art_phash bit(64);

-- ---------------------------------------------------------------------------
-- Nouvelle reconnaissance : l'illustration décide, la carte entière départage.
--
-- On ne prend pas simplement le meilleur des deux : la carte entière tolère
-- mal un seuil large (deux cartes différentes à 10 bits), alors que
-- l'illustration en laisse la place (16). L'illustration porte donc le
-- classement, et la carte entière ne sert qu'à départager les ex æquo.
-- ---------------------------------------------------------------------------
create or replace function public.match_card_hashes(
  query_hashes text[],
  art_hashes text[] default null,
  max_distance int default 18,
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
  distance int,
  whole_distance int
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
    coalesce(art.d, whole.d) as distance,
    whole.d as whole_distance
  from card_hashes h
  cross join lateral (
    select min(bit_count(h.phash # q::bit(64)))::int as d
    from unnest(query_hashes) as q
  ) whole
  left join lateral (
    select min(bit_count(h.art_phash # a::bit(64)))::int as d
    from unnest(coalesce(art_hashes, '{}'::text[])) as a
    where h.art_phash is not null
  ) art on true
  where coalesce(art.d, whole.d) <= max_distance
  order by coalesce(art.d, whole.d), whole.d, h.released_at desc nulls last
  limit max_results;
$$;
