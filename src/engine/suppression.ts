export interface SuppressionQuery {
  email?: string;
  domain?: string;
}

export interface SuppressionResult {
  suppressed: boolean;
  reason?: string;
}

/**
 * Suppression is owned by PRD 04's lead-management store. Until it lands, the
 * engine depends on this interface and tests use the no-op implementation.
 */
export interface SuppressionChecker {
  isSuppressed(query: SuppressionQuery): SuppressionResult | Promise<SuppressionResult>;
}

export const noopSuppression: SuppressionChecker = {
  isSuppressed: () => ({ suppressed: false }),
};
