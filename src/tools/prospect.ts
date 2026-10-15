import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { budgetExceeded, createBudget } from '../engine/budget.js';
import { assertCursorMatches, decodeCursor, encodeCursor, hashQuery } from '../engine/cursor.js';
import { lookupFilters, resolveRevenueRange } from '../engine/filters.js';
import { normalizeDomain } from '../engine/normalize.js';
import { OpenSdrError } from '../errors.js';
import { APOLLO_COSTS } from '../providers/apollo.js';
import type { CompanyQuery, PeopleQuery } from '../providers/types.js';
import type { ServerContext } from '../server.js';
import { Seniority } from '../types.js';
import { defineTool, ok } from './envelope.js';

const MAX_LIST_LIMIT = 50;

const LOOKUP_DESCRIPTION =
  'Look up normalized filter values for Apollo searches: seniority, employee_range, revenue_range, ' +
  'department, title or industry. Free and local: no network call, no credits. Use it before ' +
  'sdr_search_people or sdr_search_companies to turn plain-English ICP terms into exact values ' +
  '(for example query "vp eng" returns "VP Engineering"). Returns up to `limit` matches.';

const SEARCH_PEOPLE_DESCRIPTION =
  'Search for people (prospects) by title, seniority, location, company domain or size. Free: the ' +
  'Apollo People API Search consumes no credits. Does NOT return emails or phones — use ' +
  'sdr_waterfall_enrich_person on the people you want. Requires at least one filter. Results are ' +
  'paginated with an opaque `cursor`; pass it back unchanged. Each person carries an apollo id for ' +
  'enrichment. Use sdr_lookup_filters first for exact titles, seniorities and size ranges.';

const SEARCH_COMPANIES_DESCRIPTION =
  'Search for companies by industry, keywords, size, location, technology or domain. Consumes Apollo ' +
  'credits (~1 credit per page); the call is checked against the per-call credit budget first. ' +
  'Requires at least one filter. Paginated with an opaque `cursor`; pass it back unchanged. Use it to ' +
  'find accounts, then sdr_search_people with `organization_domains`, or sdr_enrich_company for details.';

const EMPLOYEE_RANGE = z
  .string()
  .max(40)
  .describe('An employee range like "51,200" (use sdr_lookup_filters kind "employee_range").');

const cursorSchema = z
  .string()
  .max(500)
  .nullable()
  .optional()
  .describe('Opaque pagination cursor from a previous call. Omit to start at page 1.');

function sourceFor(ctx: ServerContext): string[] {
  return ctx.config.mode === 'demo' ? ['demo'] : ['apollo'];
}

function hasAnyFilter(values: unknown[]): boolean {
  return values.some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === 'string' && value.trim() !== '';
  });
}

export function registerProspectTools(server: McpServer, ctx: ServerContext): void {
  defineTool(server, {
    name: 'sdr_lookup_filters',
    title: 'Look up filter values',
    description: LOOKUP_DESCRIPTION,
    inputSchema: {
      kind: z
        .enum(['seniority', 'employee_range', 'revenue_range', 'department', 'title', 'industry'])
        .describe('Which filter taxonomy to look up.'),
      query: z
        .string()
        .max(200)
        .optional()
        .describe('Fuzzy search text, e.g. "vp eng". Omit to list the first values.'),
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum values to return.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: ({ kind, query, limit }) => {
      const items = lookupFilters(kind, query, limit);
      return ok({ kind, count: items.length, items }, { demo: ctx.config.mode === 'demo' });
    },
  });

  defineTool(server, {
    name: 'sdr_search_people',
    title: 'Search people',
    description: SEARCH_PEOPLE_DESCRIPTION,
    inputSchema: {
      job_titles: z.array(z.string().max(120)).max(10).optional().describe('Job titles to match.'),
      person_seniorities: z
        .array(Seniority)
        .max(11)
        .optional()
        .describe('Apollo seniority levels.'),
      person_locations: z
        .array(z.string().max(120))
        .max(20)
        .optional()
        .describe('Where the person lives.'),
      organization_domains: z
        .array(z.string().max(200))
        .max(50)
        .optional()
        .describe('Employer domains, normalized (no www.).'),
      organization_locations: z
        .array(z.string().max(120))
        .max(20)
        .optional()
        .describe('Employer HQ locations.'),
      employee_ranges: z
        .array(EMPLOYEE_RANGE)
        .max(14)
        .optional()
        .describe('Employer headcount ranges.'),
      keywords: z.string().max(300).optional().describe('Free-text keywords.'),
      limit: z.number().int().min(1).max(1000).default(10).describe('Results per page (max 50).'),
      cursor: cursorSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => {
      const warnings: string[] = [];
      if (
        !hasAnyFilter([
          input.job_titles,
          input.person_seniorities,
          input.person_locations,
          input.organization_domains,
          input.organization_locations,
          input.employee_ranges,
          input.keywords,
        ])
      ) {
        throw new OpenSdrError({
          code: 'BAD_INPUT',
          message: 'Provide at least one filter.',
          hint: 'Add job_titles, person_seniorities, locations, organization_domains or employee_ranges.',
        });
      }

      const perPage = Math.min(input.limit, MAX_LIST_LIMIT);
      if (input.limit > MAX_LIST_LIMIT) {
        warnings.push(`limit was clamped to ${MAX_LIST_LIMIT}.`);
      }

      const query: PeopleQuery = {};
      if (input.job_titles?.length) query.titles = input.job_titles;
      if (input.person_seniorities?.length) query.seniorities = input.person_seniorities;
      if (input.person_locations?.length) query.locations = input.person_locations;
      if (input.organization_domains?.length) {
        query.company_domains = input.organization_domains.map(normalizeDomain);
      }
      if (input.organization_locations?.length) {
        query.organization_locations = input.organization_locations;
      }
      if (input.employee_ranges?.length) query.employee_ranges = input.employee_ranges;
      if (input.keywords) query.keywords = input.keywords;

      const hash = hashQuery({ query, per_page: perPage });
      let page = 1;
      if (input.cursor) {
        const decoded = decodeCursor(input.cursor);
        assertCursorMatches(decoded, hash);
        page = decoded.page;
      }

      const provider = ctx.registry.get('peopleSearch');
      const result = await provider.searchPeople(query, { cursor: String(page), limit: perPage });

      if (result.items.length === 0) {
        warnings.push(
          'No people matched. Broaden the filters, or use sdr_lookup_filters for exact titles and sizes.',
        );
      }

      const nextCursor = result.next_cursor
        ? encodeCursor({ page: Number(result.next_cursor), per_page: perPage, hash })
        : null;

      return ok(
        { people: result.items, total_estimate: result.total ?? null },
        {
          demo: ctx.config.mode === 'demo',
          sources: sourceFor(ctx),
          next_cursor: nextCursor,
          credits_used_estimate: 0,
        },
        warnings,
      );
    },
  });

  defineTool(server, {
    name: 'sdr_search_companies',
    title: 'Search companies',
    description: SEARCH_COMPANIES_DESCRIPTION,
    inputSchema: {
      industries: z.array(z.string().max(120)).max(20).optional().describe('Industry keywords.'),
      keywords: z.string().max(300).optional().describe('Free-text company keywords.'),
      employee_ranges: z.array(EMPLOYEE_RANGE).max(14).optional().describe('Headcount ranges.'),
      revenue_ranges: z
        .array(z.string().max(40))
        .max(10)
        .optional()
        .describe('Revenue buckets from sdr_lookup_filters kind "revenue_range".'),
      locations: z.array(z.string().max(120)).max(20).optional().describe('Company HQ locations.'),
      technologies: z.array(z.string().max(80)).max(20).optional().describe('Technologies in use.'),
      domains: z
        .array(z.string().max(200))
        .max(50)
        .optional()
        .describe('Company domains, normalized.'),
      limit: z.number().int().min(1).max(1000).default(10).describe('Results per page (max 50).'),
      cursor: cursorSchema,
      max_credits: z.number().int().min(1).max(1000).optional().describe('Per-call credit cap.'),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: async (input) => {
      const warnings: string[] = [];
      if (
        !hasAnyFilter([
          input.industries,
          input.keywords,
          input.employee_ranges,
          input.revenue_ranges,
          input.locations,
          input.technologies,
          input.domains,
        ])
      ) {
        throw new OpenSdrError({
          code: 'BAD_INPUT',
          message: 'Provide at least one filter.',
          hint: 'Add industries, keywords, employee_ranges, locations or domains.',
        });
      }

      const perPage = Math.min(input.limit, MAX_LIST_LIMIT);
      if (input.limit > MAX_LIST_LIMIT) {
        warnings.push(`limit was clamped to ${MAX_LIST_LIMIT}.`);
      }

      const query: CompanyQuery = {};
      if (input.industries?.length) query.industries = input.industries;
      if (input.keywords) query.keywords = input.keywords;
      if (input.employee_ranges?.length) query.employee_ranges = input.employee_ranges;
      if (input.locations?.length) query.locations = input.locations;
      if (input.technologies?.length) query.technologies = input.technologies;
      if (input.domains?.length) query.domains = input.domains.map(normalizeDomain);
      if (input.revenue_ranges?.length) {
        query.revenue_ranges = input.revenue_ranges.map((value) => {
          const resolved = resolveRevenue(value);
          return resolved;
        });
      }

      const cost = ctx.config.mode === 'demo' ? 0 : APOLLO_COSTS.companySearch;
      const budgetMax = Math.min(
        ctx.config.maxCreditsPerCall,
        input.max_credits ?? ctx.config.maxCreditsPerCall,
      );
      const budget = createBudget(budgetMax);
      if (!budget.canSpend(cost)) {
        throw budgetExceeded(cost, budgetMax);
      }

      const hash = hashQuery({ query, per_page: perPage });
      let page = 1;
      if (input.cursor) {
        const decoded = decodeCursor(input.cursor);
        assertCursorMatches(decoded, hash);
        page = decoded.page;
      }

      const provider = ctx.registry.get('companySearch');
      const result = await provider.searchCompanies(query, {
        cursor: String(page),
        limit: perPage,
      });
      budget.spend(cost, ctx.config.mode === 'demo' ? 'demo' : 'apollo');
      ctx.session.creditsUsed += cost;

      if (result.items.length === 0) {
        warnings.push('No companies matched. Broaden the filters or remove a constraint.');
      }

      const nextCursor = result.next_cursor
        ? encodeCursor({ page: Number(result.next_cursor), per_page: perPage, hash })
        : null;

      return ok(
        { companies: result.items, total_estimate: result.total ?? null },
        {
          demo: ctx.config.mode === 'demo',
          sources: sourceFor(ctx),
          next_cursor: nextCursor,
          credits_used_estimate: cost,
        },
        warnings,
      );
    },
  });
}

function resolveRevenue(value: string): { min?: number; max?: number } {
  const resolved = resolveRevenueRange(value);
  if (!resolved) {
    throw new OpenSdrError({
      code: 'BAD_INPUT',
      message: `Unknown revenue range "${value}".`,
      hint: 'Use sdr_lookup_filters kind "revenue_range" for the accepted values.',
    });
  }
  return resolved;
}
