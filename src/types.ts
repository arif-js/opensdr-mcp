import { z } from 'zod';

export const EmailStatus = z.enum(['verified', 'likely', 'accept_all', 'unknown', 'invalid']);
export type EmailStatus = z.infer<typeof EmailStatus>;

export const Seniority = z.enum([
  'owner',
  'founder',
  'c_suite',
  'partner',
  'vp',
  'head',
  'director',
  'manager',
  'senior',
  'entry',
  'intern',
]);
export type Seniority = z.infer<typeof Seniority>;

export const SignalType = z.enum([
  'funding',
  'hiring',
  'leadership_change',
  'product_launch',
  'acquisition',
  'tech_change',
  'other',
]);
export type SignalType = z.infer<typeof SignalType>;

export const SignalConfidence = z.enum(['high', 'medium', 'low']);
export type SignalConfidence = z.infer<typeof SignalConfidence>;

export const CompanyRef = z.object({
  id: z.string().optional(),
  domain: z.string().optional(),
  name: z.string().optional(),
});
export type CompanyRef = z.infer<typeof CompanyRef>;

export const Company = z.object({
  id: z.string(),
  domain: z.string().nullable().optional(),
  name: z.string(),
  industry: z.string().nullable().optional(),
  employee_count: z.number().int().nullable().optional(),
  employee_range: z.string().nullable().optional(),
  revenue_range: z.string().nullable().optional(),
  founded_year: z.number().int().nullable().optional(),
  hq_location: z.string().nullable().optional(),
  technologies: z.array(z.string()).default([]),
  funding: z
    .object({
      last_round_type: z.string().nullable().optional(),
      last_round_date: z.string().nullable().optional(),
      total_raised_usd: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  linkedin_url: z.string().nullable().optional(),
  sources: z.array(z.string()).default([]),
});
export type Company = z.infer<typeof Company>;

export const Person = z.object({
  id: z.string(),
  provider_ids: z.record(z.string(), z.string()).default({}),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  full_name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  seniority: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  company: CompanyRef.nullable().optional(),
  email: z.string().nullable().optional(),
  email_status: EmailStatus.nullable().optional(),
  email_confidence: z.number().nullable().optional(),
  phone: z.string().nullable().optional(),
  sources: z.array(z.string()).default([]),
  updated_at: z.string().optional(),
});
export type Person = z.infer<typeof Person>;

export const Signal = z.object({
  type: SignalType,
  title: z.string(),
  url: z.string(),
  published_at: z.string().nullable().optional(),
  excerpt: z.string().max(1500).optional(),
  confidence: SignalConfidence,
  matched_rule: z.string().optional(),
  source: z.string().optional(),
});
export type Signal = z.infer<typeof Signal>;

export const EmailCheck = z.object({
  email: z.string(),
  status: EmailStatus,
  confidence: z.number().min(0).max(100),
  checks: z
    .object({
      syntax: z.boolean().optional(),
      mx: z.boolean().optional(),
      disposable: z.boolean().optional(),
      role_based: z.boolean().optional(),
      provider_result: z.string().optional(),
    })
    .default({}),
  sources: z.array(z.string()).default([]),
});
export type EmailCheck = z.infer<typeof EmailCheck>;

export const ProspectStatus = z.enum([
  'new',
  'enriched',
  'queued',
  'contacted',
  'replied',
  'disqualified',
]);
export type ProspectStatus = z.infer<typeof ProspectStatus>;

export const Prospect = Person.extend({
  list: z.array(z.string()).default([]),
  status: ProspectStatus.default('new'),
  signals: z.array(Signal).default([]),
  notes: z.string().nullable().optional(),
  custom_fields: z.record(z.string(), z.string()).default({}),
  campaigns: z
    .array(
      z.object({
        provider: z.string(),
        campaign_id: z.string(),
        pushed_at: z.string(),
      }),
    )
    .default([]),
  crm: z
    .object({
      hubspot_id: z.string().nullable().optional(),
      synced_at: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type Prospect = z.infer<typeof Prospect>;
