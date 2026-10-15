import { describe, expect, it } from 'vitest';
import { budgetExceeded, createBudget } from '../../src/engine/budget.js';

describe('createBudget', () => {
  it('tracks spend and remaining', () => {
    const budget = createBudget(5);
    expect(budget.canSpend(5)).toBe(true);
    budget.spend(3, 'apollo');
    expect(budget.used).toBe(3);
    expect(budget.remaining()).toBe(2);
    expect(budget.canSpend(3)).toBe(false);
    expect(budget.spends).toEqual([{ provider: 'apollo', credits: 3 }]);
  });

  it('allows a zero-cost spend even at the limit', () => {
    const budget = createBudget(0);
    expect(budget.canSpend(0)).toBe(true);
    expect(budget.canSpend(1)).toBe(false);
  });

  it('builds a BUDGET_EXCEEDED error', () => {
    expect(budgetExceeded(3, 2)).toMatchObject({ code: 'BUDGET_EXCEEDED' });
  });
});
