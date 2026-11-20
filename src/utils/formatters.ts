export function formatConfidence(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '-';
  return `${(score * 100).toFixed(1)}%`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const num = bytes / Math.pow(1024, i);
  return `${num.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
