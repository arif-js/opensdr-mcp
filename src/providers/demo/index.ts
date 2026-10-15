import { createHash } from 'node:crypto';
import type { Company, Person } from '../../types.js';
import type {
  AddLeadsResult,
  CampaignRef,
  CampaignSpec,
  CapabilityMap,
  CompanyQuery,
  CrmContactInput,
  CrmUpsertResult,
  EmailFinding,
  LeadInput,
  NameAtDomain,
  Page,
  Paged,
  PeopleQuery,
  PersonIdentity,
  PersonMatch,
  ProviderEmailVerdict,
  WebQuery,
  WebResult,
} from '../types.js';

function hashId(prefix: string, input: unknown): string {
  const digest = createHash('sha1')
    .update(JSON.stringify(input ?? ''))
    .digest('hex');
  return `${prefix}_${digest.slice(0, 12)}`;
}

function seed(input: unknown): number {
  return createHash('sha256')
    .update(JSON.stringify(input ?? ''))
    .digest()
    .readUInt32BE(0);
}

function demoCompanyFromQuery(query: string): string {
  const quoted = query.match(/"([^"]+)"/);
  if (quoted) return quoted[1];
  const plain = query.match(/^([A-Za-z0-9 .&'-]+)/);
  return plain ? plain[1].trim() : 'the company';
}

const DEMO_SIGNAL_PHRASES: [RegExp, string][] = [
  [/raises|funding|series|seed/i, 'raises a $25M Series B'],
  [/hiring|open roles|job openings|careers/i, 'is hiring 20 engineers'],
  [/appoints|names new|ceo|cto/i, 'appoints a new CTO'],
  [/launches|announces|generally available|unveils/i, 'launches a new platform'],
  [/acquires|acquisition|merger/i, 'acquires a smaller rival'],
  [/migrates|adopts|switches to|deploys/i, 'migrates to a new cloud'],
];

function demoPhraseFor(query: string): string {
  for (const [pattern, phrase] of DEMO_SIGNAL_PHRASES) {
    if (pattern.test(query)) return phrase;
  }
  return 'is in the news';
}

function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length];
}

const FIRST_NAMES = [
  'Jane',
  'Marcus',
  'Priya',
  'Diego',
  'Amara',
  'Wei',
  'Sofia',
  'Omar',
  'Lena',
  'Noah',
];
const LAST_NAMES = [
  'Doe',
  'Reyes',
  'Nair',
  'Alvarez',
  'Okafor',
  'Chen',
  'Moretti',
  'Haddad',
  'Novak',
  'Kelly',
];

interface DemoCompany {
  name: string;
  domain: string;
  industry: string;
  employee_count: number;
  location: string;
  revenue: number;
  technologies: string[];
}

const DEMO_COMPANIES: DemoCompany[] = [
  {
    name: 'Northwind Labs',
    domain: 'northwind.example',
    industry: 'Software',
    employee_count: 120,
    location: 'San Francisco, CA',
    revenue: 24000000,
    technologies: ['react', 'node_js', 'aws'],
  },
  {
    name: 'Ledgerly',
    domain: 'ledgerly.example',
    industry: 'Financial Services',
    employee_count: 320,
    location: 'New York, NY',
    revenue: 90000000,
    technologies: ['salesforce', 'postgresql'],
  },
  {
    name: 'Finch AI',
    domain: 'finch.example',
    industry: 'Software',
    employee_count: 60,
    location: 'Austin, TX',
    revenue: 8000000,
    technologies: ['python', 'segment'],
  },
  {
    name: 'Harborstack',
    domain: 'harborstack.example',
    industry: 'Information Technology',
    employee_count: 1500,
    location: 'Seattle, WA',
    revenue: 180000000,
    technologies: ['aws', 'kubernetes', 'snowflake'],
  },
  {
    name: 'Bluepeak',
    domain: 'bluepeak.example',
    industry: 'Healthcare',
    employee_count: 210,
    location: 'Boston, MA',
    revenue: 45000000,
    technologies: ['salesforce', 'azure'],
  },
  {
    name: 'Quanta Works',
    domain: 'quantaworks.example',
    industry: 'E-commerce',
    employee_count: 90,
    location: 'Remote, US',
    revenue: 15000000,
    technologies: ['shopify', 'stripe'],
  },
  {
    name: 'Cobalt Health',
    domain: 'cobalthealth.example',
    industry: 'Healthcare',
    employee_count: 640,
    location: 'Chicago, IL',
    revenue: 120000000,
    technologies: ['epic', 'aws'],
  },
  {
    name: 'Meridian Pay',
    domain: 'meridianpay.example',
    industry: 'Financial Services',
    employee_count: 480,
    location: 'London, UK',
    revenue: 160000000,
    technologies: ['gcp', 'kubernetes'],
  },
  {
    name: 'Aster Commerce',
    domain: 'astercommerce.example',
    industry: 'E-commerce',
    employee_count: 40,
    location: 'Berlin, DE',
    revenue: 4000000,
    technologies: ['shopify', 'segment'],
  },
  {
    name: 'Vertex Cloud',
    domain: 'vertexcloud.example',
    industry: 'Information Technology',
    employee_count: 2600,
    location: 'Denver, CO',
    revenue: 420000000,
    technologies: ['aws', 'terraform'],
  },
  {
    name: 'Pinehurst Software',
    domain: 'pinehurst.example',
    industry: 'Software',
    employee_count: 75,
    location: 'Portland, OR',
    revenue: 11000000,
    technologies: ['react', 'node_js'],
  },
  {
    name: 'Solstice Analytics',
    domain: 'solstice.example',
    industry: 'Information Technology',
    employee_count: 900,
    location: 'Toronto, CA',
    revenue: 210000000,
    technologies: ['snowflake', 'dbt'],
  },
  {
    name: 'Harbor Claims',
    domain: 'harborclaims.example',
    industry: 'Financial Services',
    employee_count: 140,
    location: 'Miami, FL',
    revenue: 33000000,
    technologies: ['salesforce'],
  },
  {
    name: 'Wellspring Care',
    domain: 'wellspringcare.example',
    industry: 'Healthcare',
    employee_count: 55,
    location: 'Raleigh, NC',
    revenue: 7000000,
    technologies: ['azure'],
  },
  {
    name: 'Cartwheel',
    domain: 'cartwheel.example',
    industry: 'E-commerce',
    employee_count: 330,
    location: 'Los Angeles, CA',
    revenue: 78000000,
    technologies: ['shopify', 'klaviyo'],
  },
];

interface DemoTitle {
  title: string;
  seniority: string;
}

const DEMO_TITLES: DemoTitle[] = [
  { title: 'Founder & CEO', seniority: 'founder' },
  { title: 'Owner', seniority: 'owner' },
  { title: 'Chief Technology Officer', seniority: 'c_suite' },
  { title: 'Partner', seniority: 'partner' },
  { title: 'VP Engineering', seniority: 'vp' },
  { title: 'Head of Growth', seniority: 'head' },
  { title: 'Director of Sales', seniority: 'director' },
  { title: 'Engineering Manager', seniority: 'manager' },
  { title: 'Senior Software Engineer', seniority: 'senior' },
  { title: 'Sales Development Representative', seniority: 'entry' },
  { title: 'Marketing Intern', seniority: 'intern' },
  { title: 'VP Marketing', seniority: 'vp' },
];

const PEOPLE_PER_COMPANY = 4;

function companyRef(company: DemoCompany): { id: string; domain: string; name: string } {
  return { id: hashId('c', company.domain), domain: company.domain, name: company.name };
}

function makePerson(index: number): Person {
  const company = pick(DEMO_COMPANIES, index);
  const title = pick(DEMO_TITLES, index);
  const first = pick(FIRST_NAMES, index);
  // Shift the last name every 10 people so every demo full name is unique (up to 100 people).
  const last = pick(LAST_NAMES, index + 3 + Math.floor(index / FIRST_NAMES.length));
  return {
    id: hashId('p', `demo-${index}`),
    provider_ids: { demo: `demo_${index}` },
    first_name: first,
    last_name: last,
    full_name: `${first} ${last}`,
    title: title.title,
    seniority: title.seniority,
    location: company.location,
    company: companyRef(company),
    sources: ['demo'],
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const DEMO_PEOPLE: Person[] = Array.from(
  { length: DEMO_COMPANIES.length * PEOPLE_PER_COMPANY },
  (_, index) => makePerson(index),
);

function inEmployeeRange(count: number, range: string): boolean {
  const [min, max] = range.split(',').map((part) => Number(part.trim()));
  if (!Number.isFinite(min)) return false;
  const upper = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY;
  return count >= min && count <= upper;
}

function employeeCountFor(domain: string | undefined): number | undefined {
  return DEMO_COMPANIES.find((company) => company.domain === domain)?.employee_count;
}

function matchesPeople(person: Person, query: PeopleQuery): boolean {
  if (query.titles?.length) {
    const title = (person.title ?? '').toLowerCase();
    if (!query.titles.some((candidate) => title.includes(candidate.toLowerCase()))) return false;
  }
  if (query.seniorities?.length) {
    if (!person.seniority || !query.seniorities.includes(person.seniority)) return false;
  }
  if (query.locations?.length) {
    const location = (person.location ?? '').toLowerCase();
    if (!query.locations.some((candidate) => location.includes(candidate.toLowerCase())))
      return false;
  }
  if (query.company_domains?.length) {
    if (!person.company?.domain || !query.company_domains.includes(person.company.domain))
      return false;
  }
  if (query.company_names?.length) {
    const name = (person.company?.name ?? '').toLowerCase();
    if (!query.company_names.some((candidate) => name === candidate.toLowerCase())) return false;
  }
  if (query.industries?.length) {
    const industry = DEMO_COMPANIES.find(
      (company) => company.domain === person.company?.domain,
    )?.industry;
    if (!industry || !query.industries.includes(industry)) return false;
  }
  if (query.employee_ranges?.length) {
    const count = employeeCountFor(person.company?.domain);
    if (
      count === undefined ||
      !query.employee_ranges.some((range) => inEmployeeRange(count, range))
    ) {
      return false;
    }
  }
  if (query.keywords) {
    const haystack = `${person.title ?? ''} ${person.company?.name ?? ''}`.toLowerCase();
    if (!haystack.includes(query.keywords.toLowerCase())) return false;
  }
  return true;
}

function bucketEmployees(count: number): string {
  const ranges = ['1,10', '11,50', '51,200', '201,500', '501,1000', '1001,5000', '5001,10000'];
  return ranges.find((range) => inEmployeeRange(count, range)) ?? '10001,20000';
}

function bucketRevenue(revenue: number): string {
  if (revenue < 1000000) return 'under-1m';
  if (revenue < 10000000) return '1m-10m';
  if (revenue < 50000000) return '10m-50m';
  if (revenue < 100000000) return '50m-100m';
  if (revenue < 500000000) return '100m-500m';
  return 'over-1b';
}

function makeCompany(company: DemoCompany): Company {
  return {
    id: hashId('c', company.domain),
    domain: company.domain,
    name: company.name,
    industry: company.industry,
    employee_count: company.employee_count,
    employee_range: bucketEmployees(company.employee_count),
    revenue_range: bucketRevenue(company.revenue),
    hq_location: company.location,
    technologies: company.technologies,
    founded_year: 2010 + (company.employee_count % 12),
    funding: {
      last_round_type: company.employee_count > 500 ? 'Series C' : 'Series A',
      last_round_date: '2025-09-15',
      total_raised_usd: company.revenue / 4,
    },
    linkedin_url: `https://www.linkedin.com/company/${company.domain.split('.')[0]}`,
    sources: ['demo'],
  };
}

function matchesCompany(company: DemoCompany, query: CompanyQuery): boolean {
  if (query.domains?.length && !query.domains.includes(company.domain)) return false;
  if (
    query.names?.length &&
    !query.names.some((name) => name.toLowerCase() === company.name.toLowerCase())
  ) {
    return false;
  }
  if (query.industries?.length && !query.industries.includes(company.industry)) return false;
  if (query.locations?.length) {
    const location = company.location.toLowerCase();
    if (!query.locations.some((candidate) => location.includes(candidate.toLowerCase())))
      return false;
  }
  if (query.employee_ranges?.length) {
    if (!query.employee_ranges.some((range) => inEmployeeRange(company.employee_count, range)))
      return false;
  }
  if (query.revenue_ranges?.length) {
    const fits = query.revenue_ranges.some(
      (range) =>
        (range.min === undefined || company.revenue >= range.min) &&
        (range.max === undefined || company.revenue <= range.max),
    );
    if (!fits) return false;
  }
  if (query.technologies?.length) {
    const tech = company.technologies.map((item) => item.toLowerCase());
    if (!query.technologies.some((candidate) => tech.includes(candidate.toLowerCase())))
      return false;
  }
  if (query.keywords) {
    const haystack =
      `${company.name} ${company.industry} ${company.technologies.join(' ')}`.toLowerCase();
    if (!haystack.includes(query.keywords.toLowerCase())) return false;
  }
  return true;
}

function paginate<T>(items: T[], cursor: string | null | undefined, limit: number): Paged<T> {
  const page = cursor ? Math.max(1, Number(cursor) || 1) : 1;
  const start = (page - 1) * limit;
  const slice = items.slice(start, start + limit);
  return {
    items: slice,
    next_cursor: start + slice.length < items.length ? String(page + 1) : null,
    total: items.length,
  };
}

/** Known demo company name for a domain, else the domain's first label, capitalized. */
function demoCompanyName(domain: string): string {
  const known = DEMO_COMPANIES.find((company) => company.domain === domain);
  if (known) return known.name;
  const label = domain.split('.')[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function createDemoProvider(): CapabilityMap & { name: string } {
  const name = 'demo';
  const estimateCost = () => 0;

  return {
    name,

    peopleSearch: {
      name,
      estimateCost,
      async searchPeople(query: PeopleQuery, page: Page): Promise<Paged<Person>> {
        const filtered = DEMO_PEOPLE.filter((person) => matchesPeople(person, query));
        return paginate(filtered, page.cursor, page.limit);
      },
    },

    companySearch: {
      name,
      estimateCost,
      async searchCompanies(query: CompanyQuery, page: Page): Promise<Paged<Company>> {
        const filtered = DEMO_COMPANIES.filter((company) => matchesCompany(company, query));
        return paginate(filtered.map(makeCompany), page.cursor, page.limit);
      },
    },

    personEnrich: {
      name,
      estimateCost,
      async matchPerson(identity: PersonIdentity): Promise<PersonMatch | null> {
        if (seed(identity) % 2 === 1) return null;
        // Prefer the matching demo person, so enrichment returns the same person the search showed.
        const lower = (value?: string | null) => value?.trim().toLowerCase();
        const known = DEMO_PEOPLE.find(
          (candidate) =>
            (identity.apollo_id !== undefined &&
              candidate.provider_ids?.demo === identity.apollo_id) ||
            (lower(candidate.first_name) === lower(identity.first_name) &&
              lower(candidate.last_name) === lower(identity.last_name) &&
              (!identity.domain || candidate.company?.domain === lower(identity.domain))),
        );
        const base = known ?? makePerson(0);
        const first = identity.first_name ?? base.first_name ?? 'Jane';
        const last = identity.last_name ?? base.last_name ?? 'Doe';
        const domain = identity.domain ?? base.company?.domain ?? 'northwind.example';
        const company = known?.company ?? {
          id: hashId('c', domain),
          domain,
          name: demoCompanyName(domain),
        };
        const person: Person = {
          ...base,
          ...(known ? {} : { title: undefined, seniority: undefined, location: undefined }),
          first_name: first,
          last_name: last,
          full_name: `${first} ${last}`,
          email: `${first}.${last}@${domain}`.toLowerCase(),
          email_status: 'verified',
          email_confidence: 96,
          company,
        };
        return {
          person,
          email: person.email ?? undefined,
          email_status: 'verified',
          confidence: 96,
        };
      },
    },

    companyEnrich: {
      name,
      estimateCost,
      async enrichCompany(domain: string): Promise<Company | null> {
        const known = DEMO_COMPANIES.find((company) => company.domain === domain);
        if (known) return makeCompany(known);
        return {
          id: hashId('c', domain),
          domain,
          name: demoCompanyName(domain),
          technologies: [],
          sources: ['demo'],
        };
      },
    },

    emailFinder: {
      name,
      estimateCost,
      async findEmail(input: NameAtDomain): Promise<EmailFinding | null> {
        const bucket = seed(input) % 3;
        if (bucket === 2) return null;
        return {
          email: `${input.first_name}.${input.last_name}@${input.domain}`.toLowerCase(),
          score: bucket === 0 ? 95 : 78,
          sources: ['demo'],
        };
      },
    },

    emailVerifier: {
      name,
      estimateCost,
      async verifyEmail(email: string): Promise<ProviderEmailVerdict> {
        const bucket = seed(email) % 5;
        if (bucket === 0) return { email, status: 'accept_all', provider_result: 'accept_all' };
        if (bucket === 1) return { email, status: 'invalid', provider_result: 'invalid' };
        return { email, status: 'verified', provider_result: 'deliverable' };
      },
    },

    webSignals: {
      name,
      estimateCost,
      async search(query: WebQuery): Promise<WebResult[]> {
        const limit = Math.max(1, Math.min(query.max_results ?? 5, 5));
        const company = demoCompanyFromQuery(query.query);
        const slug =
          company
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'company';
        const phrase = demoPhraseFor(query.query);
        const date = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString();

        const results: WebResult[] = [
          {
            title: `${company} ${phrase}`,
            url: `https://news.example/${slug}/story-a`,
            excerpt: `${company} ${phrase}. Demo data, not real news.`,
            published_at: date(3),
            source: 'demo',
          },
          {
            title: `Industry roundup: ${phrase}`,
            url: 'https://news.example/roundup/weekly',
            excerpt: `A weekly roundup covering how a company ${phrase}. Demo data.`,
            published_at: date(8),
            source: 'demo',
          },
          {
            title: `${company} in the news`,
            url: `https://news.example/${slug}/general`,
            excerpt: `${company} appeared in general coverage. Demo data.`,
            published_at: date(200),
            source: 'demo',
          },
        ];
        return results.slice(0, limit);
      },
    },

    campaignSender: {
      name,
      estimateCost,
      async createCampaign(spec: CampaignSpec): Promise<CampaignRef> {
        return { id: hashId('camp', spec), name: spec.name, status: 'paused' };
      },
      async addLeads(campaignId: string, leads: LeadInput[]): Promise<AddLeadsResult> {
        void campaignId;
        return {
          added: leads.length,
          skipped: 0,
          failed: [],
          created_emails: leads.map((lead) => lead.email),
        };
      },
      async listCampaigns(): Promise<CampaignRef[]> {
        return [];
      },
      async getCampaign(campaignId: string): Promise<CampaignRef | null> {
        return { id: campaignId, name: 'Demo campaign', status: '0' };
      },
    },

    crm: {
      name,
      estimateCost,
      async upsertContacts(contacts: CrmContactInput[]): Promise<CrmUpsertResult> {
        return {
          upserted: contacts.length,
          results: contacts.map((contact) => ({
            email: contact.email,
            id: hashId('hs', contact.email),
            action: 'created' as const,
          })),
          failed: [],
        };
      },
    },
  };
}

export type DemoProvider = ReturnType<typeof createDemoProvider>;
