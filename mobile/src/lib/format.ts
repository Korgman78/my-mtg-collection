export function formatEur(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace('.', ',')} %`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(d);
  } catch {
    return iso.slice(5, 10);
  }
}
