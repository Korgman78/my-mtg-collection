// Couche données des alertes : règles, événements, compteur non-lus.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';
import type { CardRow, Finish } from '@/lib/types';

export type AlertMetric = 'pct_change' | 'corridor_breakout' | 'threshold_above' | 'threshold_below';

export type AlertRule = {
  id: string;
  user_id: string;
  name: string | null;
  scope: 'collection' | 'folder' | 'card';
  folder_id: string | null;
  card_id: string | null;
  finish: Finish | null;
  metric: AlertMetric;
  window_days: 1 | 7 | 30;
  threshold: number | null;
  direction: 'up' | 'down' | 'both';
  channel: 'digest' | 'immediate';
  enabled: boolean;
  created_at: string;
};

export type AlertEvent = {
  id: string;
  rule_id: string;
  card_id: string;
  finish: Finish;
  triggered_on: string;
  metric: AlertMetric;
  direction: 'up' | 'down';
  price_now: number | null;
  change_pct: number | null;
  seen_at: string | null;
  created_at: string;
  card?: CardRow;
};

export type NewAlertRule = {
  name: string | null;
  scope: 'collection' | 'folder' | 'card';
  folder_id?: string | null;
  card_id?: string | null;
  finish?: Finish | null;
  metric: AlertMetric;
  window_days: 1 | 7 | 30;
  threshold: number | null;
  direction: 'up' | 'down' | 'both';
  channel: 'digest' | 'immediate';
};

function throwIfError<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export function useAlerts() {
  return useQuery({
    queryKey: ['alerts', 'all'],
    queryFn: async () => {
      const [rules, events] = await Promise.all([
        supabase.from('alert_rules').select('*').order('created_at', { ascending: false }),
        supabase
          .from('alert_events')
          .select('*, card:cards(*)')
          .order('created_at', { ascending: false })
          .limit(50),
      ]).then((r) => r.map(throwIfError)) as [AlertRule[], AlertEvent[]];
      return { rules, events };
    },
  });
}

export function useUnseenAlertCount() {
  return useQuery({
    queryKey: ['alerts', 'unseen'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('alert_events')
        .select('id', { count: 'exact', head: true })
        .is('seen_at', null);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}

export function useMarkAlertsSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      throwIfError(
        await supabase.from('alert_events').update({ seen_at: new Date().toISOString() }).is('seen_at', null)
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts', 'unseen'] }),
  });
}

export function useCreateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: NewAlertRule) => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error('Non connecté');
      throwIfError(await supabase.from('alert_rules').insert({ ...rule, user_id: user.id }));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useToggleRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      throwIfError(await supabase.from('alert_rules').update({ enabled }).eq('id', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      throwIfError(await supabase.from('alert_rules').delete().eq('id', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

/** Description lisible d'une règle, pour la liste. */
export function describeRule(rule: AlertRule, folderName?: string, cardName?: string): string {
  const scope =
    rule.scope === 'collection'
      ? 'Toute la collection'
      : rule.scope === 'folder'
        ? (folderName ?? 'Dossier')
        : (cardName ?? 'Carte');
  const metric =
    rule.metric === 'pct_change'
      ? `variation ${rule.window_days} j ≥ ${rule.threshold} %`
      : rule.metric === 'corridor_breakout'
        ? 'sortie du couloir 30 j'
        : rule.metric === 'threshold_above'
          ? `prix ≥ ${rule.threshold} €`
          : `prix ≤ ${rule.threshold} €`;
  const direction =
    rule.direction === 'both' ? '' : rule.direction === 'up' ? ' · hausses' : ' · baisses';
  const channel = rule.channel === 'digest' ? 'digest hebdo' : 'email immédiat';
  return `${scope} · ${metric}${direction} · ${channel}`;
}
