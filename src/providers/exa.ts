import { sanitizeExcerpt } from '../engine/text.js';
import type { HttpClient } from '../http/client.js';
import type { Capability, WebQuery, WebResult, WebSignalsProvider } from './types.js';

export const EXA_COSTS = { webSignals: 1 } as const;

const SEARCH_URL = 'https://api.exa.ai/search';

interface ExaResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  text?: string;
  highlights?: string[];
}

interface ExaResponse {
  results?: ExaResult[];
}

export interface ExaDeps {
  http: HttpClient;
  apiKey: string;
}

export function createExaProvider(deps: ExaDeps): WebSignalsProvider {
  return {
    name: 'exa',

    estimateCost(capability: Capability): number {
      return capability === 'webSignals' ? EXA_COSTS.webSignals : 0;
    },

    async search(query: WebQuery): Promise<WebResult[]> {
      const body: Record<string, unknown> = {
        query: query.query,
        type: 'auto',
        numResults: Math.min(query.max_results ?? 5, 10),
        contents: { text: { maxCharacters: 1500 } },
      };
      if (query.include_domains?.length) body.includeDomains = query.include_domains;
      if (query.exclude_domains?.length) body.excludeDomains = query.exclude_domains;
      if (query.start_date) body.startPublishedDate = query.start_date;
      if (query.end_date) body.endPublishedDate = query.end_date;
      if (query.topic) body.category = query.topic;

      const response = await deps.http.request<ExaResponse>({
        provider: 'exa',
        method: 'POST',
        url: SEARCH_URL,
        headers: { 'x-api-key': deps.apiKey },
        body,
        idempotent: true,
      });

      return (response.results ?? [])
        .filter((result): result is ExaResult & { url: string } => Boolean(result.url))
        .map((result) => ({
          title: result.title ?? '',
          url: result.url,
          excerpt: sanitizeExcerpt(result.text ?? (result.highlights ?? []).join(' ')),
          published_at: result.publishedDate ?? null,
          source: 'exa',
        }));
    },
  };
}
