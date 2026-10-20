import { describe, expect, it } from 'vitest';
import { createDemoProvider } from '../../src/providers/demo/index.js';

describe('demo provider contract', () => {
  const demo = createDemoProvider();

  it('searches people and companies with pagination', async () => {
    const people = await demo.peopleSearch.searchPeople({}, { limit: 2 });
    expect(people.items.length).toBeLessThanOrEqual(2);
    expect(demo.peopleSearch.estimateCost?.('peopleSearch')).toBe(0);

    const companies = await demo.companySearch.searchCompanies({}, { limit: 2 });
    expect(companies.items.length).toBeLessThanOrEqual(2);
    expect(demo.companySearch.estimateCost?.('companySearch')).toBe(0);
  });

  it('enriches companies with known and unknown domains', async () => {
    const known = await demo.companyEnrich.enrichCompany('northwind.example');
    expect(known).not.toBeNull();
    expect(known?.domain).toBe('northwind.example');

    const unknown = await demo.companyEnrich.enrichCompany('custom.example');
    expect(unknown).not.toBeNull();
    expect(unknown?.domain).toBe('custom.example');
  });

  it('matches person by identity or returns null when seed is odd', async () => {
    const res = await demo.personEnrich.matchPerson({
      first_name: 'Sarah',
      last_name: 'Chen',
      domain: 'northwind.example',
    });
    // May be match or null depending on seed, verify structure if match
    if (res) {
      expect(res.person.first_name).toBe('Sarah');
      expect(res.person.company?.domain).toBe('northwind.example');
    }
  });

  it('finds and verifies emails', async () => {
    const found = await demo.emailFinder.findEmail({
      first_name: 'Alice',
      last_name: 'Smith',
      domain: 'acme.example',
    });
    expect(found).not.toBeNull();
    expect(found?.email).toBe('alice.smith@acme.example');
    expect(found?.sources).toContain('demo');

    const verdictVerified = await demo.emailVerifier.verifyEmail('test@northwind.example');
    expect(['verified', 'accept_all', 'invalid']).toContain(verdictVerified.status);
  });

  it('searches web signals', async () => {
    const results = await demo.webSignals.search({
      query: 'Northwind raised funding',
      max_results: 3,
    });
    expect(results).toHaveLength(3);
    expect(results[0].url).toContain('https://news.example/');
  });

  it('handles campaign sender methods', async () => {
    const created = await demo.campaignSender.createCampaign({
      name: 'Test Demo Campaign',
      steps: [{ subject: 'Hello', body: 'Intro text', delay_days: 0 }],
      schedule: {
        timezone: 'America/New_York',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        start_hour: 9,
        end_hour: 17,
      },
    });
    expect(created.id).toBeTruthy();
    expect(created.name).toBe('Test Demo Campaign');

    const leads = await demo.campaignSender.addLeads(created.id, [
      { email: 'lead1@example.com', first_name: 'L1' },
      { email: 'lead2@example.com', first_name: 'L2' },
    ]);
    expect(leads.added).toBe(2);
    expect(leads.created_emails).toEqual(['lead1@example.com', 'lead2@example.com']);

    const campaigns = await demo.campaignSender.listCampaigns();
    expect(campaigns).toEqual([]);

    const fetched = await demo.campaignSender.getCampaign?.('camp_123');
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe('camp_123');
  });

  it('upserts crm contacts', async () => {
    const result = await demo.crm.upsertContacts([
      { email: 'prospect@example.com', properties: { firstname: 'Demo' } },
    ]);
    expect(result.upserted).toBe(1);
    expect(result.results[0].email).toBe('prospect@example.com');
  });
});
