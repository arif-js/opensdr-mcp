import { describe, expect, it } from 'vitest';
import type { Registration } from '../../src/providers/registry.js';
import { testConfig, testContext } from '../helpers/context.js';
import { jsonOf, linkClient } from '../helpers/mcp.js';

interface StatusEnvelope {
  ok: boolean;
  data: {
    version: string;
    mode: string;
    read_only: boolean;
    data_dir: string;
    providers: { name: string; configured: boolean; capabilities: string[] }[];
    capabilities: Record<string, string | null>;
    session: { credits_used_estimate: number };
    limits: { max_credits_per_call: number; cache_ttl_days: number };
    compliance_notice: string;
  };
  meta: { demo: boolean };
  warnings: string[];
}

const apolloRegistration: Registration = {
  name: 'apollo',
  keys: ['apollo'],
  capabilities: ['peopleSearch', 'companySearch', 'personEnrich', 'companyEnrich'],
  create: () => ({
    name: 'apollo',
    peopleSearch: { name: 'apollo', searchPeople: async () => ({ items: [], next_cursor: null }) },
    companySearch: {
      name: 'apollo',
      searchCompanies: async () => ({ items: [], next_cursor: null }),
    },
    personEnrich: { name: 'apollo', matchPerson: async () => null },
    companyEnrich: { name: 'apollo', enrichCompany: async () => null },
  }),
};

describe('sdr_provider_status', () => {
  it('is listed with read-only annotations', async () => {
    const linked = await linkClient(testContext());
    try {
      const { tools } = await linked.client.listTools();
      const tool = tools.find((entry) => entry.name === 'sdr_provider_status');
      expect(tool).toBeDefined();
      expect(tool?.annotations?.readOnlyHint).toBe(true);
      expect(tool?.annotations?.openWorldHint).toBe(false);
      expect(tool?.description ?? '').toContain('Free and local');
    } finally {
      await linked.close();
    }
  });

  it('reports demo mode with zero keys', async () => {
    const linked = await linkClient(testContext());
    try {
      const envelope = jsonOf<StatusEnvelope>(
        await linked.client.callTool({ name: 'sdr_provider_status', arguments: {} }),
      );
      expect(envelope.ok).toBe(true);
      expect(envelope.data.mode).toBe('demo');
      expect(envelope.meta.demo).toBe(true);
      expect(envelope.data.capabilities.peopleSearch).toBe('demo');
      expect(envelope.data.providers).toEqual([
        { name: 'demo', configured: true, capabilities: expect.any(Array) },
      ]);
      expect(envelope.data.data_dir).toContain('opensdr');
    } finally {
      await linked.close();
    }
  });

  it('reports live mode with a fake apollo registration', async () => {
    const config = testConfig({ APOLLO_API_KEY: 'apollo-key-1234567890' });
    const linked = await linkClient(
      testContext({ config, deps: { registrations: [apolloRegistration] } }),
    );
    try {
      const envelope = jsonOf<StatusEnvelope>(
        await linked.client.callTool({ name: 'sdr_provider_status', arguments: {} }),
      );
      expect(envelope.data.mode).toBe('live');
      expect(envelope.data.capabilities.peopleSearch).toBe('apollo');
      expect(envelope.data.capabilities.webSignals).toBeNull();
    } finally {
      await linked.close();
    }
  });

  it('warns when demo is forced while keys are present', async () => {
    const config = testConfig({ APOLLO_API_KEY: 'apollo-key-1234567890', OPENSDR_DEMO: '1' });
    const linked = await linkClient(
      testContext({ config, deps: { registrations: [apolloRegistration] } }),
    );
    try {
      const envelope = jsonOf<StatusEnvelope>(
        await linked.client.callTool({ name: 'sdr_provider_status', arguments: {} }),
      );
      expect(envelope.data.mode).toBe('demo');
      expect(envelope.warnings[0]).toContain('OPENSDR_DEMO=1');
    } finally {
      await linked.close();
    }
  });

  it('reports the session credit estimate and limits', async () => {
    const linked = await linkClient(testContext({ creditsUsed: 3 }));
    try {
      const envelope = jsonOf<StatusEnvelope>(
        await linked.client.callTool({ name: 'sdr_provider_status', arguments: {} }),
      );
      expect(envelope.data.session.credits_used_estimate).toBe(3);
      expect(envelope.data.limits).toEqual({ max_credits_per_call: 25, cache_ttl_days: 30 });
    } finally {
      await linked.close();
    }
  });
});

describe('schema validation errors', () => {
  it('come back in the standard error envelope', async () => {
    const linked = await linkClient(testContext());
    try {
      const result = await linked.client.callTool({
        name: 'sdr_verify_email',
        arguments: { emails: Array(30).fill('a@b.example') },
      });
      expect(result.isError).toBe(true);
      const body = jsonOf<{ ok: boolean; error: { code: string; message: string } }>(result);
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('BAD_INPUT');
      expect(body.error.message).not.toMatch(/^MCP error/);
    } finally {
      await linked.close();
    }
  });
});
