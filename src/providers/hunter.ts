import { OpenSdrError } from '../errors.js';
import type { HttpClient } from '../http/client.js';
import type { EmailStatus } from '../types.js';
import type {
  Capability,
  EmailFinderProvider,
  EmailFinding,
  EmailVerifierProvider,
  NameAtDomain,
  ProviderEmailVerdict,
} from './types.js';

export const HUNTER_COSTS = { findEmail: 1, verifyEmail: 1 } as const;

const FINDER_URL = 'https://api.hunter.io/v2/email-finder';
const VERIFIER_URL = 'https://api.hunter.io/v2/email-verifier';

export interface HunterDeps {
  http: HttpClient;
  apiKey: string;
}

export interface HunterProvider extends EmailFinderProvider, EmailVerifierProvider {
  estimateCost(capability: Capability): number;
}

interface HunterFinderResponse {
  data?: { email?: string | null; score?: number | null; sources?: { uri?: string }[] } | null;
}

interface HunterVerifierResponse {
  data?: { email?: string; status?: string } | null;
}

function mapVerifierStatus(status: string | undefined): EmailStatus {
  switch (status) {
    case 'valid':
    case 'webmail':
      return 'verified';
    case 'accept_all':
      return 'accept_all';
    case 'disposable':
    case 'invalid':
      return 'invalid';
    default:
      return 'unknown';
  }
}

export function createHunterProvider(deps: HunterDeps): HunterProvider {
  const headers = { 'x-api-key': deps.apiKey };

  const call = async <T>(
    url: string,
    query: Record<string, string | number | boolean | undefined | null>,
  ): Promise<T> => {
    try {
      return await deps.http.request<T>({
        provider: 'hunter',
        method: 'GET',
        url,
        headers,
        query,
        idempotent: true,
      });
    } catch (error) {
      if (error instanceof OpenSdrError) {
        // Hunter uses 403 for rate limiting and 451 for a legal takedown request.
        if (error.code === 'PERMISSION_DENIED') {
          throw new OpenSdrError({
            code: 'RATE_LIMITED',
            message: error.message,
            provider: 'hunter',
            retryable: true,
            hint: 'Hunter rate limit reached. Retry after a short delay.',
          });
        }
        if (error.code === 'NOT_FOUND') return {} as T;
      }
      throw error;
    }
  };

  return {
    name: 'hunter',

    estimateCost(capability: Capability): number {
      if (capability === 'emailFinder') return HUNTER_COSTS.findEmail;
      if (capability === 'emailVerifier') return HUNTER_COSTS.verifyEmail;
      return 0;
    },

    async findEmail(input: NameAtDomain): Promise<EmailFinding | null> {
      const response = await call<HunterFinderResponse>(FINDER_URL, {
        domain: input.domain,
        first_name: input.first_name,
        last_name: input.last_name,
      });
      const email = response.data?.email;
      if (!email) return null;
      return {
        email: email.trim().toLowerCase(),
        score: typeof response.data?.score === 'number' ? response.data.score : 0,
        sources: (response.data?.sources ?? [])
          .map((source) => source.uri)
          .filter((uri): uri is string => typeof uri === 'string'),
      };
    },

    async verifyEmail(email: string): Promise<ProviderEmailVerdict> {
      const response = await call<HunterVerifierResponse>(VERIFIER_URL, { email });
      return {
        email,
        status: mapVerifierStatus(response.data?.status),
        provider_result: response.data?.status ?? 'unknown',
      };
    },
  };
}
