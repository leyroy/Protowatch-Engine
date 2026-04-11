import type { DiagEvidence } from '../types';

/** Maximum age of a DIAG event (ms) before it is dropped from the window */
const MAX_DIAG_AGE_MS = 30_000;

/**
 * Maintains a rolling window of DIAG evidence and merges it with incoming
 * cellular snapshots for use by the threat rules.
 *
 * Evidence older than `MAX_DIAG_AGE_MS` is automatically evicted on each
 * merge call to keep memory usage bounded.
 */
export class DiagIngestion {
  private window: DiagEvidence[] = [];

  /**
   * Add a new piece of DIAG evidence to the rolling window.
   */
  ingest(evidence: DiagEvidence): void {
    this.window.push(evidence);
  }

  /**
   * Return all DIAG evidence still within the freshness window relative to
   * `referenceTimestamp` (defaults to `Date.now()`).
   *
   * Stale entries are evicted before returning.
   */
  getFresh(referenceTimestamp?: number): DiagEvidence[] {
    const now = referenceTimestamp ?? Date.now();
    this.evict(now);
    return [...this.window];
  }

  /**
   * Return DIAG evidence of a specific type within the freshness window.
   */
  getFreshByType(
    type: DiagEvidence['type'],
    referenceTimestamp?: number,
  ): DiagEvidence[] {
    return this.getFresh(referenceTimestamp).filter((e) => e.type === type);
  }

  /**
   * Clear all stored evidence.
   */
  clear(): void {
    this.window = [];
  }

  /** Number of evidence items currently in the window */
  get size(): number {
    return this.window.length;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private evict(now: number): void {
    this.window = this.window.filter((e) => now - e.timestamp <= MAX_DIAG_AGE_MS);
  }
}
