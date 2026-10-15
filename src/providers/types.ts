import type { Company, EmailStatus, Person } from '../types.js';

export interface Page {
  cursor?: string | null;
  limit: number;
}

export interface Paged<T> {
  items: T[];
  next_cursor: string | null;
  total?: number;
}

export interface PeopleQuery {
  titles?: string[];
  seniorities?: string[];
  company_domains?: string[];
  company_names?: string[];
  locations?: string[];
  organization_locations?: string[];
  employee_ranges?: string[];
  industries?: string[];
  keywords?: string;
}

export interface CompanyQuery {
  domains?: string[];
  names?: string[];
  industries?: string[];
  locations?: string[];
  employee_ranges?: string[];
  revenue_ranges?: { min?: number; max?: number }[];
  technologies?: string[];
  keywords?: string;
}

export interface PersonIdentity {
  person_id?: string;
  apollo_id?: string;
  linkedin_url?: string;
  first_name?: string;
  last_name?: string;
  domain?: string;
  email?: string;
  company_name?: string;
}

export interface PersonMatch {
  person: Person;
  email?: string;
  email_status?: EmailStatus;
  confidence?: number;
}

export interface NameAtDomain {
  first_name: string;
  last_name: string;
  domain: string;
}

export interface EmailFinding {
  email: string;
  score: number;
  sources: string[];
}

export interface ProviderEmailVerdict {
  email: string;
  status: EmailStatus;
  provider_result?: string;
}

export interface WebQuery {
  query: string;
  include_domains?: string[];
  exclude_domains?: string[];
  start_date?: string;
  end_date?: string;
  topic?: string;
  max_results?: number;
}

export interface WebResult {
  title: string;
  url: string;
  excerpt: string;
  published_at?: string | null;
  score?: number;
  source?: string;
}

export interface CampaignStep {
  subject: string;
  body: string;
  delay_days: number;
}

export interface CampaignSchedule {
  timezone: string;
  days: string[];
  start_hour: number;
  end_hour: number;
}

export interface CampaignSpec {
  name: string;
  steps: CampaignStep[];
  schedule: CampaignSchedule;
  sending_accounts?: string[];
  daily_limit?: number;
}

export interface CampaignRef {
  id: string;
  name: string;
  status: string;
}

export interface LeadInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_variables?: Record<string, string>;
}

export interface AddLeadsResult {
  added: number;
  skipped: number;
  failed: { email: string; error: string }[];
  created_emails?: string[];
}

export interface CrmContactInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  properties?: Record<string, string>;
}

export interface CrmUpsertResult {
  upserted: number;
  results: { email: string; id: string; action: 'created' | 'updated' }[];
  failed: { email: string; error: string }[];
}

export interface Provider {
  readonly name: string;
  estimateCost?(capability: Capability): number;
}

export interface PeopleSearchProvider extends Provider {
  searchPeople(query: PeopleQuery, page: Page): Promise<Paged<Person>>;
}

export interface CompanySearchProvider extends Provider {
  searchCompanies(query: CompanyQuery, page: Page): Promise<Paged<Company>>;
}

export interface PersonEnrichProvider extends Provider {
  matchPerson(identity: PersonIdentity): Promise<PersonMatch | null>;
}

export interface CompanyEnrichProvider extends Provider {
  enrichCompany(domain: string): Promise<Company | null>;
}

export interface EmailFinderProvider extends Provider {
  findEmail(input: NameAtDomain): Promise<EmailFinding | null>;
}

export interface EmailVerifierProvider extends Provider {
  verifyEmail(email: string): Promise<ProviderEmailVerdict>;
}

export interface WebSignalsProvider extends Provider {
  search(query: WebQuery): Promise<WebResult[]>;
}

export interface CampaignSender extends Provider {
  createCampaign(spec: CampaignSpec): Promise<CampaignRef>;
  addLeads(campaignId: string, leads: LeadInput[]): Promise<AddLeadsResult>;
  listCampaigns(): Promise<CampaignRef[]>;
  getCampaign?(campaignId: string): Promise<CampaignRef | null>;
}

export interface CrmProvider extends Provider {
  upsertContacts(contacts: CrmContactInput[]): Promise<CrmUpsertResult>;
}

export type Capability =
  | 'peopleSearch'
  | 'companySearch'
  | 'personEnrich'
  | 'companyEnrich'
  | 'emailFinder'
  | 'emailVerifier'
  | 'webSignals'
  | 'campaignSender'
  | 'crm';

export interface CapabilityMap {
  peopleSearch: PeopleSearchProvider;
  companySearch: CompanySearchProvider;
  personEnrich: PersonEnrichProvider;
  companyEnrich: CompanyEnrichProvider;
  emailFinder: EmailFinderProvider;
  emailVerifier: EmailVerifierProvider;
  webSignals: WebSignalsProvider;
  campaignSender: CampaignSender;
  crm: CrmProvider;
}

export const CAPABILITIES: Capability[] = [
  'peopleSearch',
  'companySearch',
  'personEnrich',
  'companyEnrich',
  'emailFinder',
  'emailVerifier',
  'webSignals',
  'campaignSender',
  'crm',
];

export const CAPABILITY_ENV: Record<Capability, string> = {
  peopleSearch: 'APOLLO_API_KEY',
  companySearch: 'APOLLO_API_KEY',
  personEnrich: 'APOLLO_API_KEY',
  companyEnrich: 'APOLLO_API_KEY',
  emailFinder: 'HUNTER_API_KEY',
  emailVerifier: 'HUNTER_API_KEY',
  webSignals: 'EXA_API_KEY or TAVILY_API_KEY',
  campaignSender: 'INSTANTLY_API_KEY',
  crm: 'HUBSPOT_ACCESS_TOKEN',
};
