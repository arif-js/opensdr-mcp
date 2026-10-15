import type { Registry } from '../providers/registry.js';
import type {
  Capability,
  EmailFinderProvider,
  EmailVerifierProvider,
  PersonEnrichProvider,
  PersonIdentity,
} from '../providers/types.js';
import type { EnrichmentCache } from '../store/cache.js';
import type { EmailCheck, EmailStatus, Person, Prospect } from '../types.js';
import type { Budget } from './budget.js';
import type { EmailValidation } from './email-validator.js';
import { companyNameFromDomain, normalizeDomain } from './normalize.js';
import type { SuppressionChecker } from './suppression.js';

export const HUNTER_LIKELY_MIN = 90;
export const HUNTER_UNKNOWN_MIN = 70;
export const APOLLO_TIER_COST = 1;
export const HUNTER_FIND_COST = 1;
export const HUNTER_VERIFY_COST = 1;

const STATUS_RANK: Record<EmailStatus, number> = {
  invalid: 0,
  unknown: 1,
  accept_all: 2,
  likely: 3,
  verified: 4,
};

export interface EnrichIdentity {
  prospect_id?: string;
  apollo_id?: string;
  linkedin_url?: string;
  first_name?: string;
  last_name?: string;
  domain?: string;
  company_name?: string;
  email?: string;
}

export type EnrichOutcome = 'found' | 'not_found' | 'suppressed' | 'skipped' | 'error';

export interface TierTrail {
  tier: string;
  provider?: string;
  status: 'attempted' | 'skipped' | 'hit';
  reason?: string;
  outcome?: string;
  credits: number;
}

export interface WaterfallResult {
  person: Person | null;
  email_check: EmailCheck | null;
  trail: TierTrail[];
  outcome: EnrichOutcome;
  warnings: string[];
  error?: { code: string; message: string };
  credits_used: number;
  dedupe_key: string | null;
}

export interface WaterfallOptions {
  forceRefresh?: boolean;
  verifyWithHunter?: boolean;
}

export interface WaterfallDeps {
  registry: Registry;
  cache: EnrichmentCache;
  suppression: SuppressionChecker;
  budget: Budget;
  validator: { validate(email: string): Promise<EmailValidation> };
  prospects?: { updateProspect(id: string, patch: Partial<Prospect>): Promise<void> };
}

interface Candidate {
  email: string;
  status: EmailStatus;
  confidence?: number;
  sources: string[];
  providerResult?: string;
}

interface CachedEnrichment {
  person: Person | null;
  email_check: EmailCheck | null;
}

function rank(status: EmailStatus): number {
  return STATUS_RANK[status];
}

function isUsable(identity: EnrichIdentity): boolean {
  if (identity.email) return true;
  if (identity.prospect_id || identity.apollo_id || identity.linkedin_url) return true;
  if (identity.first_name && identity.last_name && identity.domain) return true;
  return false;
}

export function dedupeKeyFor(identity: EnrichIdentity): string | null {
  if (identity.email) return `email:${identity.email.trim().toLowerCase()}`;
  if (identity.linkedin_url) return `linkedin:${identity.linkedin_url.trim().toLowerCase()}`;
  if (identity.apollo_id) return `apollo:${identity.apollo_id}`;
  if (identity.first_name && identity.last_name && identity.domain) {
    const name = `${identity.first_name} ${identity.last_name}`.toLowerCase();
    return `name:${name}@${identity.domain}`;
  }
  return null;
}

function providerCost(
  provider: { estimateCost?: (capability: Capability) => number },
  capability: Capability,
  fallback: number,
): number {
  const estimate = provider.estimateCost?.(capability);
  return typeof estimate === 'number' ? estimate : fallback;
}

function defaultConfidence(status: EmailStatus): number {
  switch (status) {
    case 'verified':
      return 95;
    case 'likely':
      return 80;
    case 'accept_all':
      return 60;
    case 'unknown':
      return 50;
    default:
      return 0;
  }
}

function applyValidation(
  candidate: Candidate,
  validation: EmailValidation,
  warnings: string[],
): Candidate {
  let status = candidate.status;
  if (!validation.syntax || validation.mx === 'none' || validation.disposable) {
    status = 'invalid';
  } else {
    if (validation.mx === 'unknown') {
      warnings.push(`MX lookup for ${candidate.email} was inconclusive (network error).`);
    }
    if (validation.role_based && rank(status) > rank('likely')) {
      status = 'likely';
      warnings.push(`${candidate.email} is a role address; status capped at "likely".`);
    }
  }
  return { ...candidate, status, providerResult: candidate.providerResult };
}

function buildPerson(
  identity: EnrichIdentity,
  apolloPerson: Person | null,
  candidate: Candidate,
): Person | null {
  if (apolloPerson) {
    return { ...apolloPerson, email: candidate.email, email_status: candidate.status };
  }
  const key = identity.apollo_id ?? identity.linkedin_url ?? candidate.email;
  const first = identity.first_name ?? null;
  const last = identity.last_name ?? null;
  const person: Person = {
    id: `p_${Buffer.from(String(key)).toString('base64url').slice(0, 12)}`,
    provider_ids: identity.apollo_id ? { apollo: identity.apollo_id } : {},
    sources: candidate.sources,
    email: candidate.email,
    email_status: candidate.status,
  };
  if (first) person.first_name = first;
  if (last) person.last_name = last;
  if (first || last) person.full_name = [first, last].filter(Boolean).join(' ');
  const domain = identity.domain ?? candidate.email.split('@')[1];
  if (domain)
    person.company = { domain, name: identity.company_name ?? companyNameFromDomain(domain) };
  return person;
}

export async function enrichPerson(
  rawIdentity: EnrichIdentity,
  deps: WaterfallDeps,
  options: WaterfallOptions = {},
): Promise<WaterfallResult> {
  const identity: EnrichIdentity = { ...rawIdentity };
  if (identity.domain) identity.domain = normalizeDomain(identity.domain);
  if (identity.email) identity.email = identity.email.trim().toLowerCase();

  const trail: TierTrail[] = [];
  const warnings: string[] = [];
  const dedupeKey = dedupeKeyFor(identity);

  if (!isUsable(identity)) {
    return {
      person: null,
      email_check: null,
      trail,
      outcome: 'error',
      warnings,
      error: {
        code: 'BAD_INPUT',
        message: 'Not enough information to identify a person.',
      },
      credits_used: 0,
      dedupe_key: dedupeKey,
    };
  }

  const domain = identity.domain ?? identity.email?.split('@')[1];
  const suppression = await deps.suppression.isSuppressed({ email: identity.email, domain });
  if (suppression.suppressed) {
    trail.push({ tier: 'suppression', status: 'hit', reason: suppression.reason, credits: 0 });
    return {
      person: null,
      email_check: null,
      trail,
      outcome: 'suppressed',
      warnings,
      credits_used: 0,
      dedupe_key: dedupeKey,
    };
  }
  trail.push({ tier: 'suppression', status: 'attempted', outcome: 'clear', credits: 0 });

  const cacheKey = `person:${dedupeKey}`;
  if (!options.forceRefresh) {
    const cached = await deps.cache.get<CachedEnrichment>(cacheKey);
    if (cached) {
      trail.push({ tier: 'cache', status: 'hit', credits: 0 });
      return {
        person: cached.person,
        email_check: cached.email_check,
        trail,
        outcome: cached.email_check ? 'found' : 'not_found',
        warnings,
        credits_used: 0,
        dedupe_key: dedupeKey,
      };
    }
  }
  trail.push({
    tier: 'cache',
    status: 'skipped',
    reason: options.forceRefresh ? 'force_refresh' : 'miss',
    credits: 0,
  });

  let candidate: Candidate | null = null;
  let apolloPerson: Person | null = null;
  let lastValidation: EmailValidation | null = null;

  if (identity.email) {
    candidate = {
      email: identity.email,
      status: 'unknown',
      sources: ['input'],
      providerResult: 'input',
    };
    trail.push({ tier: 'input_email', status: 'hit', outcome: 'provided', credits: 0 });
  }

  const apollo = deps.registry.resolve('personEnrich');
  if (!apollo) {
    trail.push({
      tier: 'apollo',
      provider: 'apollo',
      status: 'skipped',
      reason: 'not_configured',
      credits: 0,
    });
  } else if (candidate && rank(candidate.status) >= rank('verified')) {
    trail.push({
      tier: 'apollo',
      provider: apollo.name,
      status: 'skipped',
      reason: 'already_verified',
      credits: 0,
    });
  } else {
    const provider = apollo.provider as PersonEnrichProvider;
    const cost = providerCost(provider, 'personEnrich', APOLLO_TIER_COST);
    if (!deps.budget.canSpend(cost)) {
      trail.push({
        tier: 'apollo',
        provider: apollo.name,
        status: 'skipped',
        reason: 'budget',
        credits: 0,
      });
    } else {
      try {
        const match = await provider.matchPerson(identity as PersonIdentity);
        deps.budget.spend(cost, apollo.name);
        if (match?.email) {
          const status: EmailStatus = match.email_status === 'verified' ? 'verified' : 'unknown';
          candidate = {
            email: match.email,
            status,
            confidence: match.confidence,
            sources: [apollo.name],
            providerResult: match.email_status ?? 'unknown',
          };
        }
        if (match?.person) apolloPerson = match.person;
        trail.push({
          tier: 'apollo',
          provider: apollo.name,
          status: 'hit',
          outcome: match?.email ? (match.email_status ?? 'unknown') : 'no_email',
          credits: cost,
        });
      } catch (error) {
        deps.budget.spend(cost, apollo.name);
        const message = error instanceof Error ? error.message : String(error);
        trail.push({
          tier: 'apollo',
          provider: apollo.name,
          status: 'attempted',
          outcome: 'error',
          reason: message,
          credits: cost,
        });
        warnings.push(`Apollo match failed: ${message}`);
      }
    }
  }

  const finder = deps.registry.resolve('emailFinder');
  const needsFinder = !candidate || rank(candidate.status) < rank('verified');
  if (!finder) {
    trail.push({
      tier: 'hunter_finder',
      provider: 'hunter',
      status: 'skipped',
      reason: 'not_configured',
      credits: 0,
    });
  } else if (!needsFinder) {
    trail.push({
      tier: 'hunter_finder',
      provider: finder.name,
      status: 'skipped',
      reason: 'already_verified',
      credits: 0,
    });
  } else if (!identity.first_name || !identity.last_name || !domain) {
    trail.push({
      tier: 'hunter_finder',
      provider: finder.name,
      status: 'skipped',
      reason: 'missing_name_or_domain',
      credits: 0,
    });
  } else {
    const provider = finder.provider as EmailFinderProvider;
    const cost = providerCost(provider, 'emailFinder', HUNTER_FIND_COST);
    if (!deps.budget.canSpend(cost)) {
      trail.push({
        tier: 'hunter_finder',
        provider: finder.name,
        status: 'skipped',
        reason: 'budget',
        credits: 0,
      });
    } else {
      try {
        const finding = await provider.findEmail({
          first_name: identity.first_name,
          last_name: identity.last_name,
          domain,
        });
        deps.budget.spend(cost, finder.name);
        if (finding && finding.score >= HUNTER_LIKELY_MIN) {
          candidate = {
            email: finding.email,
            status: 'likely',
            confidence: finding.score,
            sources: [finder.name],
            providerResult: `score:${finding.score}`,
          };
          trail.push({
            tier: 'hunter_finder',
            provider: finder.name,
            status: 'hit',
            outcome: 'likely',
            credits: cost,
          });
        } else if (finding && finding.score >= HUNTER_UNKNOWN_MIN) {
          candidate = {
            email: finding.email,
            status: 'unknown',
            confidence: finding.score,
            sources: [finder.name],
            providerResult: `score:${finding.score}`,
          };
          trail.push({
            tier: 'hunter_finder',
            provider: finder.name,
            status: 'hit',
            outcome: 'unknown',
            credits: cost,
          });
        } else {
          trail.push({
            tier: 'hunter_finder',
            provider: finder.name,
            status: 'attempted',
            outcome: finding ? 'low_score' : 'no_match',
            credits: cost,
          });
        }
      } catch (error) {
        deps.budget.spend(cost, finder.name);
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('rate')) {
          trail.push({
            tier: 'hunter_finder',
            provider: finder.name,
            status: 'attempted',
            outcome: 'rate_limited',
            credits: cost,
          });
        } else {
          trail.push({
            tier: 'hunter_finder',
            provider: finder.name,
            status: 'attempted',
            outcome: 'error',
            reason: message,
            credits: cost,
          });
          warnings.push(`Hunter finder failed: ${message}`);
        }
      }
    }
  }

  if (options.verifyWithHunter && candidate?.email) {
    const verifier = deps.registry.resolve('emailVerifier');
    if (!verifier) {
      trail.push({
        tier: 'hunter_verifier',
        provider: 'hunter',
        status: 'skipped',
        reason: 'not_configured',
        credits: 0,
      });
    } else {
      const provider = verifier.provider as EmailVerifierProvider;
      const cost = providerCost(provider, 'emailVerifier', HUNTER_VERIFY_COST);
      if (!deps.budget.canSpend(cost)) {
        trail.push({
          tier: 'hunter_verifier',
          provider: verifier.name,
          status: 'skipped',
          reason: 'budget',
          credits: 0,
        });
      } else {
        try {
          const verdict = await provider.verifyEmail(candidate.email);
          deps.budget.spend(cost, verifier.name);
          candidate = {
            ...candidate,
            status: verdict.status,
            providerResult: verdict.provider_result,
          };
          if (verdict.provider_result === 'webmail') {
            warnings.push(`${candidate.email} is a personal mailbox (webmail).`);
          }
          trail.push({
            tier: 'hunter_verifier',
            provider: verifier.name,
            status: 'hit',
            outcome: verdict.status,
            credits: cost,
          });
        } catch (error) {
          deps.budget.spend(cost, verifier.name);
          const message = error instanceof Error ? error.message : String(error);
          trail.push({
            tier: 'hunter_verifier',
            provider: verifier.name,
            status: 'attempted',
            outcome: 'error',
            reason: message,
            credits: cost,
          });
          warnings.push(`Hunter verifier failed: ${message}`);
        }
      }
    }
  }

  if (candidate?.email) {
    lastValidation = await deps.validator.validate(candidate.email);
    candidate = applyValidation(candidate, lastValidation, warnings);
    trail.push({
      tier: 'local',
      status: 'hit',
      outcome: lastValidation.status_cap ?? 'ok',
      credits: 0,
    });
  } else {
    trail.push({ tier: 'local', status: 'skipped', reason: 'no_email', credits: 0 });
  }

  const emailCheck: EmailCheck | null = candidate?.email
    ? {
        email: candidate.email,
        status: candidate.status,
        confidence: candidate.confidence ?? defaultConfidence(candidate.status),
        checks: {
          syntax: lastValidation?.syntax,
          mx: lastValidation ? lastValidation.mx === 'ok' : undefined,
          disposable: lastValidation?.disposable,
          role_based: lastValidation?.role_based,
          provider_result: candidate.providerResult,
        },
        sources: candidate.sources,
      }
    : null;

  const person = candidate?.email ? buildPerson(identity, apolloPerson, candidate) : apolloPerson;
  const outcome: EnrichOutcome = candidate?.email ? 'found' : 'not_found';

  await deps.cache.set(
    cacheKey,
    { person, email_check: emailCheck },
    candidate?.sources.join(',') ?? 'none',
  );

  if (identity.prospect_id && deps.prospects) {
    try {
      await deps.prospects.updateProspect(identity.prospect_id, {
        email: candidate?.email,
        email_status: candidate?.status,
        status: 'enriched',
      });
    } catch (error) {
      warnings.push(
        `Failed to update prospect ${identity.prospect_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (identity.prospect_id) {
    warnings.push('Prospect update skipped: the lead store is not available yet.');
  }

  return {
    person,
    email_check: emailCheck,
    trail,
    outcome,
    warnings,
    credits_used: deps.budget.used,
    dedupe_key: dedupeKey,
  };
}
