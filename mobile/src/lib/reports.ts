// Couche données du récap hebdomadaire.
//
// Le contenu d'un rapport est FIGÉ en base au moment de sa fabrication : rien
// n'est recalculé ici. C'est la condition pour qu'une archive dise toujours la
// même chose — `card_price_stats` raisonne en fenêtre glissante depuis
// aujourd'hui, donc un rapport reconstitué à l'affichage raconterait le
// présent, pas la semaine qu'il prétend décrire.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { AlertMetric } from '@/lib/alerts';
import type { Finish } from '@/lib/types';

/** Une ligne de mouvement, telle que figée dans le rapport. */
export type ReportMover = {
  card_id: string;
  name: string;
  set_code: string;
  collector_number: string;
  rarity: string | null;
  image_small: string | null;
  finish: Finish;
  quantity: number;
  price_now: number;
  price_then: number;
  change_pct: number;
  change_eur: number;
};

/** Une alerte déclenchée dans la fenêtre du rapport. */
export type ReportEvent = {
  card_id: string;
  name: string;
  set_code: string;
  collector_number: string;
  image_small: string | null;
  finish: Finish;
  metric: AlertMetric;
  direction: 'up' | 'down';
  price_now: number | null;
  change_pct: number | null;
  triggered_on: string;
};

export type WeeklyReport = {
  id: string;
  period_start: string;
  period_end: string;
  value_eur: number | null;
  value_change_eur: number | null;
  value_history: number[];
  risers: ReportMover[];
  fallers: ReportMover[];
  events: ReportEvent[];
  event_count: number;
  created_at: string;
  seen_at: string | null;
};

/** Combien de rapports la base conserve. Le job élague au-delà ; l'écran le
 *  dit pour qu'une archive qui se vide ne passe pas pour une perte. */
export const REPORT_RETENTION = 10;

function throwIfError<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** PostgREST rend les `numeric` en nombres, mais pas toujours — un `numeric`
 *  hors plage double revient en chaîne. On force, plutôt que de découvrir la
 *  différence sur un `toFixed` qui n'existe pas. */
const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function normalize(row: Record<string, unknown>): WeeklyReport {
  const movers = (list: unknown): ReportMover[] =>
    ((list ?? []) as Record<string, unknown>[]).map((m) => ({
      ...(m as unknown as ReportMover),
      price_now: num(m.price_now) ?? 0,
      price_then: num(m.price_then) ?? 0,
      change_pct: num(m.change_pct) ?? 0,
      change_eur: num(m.change_eur) ?? 0,
      quantity: num(m.quantity) ?? 1,
    }));

  return {
    ...(row as unknown as WeeklyReport),
    value_eur: num(row.value_eur),
    value_change_eur: num(row.value_change_eur),
    value_history: ((row.value_history ?? []) as unknown[]).map((v) => num(v) ?? 0),
    risers: movers(row.risers),
    fallers: movers(row.fallers),
    events: ((row.events ?? []) as Record<string, unknown>[]).map((e) => ({
      ...(e as unknown as ReportEvent),
      price_now: num(e.price_now),
      change_pct: num(e.change_pct),
    })),
  };
}

/** Tous les rapports conservés, du plus récent au plus ancien.
 *
 *  Une seule requête pour l'onglet Alertes, l'archive et la fiche d'un
 *  rapport : la table est plafonnée à dix lignes par utilisateur, donc tout
 *  rapatrier coûte moins qu'interroger trois fois. C'est le seul endroit de
 *  l'app où un `.select()` nu est sans danger, précisément parce que le
 *  nombre de lignes ne croît pas avec la collection. */
export function useReports() {
  return useQuery({
    queryKey: ['reports'],
    queryFn: async () => {
      const rows = throwIfError(
        await supabase
          .from('weekly_reports')
          .select('*')
          .order('period_end', { ascending: false })
      ) as Record<string, unknown>[];
      return rows.map(normalize);
    },
  });
}

/** Marque un rapport comme lu. Sans effet s'il l'était déjà. */
export function useMarkReportSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      throwIfError(
        await supabase
          .from('weekly_reports')
          .update({ seen_at: new Date().toISOString() })
          .eq('id', id)
          .is('seen_at', null)
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
}

/** La période couverte, en toutes lettres : « 26 août – 2 sept. ». */
export function reportPeriod(report: Pick<WeeklyReport, 'period_start' | 'period_end'>): string {
  const format = (iso: string) => {
    const d = new Date(iso);
    try {
      return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(d);
    } catch {
      return iso.slice(5, 10);
    }
  };
  return `${format(report.period_start)} – ${format(report.period_end)}`;
}

/** Ce que le rapport a retenu, en une ligne. Sert de sous-titre partout où on
 *  montre un rapport sans l'ouvrir. */
export function reportSummary(report: WeeklyReport): string {
  const parts: string[] = [];
  if (report.risers.length > 0) parts.push(`${report.risers.length} hausse${report.risers.length > 1 ? 's' : ''}`);
  if (report.fallers.length > 0) parts.push(`${report.fallers.length} baisse${report.fallers.length > 1 ? 's' : ''}`);
  if (report.event_count > 0) parts.push(`${report.event_count} alerte${report.event_count > 1 ? 's' : ''}`);
  return parts.length > 0 ? parts.join(' · ') : 'Semaine calme';
}
