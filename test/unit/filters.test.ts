import { describe, expect, it } from 'vitest';
import { filterKinds, lookupFilters, resolveRevenueRange } from '../../src/engine/filters.js';

describe('lookupFilters', () => {
  it('finds "VP Engineering" for "vp eng"', () => {
    const values = lookupFilters('title', 'vp eng');
    expect(values.map((value) => value.value)).toContain('VP Engineering');
  });

  it('returns the exact Apollo seniority enum', () => {
    const values = lookupFilters('seniority');
    expect(values.map((value) => value.value)).toEqual([
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
  });

  it('matches employee ranges by substring', () => {
    const values = lookupFilters('employee_range', '51');
    expect(values.map((value) => value.value)).toContain('51,200');
  });

  it('returns the first `limit` values when no query is given', () => {
    expect(lookupFilters('seniority', undefined, 3)).toHaveLength(3);
  });

  it('returns an empty array for a non-matching query', () => {
    expect(lookupFilters('title', 'zzzzzzzz')).toEqual([]);
  });

  it('exposes all six kinds', () => {
    expect(filterKinds().sort()).toEqual(
      ['department', 'employee_range', 'industry', 'revenue_range', 'seniority', 'title'].sort(),
    );
  });
});

describe('resolveRevenueRange', () => {
  it('resolves a bucket label to min/max', () => {
    expect(resolveRevenueRange('$1M-$10M')).toEqual({ min: 1000000, max: 10000000 });
  });

  it('resolves by value', () => {
    expect(resolveRevenueRange('over-1b')).toEqual({ min: 1000000000 });
  });

  it('returns null for an unknown bucket', () => {
    expect(resolveRevenueRange('$3B-$5B')).toBeNull();
  });
});
