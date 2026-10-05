import type { CellSnapshot, DiagEvidence, ThreatAlert } from '../types';
import { BaselineTracker } from './BaselineTracker';
import { DiagIngestion } from './DiagIngestion';
import { ThreatRules } from './ThreatRules';
import { AlertManager } from './AlertManager';

export interface ThreatEngineOptions {
  /** Minimum baseline observations before rogue-tower / downgrade rules fire */
  minBaselineObservations?: number;
}

/**
 * Central orchestration pipeline for the ProtoWatch threat engine.
 *
 * Data flow:
 *   1. DIAG evidence arrives asynchronously via `ingestDiag()`.
 *   2. Cell snapshots arrive periodically via `processSnapshot()`.
 *   3. `processSnapshot` merges fresh DIAG evidence with the snapshot,
 *      updates the behavioral baseline, runs all threat rules, and
 *      forwards matches to the `AlertManager`.
 *   4. New / escalated alerts are returned to the caller for notification.
 */
export class ThreatEngine {
  readonly baseline: BaselineTracker;
  readonly diag: DiagIngestion;
  readonly rules: ThreatRules;
  readonly alertManager: AlertManager;

  constructor(options: ThreatEngineOptions = {}) {
    this.baseline = new BaselineTracker();
    this.diag = new DiagIngestion();
    this.rules = new ThreatRules(this.baseline, options.minBaselineObservations);
    this.alertManager = new AlertManager();
  }

  /**
   * Feed a DIAG evidence item into the rolling window.
   * Call this whenever the native DIAG module emits a new event.
   */
  ingestDiag(evidence: DiagEvidence): void {
    this.diag.ingest(evidence);
  }

  /**
   * Process a cellular snapshot:
   *   1. Update the behavioral baseline for this tower.
   *   2. Retrieve all fresh DIAG evidence up to now.
   *   3. Evaluate threat rules against the snapshot + evidence.
   *   4. Forward matches to AlertManager for deduplication.
   *
   * @returns New or escalated alerts produced in this cycle.
   */
  processSnapshot(snapshot: CellSnapshot): ThreatAlert[] {
    // 1. Merge DIAG evidence
    const freshDiag: DiagEvidence[] = this.diag.getFresh(snapshot.timestamp);

    // 2. Evaluate rules against the EXISTING baseline (before incorporating
    //    the new snapshot) so that anomaly detection compares the snapshot
    //    to previously established normal behaviour.
    const matches = this.rules.evaluateAll(snapshot, freshDiag);

    // 3. Update baseline with the new observation
    this.baseline.update(snapshot);

    // 4. Deduplicate via AlertManager
    return this.alertManager.process(snapshot.cellId, matches, snapshot.timestamp);
  }

  /** All current active alerts */
  get activeAlerts(): ThreatAlert[] {
    return this.alertManager.getAll();
  }

  /** Reset the entire engine state (baseline, DIAG window, alerts) */
  reset(): void {
    this.baseline.reset();
    this.diag.clear();
    this.alertManager.clear();
  }
}
