import type { CellSnapshot, DiagEvidence, ThreatType, AlertSeverity } from '../types';
import type { BaselineTracker } from './BaselineTracker';

/** Result produced when a rule fires */
export interface RuleMatch {
  type: ThreatType;
  severity: AlertSeverity;
  evidence: Record<string, unknown>;
}

/**
 * Evaluates all threat rules against the current cell snapshot and
 * accumulated DIAG evidence.
 *
 * Each exported `evaluate*` function represents one discrete rule.
 * `evaluateAll` runs them in sequence and returns every match.
 */
export class ThreatRules {
  private readonly minBaselineObs: number;
  private readonly tracker: BaselineTracker;

  constructor(tracker: BaselineTracker, minBaselineObservations = 3) {
    this.tracker = tracker;
    this.minBaselineObs = minBaselineObservations;
  }

  /**
   * Run all rules and return every match (may be empty).
   */
  evaluateAll(snapshot: CellSnapshot, diagEvidence: DiagEvidence[]): RuleMatch[] {
    const matches: RuleMatch[] = [];

    const push = (m: RuleMatch | null) => {
      if (m) matches.push(m);
    };

    push(this.evaluateAkaBypass(snapshot, diagEvidence));
    push(this.evaluateImsiExposure(snapshot, diagEvidence));
    push(this.evaluateNullCipher(snapshot, diagEvidence));
    push(this.evaluateDowngrade(snapshot, diagEvidence));
    push(this.evaluatePrivacyLeak(snapshot, diagEvidence));
    push(this.evaluateRogueTower(snapshot, diagEvidence));

    return matches;
  }

  // ── Rule 1: AKA Bypass ────────────────────────────────────────────────────
  /**
   * Fires when DIAG evidence shows the authentication-and-key-agreement
   * (AKA) procedure was skipped, bypassed, or returned an unexpected
   * AUTS/RES value.
   */
  evaluateAkaBypass(snapshot: CellSnapshot, diagEvidence: DiagEvidence[]): RuleMatch | null {
    const match = diagEvidence.find((e) => e.type === 'AKA_BYPASS');
    if (!match) return null;

    return {
      type: 'AKA_BYPASS',
      severity: 'critical',
      evidence: {
        cellId: snapshot.cellId,
        diagDetails: match.details,
        diagTimestamp: match.timestamp,
      },
    };
  }

  // ── Rule 2: IMSI Exposure ─────────────────────────────────────────────────
  /**
   * Fires when the device transmitted its IMSI in clear text (Identity
   * Request → IMSI Response without subsequent encryption setup) as
   * recorded in DIAG or when an Identity Request is observed on a cell
   * without active encryption.
   */
  evaluateImsiExposure(snapshot: CellSnapshot, diagEvidence: DiagEvidence[]): RuleMatch | null {
    const diagMatch = diagEvidence.find((e) => e.type === 'IMSI_EXPOSURE');
    const noEncryption = snapshot.encryptionActive === false;

    if (!diagMatch && !noEncryption) return null;

    return {
      type: 'IMSI_EXPOSURE',
      severity: diagMatch ? 'critical' : 'high',
      evidence: {
        cellId: snapshot.cellId,
        encryptionActive: snapshot.encryptionActive,
        diagDetails: diagMatch?.details,
        diagTimestamp: diagMatch?.timestamp,
      },
    };
  }

  // ── Rule 3: Null Cipher ───────────────────────────────────────────────────
  /**
   * Fires when the cipher algorithm negotiated is A5/0 (GSM), UEA0 (3G),
   * EEA0 (LTE), or NEA0 (5G) – all of which mean no encryption.
   */
  evaluateNullCipher(snapshot: CellSnapshot, diagEvidence: DiagEvidence[]): RuleMatch | null {
    const diagMatch = diagEvidence.find((e) => e.type === 'NULL_CIPHER');
    const nullAlgorithms = ['A5/0', 'UEA0', 'EEA0', 'NEA0'];
    const snapshotNullCipher =
      snapshot.cipherAlgorithm !== undefined &&
      nullAlgorithms.includes(snapshot.cipherAlgorithm.toUpperCase());

    if (!diagMatch && !snapshotNullCipher) return null;

    return {
      type: 'NULL_CIPHER',
      severity: 'critical',
      evidence: {
        cellId: snapshot.cellId,
        cipherAlgorithm: snapshot.cipherAlgorithm,
        diagDetails: diagMatch?.details,
        diagTimestamp: diagMatch?.timestamp,
      },
    };
  }

  // ── Rule 4: Downgrade ─────────────────────────────────────────────────────
  /**
   * Fires when the observed generation (RAT) drops below the established
   * baseline for this cell, or when a DIAG-level downgrade event is recorded.
   *
   * E.g. a tower that is normally 4G but is currently advertising as 2G.
   */
  evaluateDowngrade(snapshot: CellSnapshot, diagEvidence: DiagEvidence[]): RuleMatch | null {
    const diagMatch = diagEvidence.find((e) => e.type === 'DOWNGRADE');
    const baselineDowngrade =
      this.tracker.isEstablished(snapshot.cellId, this.minBaselineObs) &&
      this.tracker.isGenerationDowngrade(snapshot);

    if (!diagMatch && !baselineDowngrade) return null;

    const baseline = this.tracker.get(snapshot.cellId);
    return {
      type: 'DOWNGRADE',
      severity: 'high',
      evidence: {
        cellId: snapshot.cellId,
        currentGeneration: snapshot.generation,
        baselineGeneration: baseline?.generation,
        diagDetails: diagMatch?.details,
        diagTimestamp: diagMatch?.timestamp,
      },
    };
  }

  // ── Rule 5: Privacy Leak ──────────────────────────────────────────────────
  /**
   * Fires when DIAG evidence indicates a privacy-sensitive identifier
   * (IMEI, TMSI, GUTI) was exposed in clear text, or when suspicious
   * location-tracking patterns are observed.
   */
  evaluatePrivacyLeak(snapshot: CellSnapshot, diagEvidence: DiagEvidence[]): RuleMatch | null {
    const diagMatch = diagEvidence.find((e) => e.type === 'PRIVACY_LEAK');
    if (!diagMatch) return null;

    return {
      type: 'PRIVACY_LEAK',
      severity: 'high',
      evidence: {
        cellId: snapshot.cellId,
        diagDetails: diagMatch.details,
        diagTimestamp: diagMatch.timestamp,
      },
    };
  }

  // ── Rule 6: Rogue Tower ───────────────────────────────────────────────────
  /**
   * Fires when the PCI observed for this cell ID does not match any
   * previously seen PCI in the baseline (possible IMSI catcher / fake BTS),
   * or when a DIAG-level rogue tower event is recorded.
   */
  evaluateRogueTower(snapshot: CellSnapshot, diagEvidence: DiagEvidence[]): RuleMatch | null {
    const diagMatch = diagEvidence.find((e) => e.type === 'ROGUE_TOWER');
    const unknownPci =
      this.tracker.isEstablished(snapshot.cellId, this.minBaselineObs) &&
      this.tracker.isUnknownPci(snapshot);

    if (!diagMatch && !unknownPci) return null;

    const baseline = this.tracker.get(snapshot.cellId);
    return {
      type: 'ROGUE_TOWER',
      severity: 'critical',
      evidence: {
        cellId: snapshot.cellId,
        observedPci: snapshot.pci,
        knownPcis: baseline?.knownPcis,
        diagDetails: diagMatch?.details,
        diagTimestamp: diagMatch?.timestamp,
      },
    };
  }
}
