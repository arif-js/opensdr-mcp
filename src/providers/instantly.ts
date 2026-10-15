import { OpenSdrError } from '../errors.js';
import type { HttpClient } from '../http/client.js';
import type {
  AddLeadsResult,
  CampaignRef,
  CampaignSender,
  CampaignSpec,
  Capability,
  LeadInput,
} from './types.js';

export const INSTANTLY_COSTS = { createCampaign: 0, addLeads: 0 } as const;

const BASE_URL = 'https://api.instantly.ai/api/v2';
const DAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface InstantlyDeps {
  http: HttpClient;
  apiKey: string;
}

interface InstantlyCampaign {
  id: string;
  name?: string;
  status?: number;
}

interface InstantlyAddLeadsResponse {
  status?: string;
  leads_uploaded?: number;
  duplicated_leads?: number;
  skipped_count?: number;
  invalid_email_count?: number;
  in_blocklist?: number;
  duplicate_email_count?: number;
  incomplete_count?: number;
  created_leads?: { id: string; email: string; index: number }[];
}

interface InstantlyCampaignList {
  items?: InstantlyCampaign[];
  campaigns?: InstantlyCampaign[];
  data?: InstantlyCampaign[];
}

function hour(hour: number): string {
  return `${String(Math.min(Math.max(hour, 0), 23)).padStart(2, '0')}:00`;
}

// Instantly v2 campaign `status` enum, per the official get-campaign reference
// (https://developer.instantly.ai/api-reference/campaign/get-campaign, checked 2026-10-13).
const STATUS_LABELS: Record<number, string> = {
  0: 'draft',
  1: 'active',
  2: 'paused',
  3: 'completed',
  4: 'running_subsequences',
  [-1]: 'accounts_unhealthy',
  [-2]: 'bounce_protect',
  [-99]: 'account_suspended',
};

/** Statuses in which adding leads cannot start sending on its own. */
export const SAFE_PUSH_STATUSES = new Set(['draft', 'paused']);

export function statusLabel(status: unknown): string {
  return typeof status === 'number' ? (STATUS_LABELS[status] ?? `unknown_${status}`) : 'unknown';
}

function statusOf(campaign: InstantlyCampaign): string {
  return statusLabel(campaign.status);
}

function daysObject(days: string[]): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const day of DAY_ORDER) {
    result[String(DAY_ORDER.indexOf(day))] = days.includes(day);
  }
  return result;
}

export function buildCreateCampaignBody(spec: CampaignSpec): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: spec.name,
    campaign_schedule: {
      schedules: [
        {
          name: 'Default',
          timing: { from: hour(spec.schedule.start_hour), to: hour(spec.schedule.end_hour) },
          days: daysObject(spec.schedule.days),
          timezone: spec.schedule.timezone,
        },
      ],
    },
    sequences: [
      {
        steps: spec.steps.map((step, index) => ({
          type: 'email',
          delay: index === 0 ? 0 : step.delay_days,
          delay_unit: 'days',
          variants: [{ subject: step.subject, body: step.body }],
        })),
      },
    ],
  };
  if (spec.sending_accounts?.length) body.email_list = spec.sending_accounts;
  if (typeof spec.daily_limit === 'number') body.daily_limit = spec.daily_limit;
  return body;
}

function toLead(lead: LeadInput): Record<string, unknown> {
  const mapped: Record<string, unknown> = { email: lead.email };
  if (lead.first_name) mapped.first_name = lead.first_name;
  if (lead.last_name) mapped.last_name = lead.last_name;
  if (lead.company_name) mapped.company_name = lead.company_name;
  if (lead.custom_variables && Object.keys(lead.custom_variables).length > 0) {
    mapped.custom_variables = lead.custom_variables;
  }
  return mapped;
}

export function createInstantlyProvider(deps: InstantlyDeps): CampaignSender {
  const headers = { authorization: `Bearer ${deps.apiKey}` };

  const call = async <T>(
    method: string,
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> =>
    deps.http.request<T>({
      provider: 'instantly',
      method,
      url: `${BASE_URL}${path}`,
      headers,
      ...(options.body !== undefined ? { body: options.body } : {}),
      ...(options.query ? { query: options.query } : {}),
      idempotent: method === 'GET',
    });

  return {
    name: 'instantly',

    estimateCost(capability: Capability): number {
      void capability;
      return 0;
    },

    async listCampaigns(): Promise<CampaignRef[]> {
      const response = await call<InstantlyCampaignList>('GET', '/campaigns', {
        query: { limit: 100 },
      });
      const items = response.items ?? response.campaigns ?? response.data ?? [];
      return items.map((campaign) => ({
        id: campaign.id,
        name: campaign.name ?? '',
        status: statusOf(campaign),
      }));
    },

    async getCampaign(campaignId: string): Promise<CampaignRef | null> {
      try {
        const campaign = await call<InstantlyCampaign>(
          'GET',
          `/campaigns/${encodeURIComponent(campaignId)}`,
        );
        if (!campaign || typeof campaign.id !== 'string') return null;
        return { id: campaign.id, name: campaign.name ?? '', status: statusOf(campaign) };
      } catch (error) {
        if (error instanceof OpenSdrError && error.code === 'NOT_FOUND') return null;
        throw error;
      }
    },

    async createCampaign(spec: CampaignSpec): Promise<CampaignRef> {
      const response = await call<InstantlyCampaign>('POST', '/campaigns', {
        body: buildCreateCampaignBody(spec),
      });
      return { id: response.id, name: response.name ?? spec.name, status: statusOf(response) };
    },

    async addLeads(campaignId: string, leads: LeadInput[]): Promise<AddLeadsResult> {
      const response = await call<InstantlyAddLeadsResponse>('POST', '/leads/add', {
        body: { campaign_id: campaignId, leads: leads.map(toLead) },
      });
      const skipped =
        (response.skipped_count ?? 0) +
        (response.duplicated_leads ?? 0) +
        (response.invalid_email_count ?? 0) +
        (response.in_blocklist ?? 0) +
        (response.duplicate_email_count ?? 0) +
        (response.incomplete_count ?? 0);
      const createdEmails = (response.created_leads ?? [])
        .map((lead) => lead.email)
        .filter((email): email is string => typeof email === 'string' && email !== '');
      return {
        added: response.leads_uploaded ?? createdEmails.length,
        skipped,
        failed: [],
        created_emails: createdEmails,
      };
    },
  };
}
