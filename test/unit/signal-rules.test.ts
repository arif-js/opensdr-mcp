import { describe, expect, it } from 'vitest';
import {
  buildQueries,
  classify,
  dedupeSignals,
  sortSignals,
} from '../../src/engine/signal-rules.js';
import { canonicalUrl, sanitizeExcerpt } from '../../src/engine/text.js';
import type { Signal, SignalType } from '../../src/types.js';

const recent = new Date(Date.now() - 3 * 86400000).toISOString();
const older = new Date(Date.now() - 200 * 86400000).toISOString();
const windowStart = new Date(Date.now() - 90 * 86400000);

interface Fixture {
  label: string;
  title: string;
  excerpt?: string;
  url: string;
  published_at?: string | null;
  companyName: string;
  domain?: string;
  type: SignalType;
  expected: { matched: boolean; confidence?: string };
}

const COMPANY = 'Northwind Labs';
const DOMAIN = 'northwind.example';

const fixtures: Fixture[] = [
  {
    label: 'funding high (name + keyword + date)',
    title: 'Northwind Labs raises $25M Series B',
    url: `https://news.example/${DOMAIN}/a`,
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'funding',
    expected: { matched: true, confidence: 'high' },
  },
  {
    label: 'funding high (domain url)',
    title: 'Startup closes a funding round',
    url: `https://blog.${DOMAIN}/post`,
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'funding',
    expected: { matched: true, confidence: 'high' },
  },
  {
    label: 'funding medium (no date)',
    title: 'Northwind Labs raises again',
    url: 'https://news.example/x',
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'funding',
    expected: { matched: true, confidence: 'medium' },
  },
  {
    label: 'funding medium (outside window)',
    title: 'Northwind Labs raised seed funding',
    url: 'https://news.example/y',
    published_at: older,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'funding',
    expected: { matched: true, confidence: 'medium' },
  },
  {
    label: 'funding drop (no company)',
    title: 'Fintech startup raises Series A',
    url: 'https://news.example/z',
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'funding',
    expected: { matched: false },
  },
  {
    label: 'funding drop (no keyword)',
    title: 'Northwind Labs ships a dashboard',
    url: 'https://news.example/a2',
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'funding',
    expected: { matched: false },
  },
  {
    label: 'hiring high',
    title: 'Northwind Labs is hiring 20 engineers',
    url: `https://jobs.${DOMAIN}/careers`,
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'hiring',
    expected: { matched: true, confidence: 'high' },
  },
  {
    label: 'hiring medium',
    title: 'Northwind Labs has open roles in Austin',
    url: 'https://news.example/h1',
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'hiring',
    expected: { matched: true, confidence: 'medium' },
  },
  {
    label: 'hiring drop',
    title: 'We are hiring at a different firm',
    url: 'https://news.example/h2',
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'hiring',
    expected: { matched: false },
  },
  {
    label: 'leadership high',
    title: 'Northwind Labs appoints a new CTO',
    url: `https://${DOMAIN}/blog/leadership`,
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'leadership_change',
    expected: { matched: true, confidence: 'high' },
  },
  {
    label: 'leadership medium',
    title: 'Northwind Labs names new CFO',
    url: 'https://news.example/l1',
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'leadership_change',
    expected: { matched: true, confidence: 'medium' },
  },
  {
    label: 'leadership drop',
    title: 'Company names new CTO',
    url: 'https://news.example/l2',
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'leadership_change',
    expected: { matched: false },
  },
  {
    label: 'product high',
    title: 'Northwind Labs launches a new platform',
    url: `https://${DOMAIN}/product`,
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'product_launch',
    expected: { matched: true, confidence: 'high' },
  },
  {
    label: 'product medium',
    title: 'Northwind Labs unveils a feature',
    url: 'https://news.example/p1',
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'product_launch',
    expected: { matched: true, confidence: 'medium' },
  },
  {
    label: 'product drop',
    title: 'A vendor launches a platform',
    url: 'https://news.example/p2',
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'product_launch',
    expected: { matched: false },
  },
  {
    label: 'acquisition high',
    title: 'Northwind Labs acquires a smaller rival',
    url: `https://${DOMAIN}/news/merger`,
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'acquisition',
    expected: { matched: true, confidence: 'high' },
  },
  {
    label: 'acquisition medium',
    title: 'Northwind Labs in acquisition talks',
    url: 'https://news.example/aq1',
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'acquisition',
    expected: { matched: true, confidence: 'medium' },
  },
  {
    label: 'acquisition drop',
    title: 'Rival acquires a startup',
    url: 'https://news.example/aq2',
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'acquisition',
    expected: { matched: false },
  },
  {
    label: 'tech_change high',
    title: 'Northwind Labs migrates to a new cloud',
    url: `https://${DOMAIN}/engineering`,
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'tech_change',
    expected: { matched: true, confidence: 'high' },
  },
  {
    label: 'tech_change medium',
    title: 'Northwind Labs adopts a new stack',
    url: 'https://news.example/t1',
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'tech_change',
    expected: { matched: true, confidence: 'medium' },
  },
  {
    label: 'other high',
    title: 'Northwind Labs announces expansion',
    url: `https://${DOMAIN}/press`,
    published_at: recent,
    companyName: COMPANY,
    domain: DOMAIN,
    type: 'other',
    expected: { matched: true, confidence: 'high' },
  },
  {
    label: 'name only is capped at low',
    title: 'Northwind Labs raises a Series B',
    url: 'https://news.example/n1',
    published_at: recent,
    companyName: COMPANY,
    type: 'funding',
    expected: { matched: true, confidence: 'low' },
  },
  {
    label: 'name only without date is low',
    title: 'Northwind Labs is hiring',
    url: 'https://news.example/n2',
    companyName: COMPANY,
    type: 'hiring',
    expected: { matched: true, confidence: 'low' },
  },
  {
    label: 'name only without company match is dropped',
    title: 'Another company raises',
    url: 'https://news.example/n3',
    published_at: recent,
    companyName: COMPANY,
    type: 'funding',
    expected: { matched: false },
  },
];

describe('signal classification (labelled fixtures)', () => {
  let predicted = 0;
  let correct = 0;

  for (const fixture of fixtures) {
    it(fixture.label, () => {
      const result = classify(
        {
          title: fixture.title,
          excerpt: fixture.excerpt ?? fixture.title,
          url: fixture.url,
          published_at: fixture.published_at ?? null,
        },
        {
          companyName: fixture.companyName,
          ...(fixture.domain ? { domain: fixture.domain } : {}),
          type: fixture.type,
          windowStart,
        },
      );
      if (fixture.expected.matched) {
        expect(result, `expected a match for: ${fixture.label}`).not.toBeNull();
        expect(result?.confidence).toBe(fixture.expected.confidence);
        expect(result?.matched_rule.startsWith(`${fixture.type}:`)).toBe(true);
      } else {
        expect(result, `expected no match for: ${fixture.label}`).toBeNull();
      }
      if (result) predicted += 1;
      if (result && fixture.expected.matched) correct += 1;
    });
  }

  it('precision on the fixture set is at least 0.9', () => {
    expect(predicted).toBeGreaterThan(0);
    expect(correct / predicted).toBeGreaterThanOrEqual(0.9);
  });
});

describe('buildQueries', () => {
  it('injects the company name into each template', () => {
    const queries = buildQueries('Northwind Labs', ['funding', 'hiring']);
    expect(queries).toHaveLength(2);
    expect(queries[0].query).toContain('Northwind Labs');
    expect(queries[0].type).toBe('funding');
  });
});

describe('url dedupe and excerpt hygiene', () => {
  it('collapses UTM variants of the same URL', () => {
    const base = 'https://news.example/story';
    const signals: Signal[] = [
      {
        type: 'funding',
        title: 'A raises',
        url: `${base}?utm_source=x`,
        confidence: 'high',
        matched_rule: 'funding:raises',
      },
      {
        type: 'funding',
        title: 'A raises',
        url: `${base}?utm_source=y&utm_campaign=z`,
        confidence: 'medium',
        matched_rule: 'funding:raises',
      },
    ];
    expect(dedupeSignals(signals)).toHaveLength(1);
    expect(dedupeSignals(signals)[0].confidence).toBe('high');
  });

  it('canonicalises trailing slashes and host case', () => {
    expect(canonicalUrl('https://News.Example/Story/')).toBe('news.example/Story');
  });

  it('strips HTML and caps excerpts at 1500 chars', () => {
    const excerpt = sanitizeExcerpt(`<p>${'a'.repeat(2000)}</p><script>bad()</script>`);
    expect(excerpt.length).toBeLessThanOrEqual(1500);
    expect(excerpt).not.toContain('<');
  });

  it('sorts by confidence then date', () => {
    const sorted = sortSignals([
      { type: 'funding', title: 'b', url: 'u1', confidence: 'low', matched_rule: 'r' },
      { type: 'funding', title: 'a', url: 'u2', confidence: 'high', matched_rule: 'r' },
    ]);
    expect(sorted[0].confidence).toBe('high');
  });
});
