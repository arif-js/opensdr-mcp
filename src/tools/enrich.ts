import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createBudget } from '../engine/budget.js';
import { type DnsResolver, defaultDnsResolver, validateEmail } from '../engine/email-validator.js';
import { normalizeDomain } from '../engine/normalize.js';
import { enrichPerson } from '../engine/waterfall.js';
import { OpenSdrError } from '../errors.js';
import type { ServerContext } from '../server.js';
import { EnrichmentCache } from '../store/cache.js';
import { SuppressionStore } from '../store/suppression.js';
import type { EmailCheck, EmailStatus } from '../types.js';
import { defineTool, ok } from './envelope.js';

const MAX_PEOPLE = 25;
const MAX_DOMAINS = 10;
const MAX_EMAILS = 25;

const demoDns: DnsResolver = {
  resolveMx: async () => [{ exchange: 'mx.example', priority: 1 }],
  resolve4: async () => [],
  resolve6: async () => [],
};

function createValidator(ctx: ServerContext): {
  validate(email: string): ReturnType<typeof validateEmail>;
} {
  const dns = ctx.dns ?? (ctx.config.mode === 'demo' ? demoDns : defaultDnsResolver);
  return { validate: (email: string) => validateEmail(email, { dns }) };
}

function createCache(ctx: ServerContext): EnrichmentCache {
  return new EnrichmentCache({
    path: path.join(ctx.config.dataDir, 'cache.json'),
    ttlDays: ctx.config.cacheTtlDays,
  });
}

const identitySchema = z.object({
  prospect_id: z.string().max(200).optional(),
  apollo_id: z.string().max(120).optional(),
  linkedin_url: z.string().max(300).optional(),
  first_name: z.string().max(120).optional(),
  last_name: z.string().max(120).optional(),
  domain: z.string().max(200).optional(),
  company_name: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
});

const WATERFALL_DESCRIPTION =
  'Find and verify a work email for people through a cost-aware waterfall: Apollo match -> Hunter ' +
  'finder -> optional Hunter verifier -> free local checks (syntax, MX, disposable, role). Paid tiers ' +
  'stop when the budget runs out. Returns each person with an email status, confidence, and a `trail` ' +
  'of what was tried and what it cost. Provide 1-25 people, each identified by prospect_id, apollo_id, ' +
  'linkedin_url, an email, or first_name + last_name + domain. Does NOT send email or reveal phones.';

const ENRICH_COMPANY_DESCRIPTION =
  'Enrich up to 10 company domains with firmographics (industry, headcount, location, technologies, ' +
  'funding) via Apollo organization enrichment. Consumes ~1 Apollo credit per domain; checks the ' +
  'per-call budget first and caches results. Use it after sdr_search_people to qualify accounts, or ' +
  'before sdr_prepare_outreach_brief for grounded personalization.';

const VERIFY_EMAIL_DESCRIPTION =
  'Check whether email addresses are deliverable. Always runs free local checks (syntax, MX, ' +
  'disposable domain, role address). With use_provider=true and a Hunter key, it also runs the Hunter ' +
  'verifier (1 credit each, cached). Returns a status (verified | likely | accept_all | unknown | ' +
  'invalid), a confidence, and the individual checks. Does not do SMTP probing or send anything.';

function mergeStatus(
  providerStatus: EmailStatus | undefined,
  local: { mx: string; disposable: boolean; roleBased: boolean; syntax: boolean },
): EmailStatus {
  if (!local.syntax || local.mx === 'none' || local.disposable) return 'invalid';
  let status: EmailStatus = providerStatus ?? (local.roleBased ? 'likely' : 'unknown');
  if (local.roleBased && status === 'verified') status = 'likely';
  return status;
}

export function registerEnrichTools(server: McpServer, ctx: ServerContext): void {
  const cache = createCache(ctx);
  const validator = createValidator(ctx);
  const suppression = new SuppressionStore({
    path: path.join(ctx.config.dataDir, 'suppression.json'),
    warn: (message) => ctx.logger.warn(message),
  });

  defineTool(server, {
    name: 'sdr_waterfall_enrich_person',
    title: 'Waterfall enrich person',
    description: WATERFALL_DESCRIPTION,
    inputSchema: {
      people: z.array(identitySchema).min(1).max(MAX_PEOPLE).describe('People to enrich (1-25).'),
      max_credits: z.number().int().min(1).max(1000).optional().describe('Per-call credit cap.'),
      force_refresh: z.boolean().optional().describe('Bypass the cache.'),
      verify_with_hunter: z.boolean().optional().describe('Run the Hunter verifier too.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (input) => {
      const hasEmailProvider =
        ctx.registry.resolve('personEnrich') !== null ||
        ctx.registry.resolve('emailFinder') !== null;
      if (!hasEmailProvider && !input.people.some((person) => person.email)) {
        throw new OpenSdrError({
          code: 'NOT_CONFIGURED',
          message: 'No email-capable provider is configured and no input email was provided.',
          hint: 'Set APOLLO_API_KEY or HUNTER_API_KEY, or pass an email for each person.',
        });
      }

      const budgetMax = Math.min(
        ctx.config.maxCreditsPerCall,
        input.max_credits ?? ctx.config.maxCreditsPerCall,
      );
      const budget = createBudget(budgetMax);
      const warnings: string[] = [];
      const results: {
        input_index: number;
        person: unknown;
        email_check: unknown;
        trail: unknown;
        outcome: string;
        error?: { code: string; message: string };
      }[] = [];
      const summary = { found: 0, verified: 0, not_found: 0, suppressed: 0, skipped: 0, error: 0 };

      for (let index = 0; index < input.people.length; index += 1) {
        const identity = input.people[index];
        const budgetExhaustedBefore = !budget.canSpend(1);
        const result = await enrichPerson(
          identity,
          {
            registry: ctx.registry,
            cache,
            suppression,
            budget,
            validator,
          },
          {
            forceRefresh: input.force_refresh,
            verifyWithHunter: input.verify_with_hunter,
          },
        );

        let outcome = result.outcome;
        if (outcome === 'not_found' && budgetExhaustedBefore) outcome = 'skipped';

        warnings.push(...result.warnings);
        if (outcome === 'found') {
          summary.found += 1;
          if (result.email_check?.status === 'verified') summary.verified += 1;
        } else if (outcome === 'suppressed') summary.suppressed += 1;
        else if (outcome === 'skipped') summary.skipped += 1;
        else if (outcome === 'error') summary.error += 1;
        else summary.not_found += 1;

        results.push({
          input_index: index,
          person: result.person,
          email_check: result.email_check,
          trail: result.trail,
          outcome,
          ...(result.error ? { error: result.error } : {}),
        });
      }

      ctx.session.creditsUsed += budget.used;

      return ok(
        { results, summary: { ...summary, credits_used_estimate: budget.used } },
        {
          demo: ctx.config.mode === 'demo',
          sources: ctx.config.mode === 'demo' ? ['demo'] : ['apollo', 'hunter'],
          credits_used_estimate: budget.used,
        },
        warnings,
      );
    },
  });

  defineTool(server, {
    name: 'sdr_enrich_company',
    title: 'Enrich company',
    description: ENRICH_COMPANY_DESCRIPTION,
    inputSchema: {
      domains: z.array(z.string().max(200)).min(1).max(MAX_DOMAINS).describe('Domains (1-10).'),
      max_credits: z.number().int().min(1).max(1000).optional().describe('Per-call credit cap.'),
      force_refresh: z.boolean().optional().describe('Bypass the cache.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (input) => {
      const budgetMax = Math.min(
        ctx.config.maxCreditsPerCall,
        input.max_credits ?? ctx.config.maxCreditsPerCall,
      );
      const budget = createBudget(budgetMax);
      const warnings: string[] = [];
      const companies: { domain: string; company: unknown; outcome: string; cached: boolean }[] =
        [];
      const summary = { found: 0, not_found: 0, skipped: 0, credits_used_estimate: 0 };

      const resolved = ctx.registry.resolve('companyEnrich');
      if (!resolved) {
        throw new OpenSdrError({
          code: 'NOT_CONFIGURED',
          message: 'No company enrichment provider is configured.',
          hint: 'Set APOLLO_API_KEY to enable company enrichment.',
        });
      }
      const provider = resolved.provider as {
        enrichCompany(domain: string): Promise<unknown>;
        estimateCost?(capability: string): number;
      };
      const cost = provider.estimateCost?.('companyEnrich') ?? 1;

      for (const rawDomain of input.domains) {
        const domain = normalizeDomain(rawDomain);
        const cacheKey = `company:${domain}`;
        if (!input.force_refresh) {
          const cached = await cache.get<{ company: unknown }>(cacheKey);
          if (cached) {
            companies.push({ domain, company: cached.company, outcome: 'found', cached: true });
            summary.found += 1;
            continue;
          }
        }
        if (!budget.canSpend(cost)) {
          companies.push({ domain, company: null, outcome: 'skipped', cached: false });
          summary.skipped += 1;
          continue;
        }
        const company = await provider.enrichCompany(domain);
        budget.spend(cost, resolved.name);
        await cache.set(cacheKey, { company }, resolved.name);
        companies.push({
          domain,
          company,
          outcome: company ? 'found' : 'not_found',
          cached: false,
        });
        if (company) summary.found += 1;
        else summary.not_found += 1;
      }

      summary.credits_used_estimate = budget.used;
      ctx.session.creditsUsed += budget.used;

      return ok(
        { companies, summary },
        {
          demo: ctx.config.mode === 'demo',
          sources: [resolved.name],
          credits_used_estimate: budget.used,
        },
        warnings,
      );
    },
  });

  defineTool(server, {
    name: 'sdr_verify_email',
    title: 'Verify email',
    description: VERIFY_EMAIL_DESCRIPTION,
    inputSchema: {
      emails: z
        .array(z.string().max(320))
        .min(1)
        .max(MAX_EMAILS)
        .describe('Emails to check (1-25).'),
      use_provider: z.boolean().optional().describe('Also run the Hunter verifier.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (input) => {
      const warnings: string[] = [];
      const results: EmailCheck[] = [];
      const summary = {
        verified: 0,
        likely: 0,
        accept_all: 0,
        unknown: 0,
        invalid: 0,
        credits_used_estimate: 0,
      };
      const budget = createBudget(ctx.config.maxCreditsPerCall);

      const verifierResolution = input.use_provider ? ctx.registry.resolve('emailVerifier') : null;
      if (input.use_provider && !verifierResolution) {
        warnings.push('use_provider was set but no Hunter key is configured; local checks only.');
      }
      const verifier = verifierResolution?.provider as
        | { verifyEmail(email: string): Promise<{ status: EmailStatus; provider_result?: string }> }
        | undefined;
      const verifyCost = 1;

      for (const rawEmail of input.emails) {
        const email = rawEmail.trim().toLowerCase();
        const local = await validator.validate(email);
        let providerStatus: EmailStatus | undefined;
        let providerResult: string | undefined;

        if (verifier) {
          const cacheKey = `email:${email}`;
          const cached = await cache.get<{ status: EmailStatus; provider_result?: string }>(
            cacheKey,
          );
          if (cached) {
            providerStatus = cached.status;
            providerResult = cached.provider_result;
          } else if (!budget.canSpend(verifyCost)) {
            warnings.push(`Budget exhausted before verifying ${email}; local checks only.`);
          } else {
            try {
              const verdict = await verifier.verifyEmail(email);
              budget.spend(verifyCost, verifierResolution?.name ?? 'hunter');
              providerStatus = verdict.status;
              providerResult = verdict.provider_result;
              if (verdict.provider_result === 'webmail') {
                warnings.push(`${email} is a personal mailbox (webmail).`);
              }
              await cache.set(
                cacheKey,
                { status: verdict.status, provider_result: verdict.provider_result },
                verifierResolution?.name ?? 'hunter',
              );
            } catch (error) {
              warnings.push(
                `Verifier failed for ${email}: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }

        const status = mergeStatus(providerStatus, {
          mx: local.mx,
          disposable: local.disposable,
          roleBased: local.role_based,
          syntax: local.syntax,
        });
        const confidence =
          status === 'verified'
            ? 95
            : status === 'likely'
              ? 80
              : status === 'accept_all'
                ? 60
                : status === 'unknown'
                  ? 50
                  : 0;
        results.push({
          email,
          status,
          confidence,
          checks: {
            syntax: local.syntax,
            mx: local.mx === 'ok',
            disposable: local.disposable,
            role_based: local.role_based,
            ...(providerResult ? { provider_result: providerResult } : {}),
          },
          sources: providerStatus ? ['hunter'] : ['local'],
        });
        summary[status] += 1;
      }

      summary.credits_used_estimate = budget.used;
      ctx.session.creditsUsed += budget.used;

      return ok(
        { emails: results, summary },
        {
          demo: ctx.config.mode === 'demo',
          sources: ctx.config.mode === 'demo' ? ['demo'] : verifier ? ['hunter'] : ['local'],
          credits_used_estimate: budget.used,
        },
        warnings,
      );
    },
  });
}
