import { OpenSdrError } from '../errors.js';

export interface Spend {
  provider: string;
  credits: number;
}

export interface Budget {
  readonly limit: number;
  readonly used: number;
  readonly spends: readonly Spend[];
  remaining(): number;
  canSpend(credits: number): boolean;
  spend(credits: number, provider?: string): void;
}

export function createBudget(limit: number): Budget {
  let used = 0;
  const spends: Spend[] = [];
  return {
    get limit() {
      return limit;
    },
    get used() {
      return used;
    },
    get spends() {
      return spends;
    },
    remaining: () => Math.max(0, limit - used),
    canSpend: (credits) => used + credits <= limit,
    spend: (credits, provider = 'unknown') => {
      used += credits;
      spends.push({ provider, credits });
    },
  };
}

export function budgetExceeded(cost: number, limit: number): OpenSdrError {
  return new OpenSdrError({
    code: 'BUDGET_EXCEEDED',
    message: `Estimated cost of ${cost} credit(s) exceeds the per-call budget of ${limit}.`,
    hint: 'Raise OPENSDR_MAX_CREDITS_PER_CALL, lower the page size, or pass a higher max_credits.',
  });
}
