import { normalizeDomain } from '../engine/normalize.js';
import { OpenSdrError } from '../errors.js';
import type { HttpClient } from '../http/client.js';
import type { Company, EmailStatus, Person } from '../types.js';
import type {
  Capability,
  CompanyEnrichProvider,
  CompanyQuery,
  CompanySearchProvider,
  Page,
  Paged,
  PeopleQuery,
  PeopleSearchProvider,
  PersonEnrichProvider,
  PersonIdentity,
  PersonMatch,
} from './types.js';

export const APOLLO_COSTS = {
  peopleSearch: 0,
  companySearch: 1,
  matchPerson: 1,
  enrichCompany: 1,
} as const;

const PEOPLE_URL = 'https://api.apollo.io/api/v1/mixed_people/api_search';
const COMPANIES_URL = 'https://api.apollo.io/api/v1/mixed_companies/search';
const MATCH_URL = 'https://api.apollo.io/api/v1/people/match';
const ENRICH_URL = 'https://api.apollo.io/api/v1/organizations/enrich';
const MAX_PAGES = 500;
const PER_PAGE_MAX = 100;

export interface ApolloDeps {
  http: HttpClient;
  apiKey: string;
}

export interface ApolloProvider
  extends PeopleSearchProvider,
    CompanySearchProvider,
    PersonEnrichProvider,
    CompanyEnrichProvider {
  estimateCost(capability: Capability): number;
}

interface ApolloPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  last_name_obfuscated?: string;
  name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  last_refreshed_at?: string;
  organization?: { name?: string; primary_domain?: string };
}

interface ApolloPeopleResponse {
  total_entries?: number;
  people?: ApolloPerson[];
}

interface ApolloMatchResponse {
  person?: ApolloPerson | null;
  match_confidence?: string;
}

interface ApolloOrganization {
  id?: string;
  name?: string;
  primary_domain?: string;
  website_url?: string;
  industry?: string;
  estimated_num_employees?: number;
  founded_year?: number;
  organization_city?: string;
  organization_state?: string;
  organization_country?: string;
  technology_names?: string[];
  linkedin_url?: string;
  latest_funding_stage?: string;
  total_funding?: number;
}

interface ApolloCompanyResponse {
  total_entries?: number;
  organizations?: ApolloOrganization[];
}

interface ApolloOrgEnrichResponse {
  organization?: ApolloOrganization | null;
}

function parsePage(cursor: string | null | undefined): number {
  const page = cursor ? Number(cursor) : 1;
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function clampPerPage(limit: number): number {
  return Math.max(1, Math.min(limit, PER_PAGE_MAX));
}

function paged<T>(items: T[], page: number, perPage: number, total?: number): Paged<T> {
  const totalCount = total ?? (page - 1) * perPage + items.length;
  const hasMore = items.length > 0 && page < MAX_PAGES && page * perPage < totalCount;
  return { items, total: totalCount, next_cursor: hasMore ? String(page + 1) : null };
}

function buildPeopleBody(
  query: PeopleQuery,
  page: number,
  perPage: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = { page, per_page: perPage };
  if (query.titles?.length) body.person_titles = query.titles;
  if (query.seniorities?.length) body.person_seniorities = query.seniorities;
  if (query.locations?.length) body.person_locations = query.locations;
  if (query.organization_locations?.length)
    body.organization_locations = query.organization_locations;
  if (query.company_domains?.length) body.q_organization_domains_list = query.company_domains;
  if (query.company_names?.length) body.q_organization_name = query.company_names[0];
  if (query.employee_ranges?.length) body.organization_num_employees_ranges = query.employee_ranges;
  if (query.industries?.length) body.q_organization_keyword_tags = query.industries;
  if (query.keywords) body.q_keywords = query.keywords;
  return body;
}

function buildCompanyBody(
  query: CompanyQuery,
  page: number,
  perPage: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = { page, per_page: perPage };
  if (query.domains?.length) body.q_organization_domains_list = query.domains;
  if (query.names?.length) body.q_organization_name = query.names[0];
  if (query.employee_ranges?.length) body.organization_num_employees_ranges = query.employee_ranges;
  if (query.locations?.length) body.organization_locations = query.locations;
  if (query.technologies?.length) body.currently_using_any_of_technology_uids = query.technologies;
  const tags = [...(query.industries ?? []), ...(query.keywords ? [query.keywords] : [])];
  if (tags.length) body.q_organization_keyword_tags = tags;
  if (query.revenue_ranges?.length) {
    const mins = query.revenue_ranges
      .map((range) => range.min)
      .filter((value): value is number => typeof value === 'number');
    const maxes = query.revenue_ranges
      .map((range) => range.max)
      .filter((value): value is number => typeof value === 'number');
    if (mins.length) body['revenue_range[min]'] = Math.min(...mins);
    if (maxes.length) body['revenue_range[max]'] = Math.max(...maxes);
  }
  return body;
}

function buildMatchBody(identity: PersonIdentity): Record<string, unknown> {
  const body: Record<string, unknown> = {
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };
  if (identity.first_name) body.first_name = identity.first_name;
  if (identity.last_name) body.last_name = identity.last_name;
  if (identity.domain) body.domain = identity.domain;
  if (identity.apollo_id) body.id = identity.apollo_id;
  if (identity.linkedin_url) body.linkedin_url = identity.linkedin_url;
  if (identity.email) body.email = identity.email;
  if (identity.company_name) body.organization_name = identity.company_name;
  return body;
}

function mapEmailStatus(status: string | undefined): EmailStatus {
  switch (status) {
    case 'verified':
      return 'verified';
    case 'guessed':
    case 'extrapolated':
      return 'likely';
    case 'catch_all':
      return 'accept_all';
    case 'unavailable':
    case 'bounced':
    case 'invalid':
      return 'invalid';
    default:
      return 'unknown';
  }
}

function confidenceFor(matchConfidence: string | undefined): number | undefined {
  switch (matchConfidence) {
    case 'high':
      return 95;
    case 'medium':
      return 70;
    case 'low':
      return 40;
    default:
      return undefined;
  }
}

/**
 * Maps an Apollo search person. Search deliberately returns no email/phone, so
 * neither is copied even if a response happens to include one.
 */
function toPerson(raw: ApolloPerson): Person {
  const first = raw.first_name?.trim() || null;
  const last = (raw.last_name ?? raw.last_name_obfuscated)?.trim() || null;
  const apolloId = raw.id ?? `${first ?? ''}${last ?? ''}`;
  const person: Person = {
    id: `p_${apolloId.slice(0, 12)}`,
    provider_ids: raw.id ? { apollo: raw.id } : {},
    sources: ['apollo'],
  };
  if (first) person.first_name = first;
  if (last) person.last_name = last;
  if (first || last) person.full_name = [first, last].filter(Boolean).join(' ');
  if (raw.title) person.title = raw.title;
  if (raw.organization?.name) person.company = { name: raw.organization.name };
  if (raw.last_refreshed_at) person.updated_at = raw.last_refreshed_at;
  return person;
}

function toMatchedPerson(raw: ApolloPerson): Person {
  const person = toPerson(raw);
  if (raw.email) person.email = raw.email.trim().toLowerCase();
  if (raw.email_status) person.email_status = mapEmailStatus(raw.email_status);
  if (raw.linkedin_url) person.linkedin_url = raw.linkedin_url;
  const location = [raw.city, raw.state, raw.country].filter(Boolean).join(', ');
  if (location) person.location = location;
  if (raw.organization?.primary_domain) {
    person.company = {
      ...(person.company ?? {}),
      domain: normalizeDomain(raw.organization.primary_domain),
    };
  }
  return person;
}

function toCompany(raw: ApolloOrganization): Company {
  const domain = normalizeDomain(raw.primary_domain ?? raw.website_url ?? '');
  const company: Company = {
    id: `c_${(raw.id ?? domain ?? raw.name ?? '').slice(0, 12)}`,
    domain: domain || null,
    name: raw.name ?? domain ?? 'Unknown',
    technologies: raw.technology_names ?? [],
    sources: ['apollo'],
  };
  if (raw.industry) company.industry = raw.industry;
  if (typeof raw.estimated_num_employees === 'number') {
    company.employee_count = raw.estimated_num_employees;
  }
  if (typeof raw.founded_year === 'number') company.founded_year = raw.founded_year;
  const hq = [raw.organization_city, raw.organization_state, raw.organization_country]
    .filter(Boolean)
    .join(', ');
  if (hq) company.hq_location = hq;
  if (raw.linkedin_url) company.linkedin_url = raw.linkedin_url;
  if (raw.latest_funding_stage || typeof raw.total_funding === 'number') {
    company.funding = {
      last_round_type: raw.latest_funding_stage ?? null,
      total_raised_usd: raw.total_funding ?? null,
    };
  }
  return company;
}

export function createApolloProvider(deps: ApolloDeps): ApolloProvider {
  const headers = { 'x-api-key': deps.apiKey, 'cache-control': 'no-cache' };

  const call = async <T>(
    url: string,
    options: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number | boolean | undefined | null>;
      idempotent?: boolean;
    } = {},
  ): Promise<T> => {
    try {
      return await deps.http.request<T>({
        provider: 'apollo',
        method: options.method ?? 'POST',
        url,
        headers,
        body: options.body,
        query: options.query,
        // Searches are repeatable; matchPerson is not (a retry can charge credits again).
        idempotent: options.idempotent ?? true,
      });
    } catch (error) {
      if (error instanceof OpenSdrError && error.code === 'PERMISSION_DENIED') {
        throw new OpenSdrError({
          code: 'PERMISSION_DENIED',
          message: error.message,
          provider: 'apollo',
          retryable: false,
          hint: 'Apollo rejected this key. Some endpoints require a master API key (Apollo Settings → API → create a master key).',
        });
      }
      throw error;
    }
  };

  return {
    name: 'apollo',

    estimateCost(capability: Capability): number {
      switch (capability) {
        case 'peopleSearch':
          return APOLLO_COSTS.peopleSearch;
        case 'companySearch':
          return APOLLO_COSTS.companySearch;
        case 'personEnrich':
          return APOLLO_COSTS.matchPerson;
        case 'companyEnrich':
          return APOLLO_COSTS.enrichCompany;
        default:
          return 0;
      }
    },

    async searchPeople(query: PeopleQuery, page: Page): Promise<Paged<Person>> {
      const pageNumber = parsePage(page.cursor);
      const perPage = clampPerPage(page.limit);
      const response = await call<ApolloPeopleResponse>(PEOPLE_URL, {
        body: buildPeopleBody(query, pageNumber, perPage),
      });
      const people = (response.people ?? []).map(toPerson);
      return paged(people, pageNumber, perPage, response.total_entries);
    },

    async searchCompanies(query: CompanyQuery, page: Page): Promise<Paged<Company>> {
      const pageNumber = parsePage(page.cursor);
      const perPage = clampPerPage(page.limit);
      const response = await call<ApolloCompanyResponse>(COMPANIES_URL, {
        body: buildCompanyBody(query, pageNumber, perPage),
      });
      const companies = (response.organizations ?? []).map(toCompany);
      return paged(companies, pageNumber, perPage, response.total_entries);
    },

    async matchPerson(identity: PersonIdentity): Promise<PersonMatch | null> {
      const response = await call<ApolloMatchResponse>(MATCH_URL, {
        body: buildMatchBody(identity),
        idempotent: false,
      });
      if (!response.person || response.match_confidence === 'none') return null;
      const person = toMatchedPerson(response.person);
      const match: PersonMatch = { person };
      if (person.email) match.email = person.email;
      if (person.email_status) match.email_status = person.email_status;
      const confidence = confidenceFor(response.match_confidence);
      if (confidence !== undefined) match.confidence = confidence;
      return match;
    },

    async enrichCompany(domain: string): Promise<Company | null> {
      const response = await call<ApolloOrgEnrichResponse>(ENRICH_URL, {
        method: 'GET',
        query: { domain: normalizeDomain(domain) },
      });
      if (!response.organization) return null;
      return toCompany(response.organization);
    },
  };
}
