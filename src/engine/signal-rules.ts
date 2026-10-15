import type { Signal, SignalConfidence, SignalType } from '../types.js';
import rules from './data/signal-rules.json' with { type: 'json' };
import { canonicalUrl, normalizeTitle } from './text.js';

interface TypeRule {
  label: string;
  query: string;
  keywords: string[];
}

const RULES = rules as { window_days: number; types: Record<SignalType, TypeRule> };

export const DEFAULT_SIGNAL_WINDOW_DAYS = RULES.window_days;

export const SIGNAL_TYPES = Object.keys(RULES.types) as SignalType[];

export interface SignalQuery {
  type: SignalType;
  query: string;
}

export interface ClassifyInput {
  title: string;
  excerpt: string;
  url: string;
  published_at?: string | null;
}

export interface Classification {
  confidence: SignalConfidence;
  matched_rule: string;
}

export function buildQueries(companyName: string, types: SignalType[]): SignalQuery[] {
  return types.map((type) => ({
    type,
    query: RULES.types[type].query.replaceAll('{company}', companyName),
  }));
}

export function classify(
  result: ClassifyInput,
  options: { companyName: string; domain?: string; type: SignalType; windowStart: Date },
): Classification | null {
  const rule = RULES.types[options.type];
  if (!rule) return null;
  const haystack = `${result.title} ${result.excerpt}`.toLowerCase();
  const keyword = rule.keywords.find((candidate) => haystack.includes(candidate));
  if (!keyword) return null;

  const name = options.companyName.trim().toLowerCase();
  const nameMatch = name !== '' && result.title.toLowerCase().includes(name);
  const domainMatch = options.domain
    ? result.url.toLowerCase().includes(options.domain.toLowerCase())
    : false;
  const companyMatch = nameMatch || domainMatch;

  if (!options.domain) {
    if (!nameMatch) return null;
  } else if (!companyMatch) {
    return null;
  }

  const date = result.published_at ? Date.parse(result.published_at) : Number.NaN;
  const inWindow = Number.isFinite(date) && date >= options.windowStart.getTime();

  const matches = (companyMatch ? 1 : 0) + 1 + (inWindow ? 1 : 0);
  let confidence: SignalConfidence = matches >= 3 ? 'high' : matches === 2 ? 'medium' : 'low';

  if (!options.domain && !domainMatch) confidence = 'low';

  return { confidence, matched_rule: `${options.type}:${keyword}` };
}

export function toSignal(
  result: ClassifyInput,
  type: SignalType,
  classification: Classification,
  source?: string,
): Signal {
  const signal: Signal = {
    type,
    title: result.title,
    url: result.url,
    excerpt: result.excerpt,
    confidence: classification.confidence,
    matched_rule: classification.matched_rule,
  };
  if (result.published_at) signal.published_at = result.published_at;
  if (source) signal.source = source;
  return signal;
}

const CONFIDENCE_RANK: Record<SignalConfidence, number> = { high: 3, medium: 2, low: 1 };

export function sortSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => {
    const byConfidence = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
    if (byConfidence !== 0) return byConfidence;
    const dateA = a.published_at ? Date.parse(a.published_at) : 0;
    const dateB = b.published_at ? Date.parse(b.published_at) : 0;
    return dateB - dateA;
  });
}

export function dedupeSignals(signals: Signal[]): Signal[] {
  const byUrl = new Map<string, Signal>();
  for (const signal of signals) {
    const key = canonicalUrl(signal.url);
    if (!byUrl.has(key)) byUrl.set(key, signal);
  }
  const byTitle = new Map<string, Signal>();
  for (const signal of byUrl.values()) {
    const key = normalizeTitle(signal.title).slice(0, 60);
    const existing = byTitle.get(key);
    if (!existing || CONFIDENCE_RANK[signal.confidence] > CONFIDENCE_RANK[existing.confidence]) {
      byTitle.set(key, signal);
    }
  }
  return [...byTitle.values()];
}
