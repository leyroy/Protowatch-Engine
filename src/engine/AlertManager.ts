import type { ThreatAlert, ThreatType, AlertSeverity } from '../types';
import type { RuleMatch } from './ThreatRules';

/** Stable ID derived from threat type and cell identifier */
function makeAlertId(type: ThreatType, cellId: string): string {
  return `${type}::${cellId}`;
}

/**
 * Manages the lifecycle of threat alerts:
 *
 * - Deduplicates alerts by `(type, cellId)` so the same threat on the same
 *   cell does not spam the consumer.
 * - Updates severity when a subsequent evaluation produces a higher level.
 * - Exposes the full alert list for persistence / UI consumption.
 */
export class AlertManager {
  private alerts = new Map<string, ThreatAlert>();

  /**
   * Process a list of rule matches from the current evaluation cycle.
   *
   * Returns an array of alerts that are **new or escalated** in this cycle
   * (suitable for triggering notifications).
   */
  process(cellId: string, matches: RuleMatch[], timestamp: number): ThreatAlert[] {
    const newOrEscalated: ThreatAlert[] = [];

    for (const match of matches) {
      const id = makeAlertId(match.type, cellId);
      const existing = this.alerts.get(id);

      if (!existing) {
        const alert: ThreatAlert = {
          id,
          type: match.type,
          severity: match.severity,
          cellId,
          timestamp,
          evidence: match.evidence,
          acknowledged: false,
        };
        this.alerts.set(id, alert);
        newOrEscalated.push(alert);
      } else if (severityRank(match.severity) > severityRank(existing.severity)) {
        // Escalate severity and refresh evidence
        existing.severity = match.severity;
        existing.evidence = match.evidence;
        existing.timestamp = timestamp;
        newOrEscalated.push({ ...existing });
      }
    }

    return newOrEscalated;
  }

  /** Retrieve a specific alert by its stable ID */
  get(id: string): ThreatAlert | undefined {
    return this.alerts.get(id);
  }

  /** All active alerts */
  getAll(): ThreatAlert[] {
    return Array.from(this.alerts.values());
  }

  /** Active alerts filtered to a minimum severity */
  getByMinSeverity(minSeverity: AlertSeverity): ThreatAlert[] {
    return this.getAll().filter(
      (a) => severityRank(a.severity) >= severityRank(minSeverity),
    );
  }

  /** Mark an alert as acknowledged */
  acknowledge(id: string): boolean {
    const alert = this.alerts.get(id);
    if (!alert) return false;
    alert.acknowledged = true;
    return true;
  }

  /** Remove a single alert */
  dismiss(id: string): boolean {
    return this.alerts.delete(id);
  }

  /** Clear all alerts */
  clear(): void {
    this.alerts.clear();
  }

  /** Total number of active alerts */
  get count(): number {
    return this.alerts.size;
  }
}

/** Numeric rank for severity comparisons (higher = more severe) */
function severityRank(s: AlertSeverity): number {
  const ranks: Record<AlertSeverity, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  return ranks[s];
}
