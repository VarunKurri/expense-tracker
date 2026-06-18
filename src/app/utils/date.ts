export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(date: string): Date {
  return new Date(date + 'T00:00:00');
}

export function daysBetweenLocal(start: string, end: string): number {
  const a = parseLocalDate(start).getTime();
  const b = parseLocalDate(end).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}
