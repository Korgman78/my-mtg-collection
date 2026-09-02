-- Le récap hebdomadaire vit dans l'app, plus dans un email.
--
-- Pourquoi ce changement : le digest partait par Resend, ce qui suppose un
-- compte tiers, une clé en secret GitHub, et un domaine vérifié pour écrire
-- ailleurs qu'à sa propre adresse. Le secret n'a jamais été posé, et rien ne
-- le disait — mesuré le 2026-09-02, l'étape d'envoi durait 0 seconde sur cinq
-- exécutions de deux workflows, c'est-à-dire le chemin « RESEND_API_KEY
-- absent », qui sort avant même de se connecter à la base. Douze jours de
-- silence, et des runs verts.
--
-- Dans l'app : pas de compte, pas de domaine, pas de secret, et rien qui
-- puisse finir dans un dossier indésirables.
--
-- ---------------------------------------------------------------------------
-- Pourquoi le contenu est FIGÉ et non recalculé à l'affichage
-- ---------------------------------------------------------------------------
-- C'est la décision structurante de ce fichier. `card_price_stats` calcule
-- toutes ses variations par rapport à AUJOURD'HUI : `change_7d_pct` compare le
-- dernier relevé à celui d'il y a sept jours, glissants. Un rapport du 17 août
-- recalculé un mois plus tard ne montrerait donc pas ce qui s'est passé cette
-- semaine-là, mais ce que ces cartes valent maintenant — l'archive dirait
-- autre chose à chaque consultation.
--
-- Un rapport est un instantané. On le fabrique une fois, on le range, il ne
-- bouge plus. D'où les colonnes `jsonb` : elles portent ce qui a été observé,
-- pas une requête à rejouer.

create table if not exists public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- La semaine couverte. `period_end` est le jour de fabrication.
  period_start date not null,
  period_end date not null,

  -- Valeur de la collection ce jour-là, écart sur la fenêtre, et les huit
  -- derniers relevés pour tracer la courbe sans autre requête.
  value_eur numeric(12, 2),
  value_change_eur numeric(12, 2),
  value_history numeric(12, 2)[] not null default '{}',

  -- Ce qui a bougé, indépendamment des règles d'alerte. C'est ce qui fait
  -- qu'un rapport a du contenu même une semaine sans déclenchement — le
  -- défaut dont souffrait l'email, dont les règles à +50 % ne parlaient
  -- presque jamais.
  risers jsonb not null default '[]',
  fallers jsonb not null default '[]',

  -- Les alertes déclenchées dans la fenêtre.
  events jsonb not null default '[]',
  event_count int not null default 0,

  created_at timestamptz not null default now(),
  seen_at timestamptz,

  -- Un seul rapport par utilisateur et par date de fin : relancer le job le
  -- même jour réécrit, il n'empile pas.
  unique (user_id, period_end)
);

create index if not exists weekly_reports_user_idx
  on public.weekly_reports (user_id, period_end desc);

comment on table public.weekly_reports is
  'Recap hebdomadaire fige au moment de sa fabrication. Remplace le digest '
  'email. Les 10 plus recents par utilisateur sont conserves.';

-- ---------------------------------------------------------------------------
-- Prix plancher des mouvements retenus.
--
-- Mesuré le 2026-08-20 et déjà appliqué aux alertes et aux tendances : sur les
-- 16 cartes ayant pris 50 % ou plus dans la journée, les 16 valaient moins de
-- 20 centimes. Sans plancher, un classement en pourcentage ne parle que de
-- monnaie. Un euro est le seuil retenu ailleurs dans l'app, on s'y tient.
-- ---------------------------------------------------------------------------

create or replace function public.build_weekly_reports(window_days int default 7)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  target record;
  built integer := 0;
  v_start date := current_date - window_days;
  v_now numeric;
  v_before numeric;
  v_history numeric[];
  v_risers jsonb;
  v_fallers jsonb;
  v_events jsonb;
begin
  for target in select distinct user_id as id from folders loop

    -- Valeur courante et historique, sur les dossiers de collection seuls :
    -- une wishlist ne vaut rien, on ne la possède pas.
    select array_agg(total order by snapped_on)
      into v_history
      from (
        select cvs.snapped_on, sum(cvs.value_eur) as total
          from collection_value_snapshots cvs
          join folders f on f.id = cvs.folder_id and f.kind = 'collection'
         where cvs.user_id = target.id
         group by cvs.snapped_on
         order by cvs.snapped_on desc
         limit 8
      ) h;

    v_history := coalesce(v_history, '{}');
    v_now := case when array_length(v_history, 1) > 0
                  then v_history[array_length(v_history, 1)] end;
    v_before := case when array_length(v_history, 1) > 1 then v_history[1] end;

    -- Les mouvements de la semaine. Même matière que l'onglet Tendances, mais
    -- sans `auth.uid()` : le job tourne sans session, il désigne l'utilisateur.
    with owned as (
      select ci.card_id, ci.finish, sum(ci.quantity)::int as quantity
        from collection_items ci
        join folders f on f.id = ci.folder_id
       where f.user_id = target.id
         and f.kind = 'collection'
       group by ci.card_id, ci.finish
    ),
    priced as (
      select
        o.card_id, c.name, c.set_code, c.collector_number, c.rarity,
        c.image_small, o.finish, o.quantity,
        case when o.finish in ('foil', 'etched')
             then coalesce(s.eur_foil, s.eur) else s.eur end as price_now,
        case when o.finish in ('foil', 'etched')
             then coalesce(s.eur_foil_7d_ago, s.eur_7d_ago) else s.eur_7d_ago end as price_then
        from owned o
        join cards c on c.id = o.card_id
        join card_price_stats s on s.card_id = o.card_id
    ),
    moved as (
      select
        p.card_id, p.name, p.set_code, p.collector_number, p.rarity,
        p.image_small, p.finish, p.quantity, p.price_now, p.price_then,
        round((p.price_now - p.price_then) / p.price_then * 100, 1) as change_pct,
        round(p.price_now - p.price_then, 2) as change_eur
        from priced p
       where p.price_now is not null
         and p.price_then is not null
         and p.price_then > 0
         and p.price_now <> p.price_then
         -- Le plancher porte sur le prix courant : ce qui compte est ce que la
         -- carte vaut aujourd'hui, pas ce qu'elle valait avant de monter.
         and p.price_now >= 1
    )
    select
      coalesce((
        select jsonb_agg(to_jsonb(x) order by x.change_pct desc)
          from (select * from moved where change_pct > 0
                 order by change_pct desc limit 5) x
      ), '[]'::jsonb),
      coalesce((
        select jsonb_agg(to_jsonb(x) order by x.change_pct asc)
          from (select * from moved where change_pct < 0
                 order by change_pct asc limit 5) x
      ), '[]'::jsonb)
      into v_risers, v_fallers;

    -- Les alertes de la fenêtre, avec de quoi les afficher sans rejointure.
    select coalesce(jsonb_agg(to_jsonb(e) order by e.triggered_on desc), '[]'::jsonb)
      into v_events
      from (
        select ev.card_id, c.name, c.set_code, c.collector_number, c.image_small,
               ev.finish, ev.metric, ev.direction, ev.price_now, ev.change_pct,
               ev.triggered_on
          from alert_events ev
          join cards c on c.id = ev.card_id
         where ev.user_id = target.id
           and ev.triggered_on > v_start
         order by ev.triggered_on desc
         limit 50
      ) e;

    insert into weekly_reports (
      user_id, period_start, period_end, value_eur, value_change_eur,
      value_history, risers, fallers, events, event_count
    )
    values (
      target.id, v_start, current_date, v_now,
      case when v_now is not null and v_before is not null then v_now - v_before end,
      v_history, v_risers, v_fallers, v_events, jsonb_array_length(v_events)
    )
    on conflict (user_id, period_end) do update set
      period_start     = excluded.period_start,
      value_eur        = excluded.value_eur,
      value_change_eur = excluded.value_change_eur,
      value_history    = excluded.value_history,
      risers           = excluded.risers,
      fallers          = excluded.fallers,
      events           = excluded.events,
      event_count      = excluded.event_count,
      created_at       = now(),
      -- Un rapport réécrit redevient non lu : son contenu a changé.
      seen_at          = null;

    -- On ne garde que les dix plus récents. Une archive sans limite finirait
    -- par peser plus que l'historique de prix lui-même, pour une valeur qui
    -- décroît vite : personne ne relit le récap d'il y a six mois.
    delete from weekly_reports old
     where old.user_id = target.id
       and old.id not in (
         select id from weekly_reports
          where user_id = target.id
          order by period_end desc
          limit 10
       );

    built := built + 1;
  end loop;

  return built;
end;
$$;

comment on function public.build_weekly_reports(int) is
  'Fabrique le recap hebdomadaire de chaque utilisateur et elague au-dela de '
  '10 rapports. Appelee par le workflow weekly-report.';

-- ---------------------------------------------------------------------------
-- Row Level Security : chacun ne voit que ses rapports, et ne peut que les
-- marquer comme lus. L'écriture appartient au job, qui se connecte en direct
-- et contourne la RLS.
-- ---------------------------------------------------------------------------
alter table public.weekly_reports enable row level security;

create policy "own reports" on public.weekly_reports
  for select to authenticated using (user_id = auth.uid());

create policy "mark reports seen" on public.weekly_reports
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
