import taxonomy from './data/filters.json' with { type: 'json' };

export interface FilterValue {
  value: string;
  label: string;
  aliases?: string[];
  min?: number;
  max?: number;
}

export type FilterKind =
  | 'seniority'
  | 'employee_range'
  | 'revenue_range'
  | 'department'
  | 'title'
  | 'industry';

const TAXONOMY = taxonomy as Record<FilterKind, FilterValue[]>;

const KINDS = Object.keys(TAXONOMY) as FilterKind[];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function scoreItem(item: FilterValue, query: string): number {
  const candidates = [item.value, item.label, ...(item.aliases ?? [])].map(normalize);
  const queryTokens = query.split(' ').filter(Boolean);
  let best = 0;
  for (const candidate of candidates) {
    if (candidate === query) return 3;
    if (candidate.includes(query) || query.includes(candidate)) best = Math.max(best, 2);
    const candidateTokens = new Set(candidate.split(' '));
    const overlap = queryTokens.filter((token) => candidateTokens.has(token)).length;
    if (queryTokens.length > 0 && overlap > 0) {
      best = Math.max(best, 1 + overlap / queryTokens.length);
    }
  }
  return best;
}

export function filterKinds(): FilterKind[] {
  return KINDS;
}

export function lookupFilters(kind: FilterKind, query?: string, limit = 20): FilterValue[] {
  const items = TAXONOMY[kind] ?? [];
  if (!query || query.trim() === '') return items.slice(0, limit);
  const normalizedQuery = normalize(query);
  return items
    .map((item) => ({ item, score: scoreItem(item, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function resolveRevenueRange(value: string): { min?: number; max?: number } | null {
  const normalizedValue = normalize(value);
  const item = TAXONOMY.revenue_range.find(
    (entry) =>
      normalize(entry.value) === normalizedValue || normalize(entry.label) === normalizedValue,
  );
  if (!item) return null;
  const resolved: { min?: number; max?: number } = {};
  if (item.min !== undefined) resolved.min = item.min;
  if (item.max !== undefined) resolved.max = item.max;
  return resolved;
}
