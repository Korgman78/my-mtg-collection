-- Le tableau de bord compte en base, plus dans l'application.
--
-- Il téléchargeait TOUTES les lignes de collection_items pour en faire des
-- sommes côté client. Or PostgREST plafonne une réponse à 1000 lignes, en
-- silence : ni erreur, ni drapeau, une liste tronquée se lit exactement comme
-- une liste complète. Au 1343e exemplaire, deux dossiers entiers ont disparu
-- du tableau de bord — l'un compté à 24 cartes sur 181, l'autre à zéro sur
-- 186 — alors que leur écran de dossier, lui, les affichait tous (il filtre
-- par dossier, donc il restait sous le plafond).
--
-- Agréger ici règle la question définitivement : la réponse fait une ligne par
-- dossier, quelle que soit la taille de la collection. Au passage, ça épargne
-- aussi le téléchargement des statistiques de prix de chaque carte, qui ne
-- servaient qu'à ces sommes.
--
-- `security invoker` : la fonction s'exécute avec les droits de l'appelant,
-- donc les politiques RLS de folders et collection_items s'appliquent. Le
-- filtre sur auth.uid() est une ceinture par-dessus les bretelles.

create or replace function public.collection_summary()
returns table (
  folder_id uuid,
  item_count int,
  value_eur numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    f.id as folder_id,
    coalesce(sum(ci.quantity), 0)::int as item_count,
    -- `sum` ignore les NULL et ne renvoie NULL que si TOUT est NULL : c'est
    -- exactement la règle voulue, « la valeur d'un dossier dont aucune carte
    -- n'a de prix est inconnue, pas zéro ».
    sum(
      case when ci.finish in ('foil', 'etched')
           then coalesce(s.eur_foil, s.eur)
           else s.eur
      end * ci.quantity
    ) as value_eur
  from folders f
  left join collection_items ci on ci.folder_id = f.id
  left join card_price_stats s on s.card_id = ci.card_id
  where f.user_id = auth.uid()
  group by f.id
$$;

comment on function public.collection_summary() is
  'Compte et valeur de chaque dossier de l''utilisateur courant. Remplace le '
  'telechargement integral de collection_items, que le plafond de 1000 lignes '
  'de PostgREST tronquait en silence.';

grant execute on function public.collection_summary() to authenticated;
