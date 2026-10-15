import { sanitizeExcerpt } from '../engine/text.js';
import type { HttpClient } from '../http/client.js';
import type { Capability, WebQuery, WebResult, WebSignalsProvider } from './types.js';

export const TAVILY_COSTS = { webSignals: 1 } as const;

const SEARCH_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
  published_date?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export interface TavilyDeps {
  http: HttpClient;
  apiKey: string;
}

export function createTavilyProvider(deps: TavilyDeps): WebSignalsProvider {
  return {
    name: 'tavily',

    estimateCost(capability: Capability): number {
      return capability === 'webSignals' ? TAVILY_COSTS.webSignals : 0;
    },

    async search(query: WebQuery): Promise<WebResult[]> {
      const body: Record<string, unknown> = {
        query: query.query,
        search_depth: 'basic',
        max_results: Math.min(query.max_results ?? 5, 10),
        include_published_date: true,
      };
      if (query.topic) body.topic = query.topic;
      if (query.include_domains?.length) body.include_domains = query.include_domains;
      if (query.exclude_domains?.length) body.exclude_domains = query.exclude_domains;
      if (query.start_date) body.start_date = query.start_date;
      if (query.end_date) body.end_date = query.end_date;

      const response = await deps.http.request<TavilyResponse>({
        provider: 'tavily',
        method: 'POST',
        url: SEARCH_URL,
        headers: { authorization: `Bearer ${deps.apiKey}` },
        body,
        idempotent: true,
      });

      return (response.results ?? [])
        .filter((result): result is TavilyResult & { url: string } => Boolean(result.url))
        .map((result) => ({
          title: result.title ?? '',
          url: result.url,
          excerpt: sanitizeExcerpt(result.content ?? ''),
          published_at: result.published_date ?? null,
          ...(typeof result.score === 'number' ? { score: result.score } : {}),
          source: 'tavily',
        }));
    },
  };
}
