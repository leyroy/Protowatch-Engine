/**
 * Core types for the ProtoWatch Engine.
 */

/** Cellular generation family */
export type CellGeneration = '2G' | '3G' | '4G' | '5G';

/** Live radio snapshot emitted by the native Kotlin module */
export interface CellSnapshot {
  /** Unique cell identifier (string-encoded CID/NCI) */
  cellId: string;
  /** Mobile Country Code */
  mcc: string;
  /** Mobile Network Code */
  mnc: string;
  /** Radio access technology generation */
  generation: CellGeneration;
  /** Signal strength in dBm */
  signalStrength: number;
  /** Unix epoch milliseconds */
  timestamp: number;
  /** Location Area Code (2G/3G) */
  lac?: number;
  /** Tracking Area Code (4G/5G) */
  tac?: number;
  /** Physical Cell ID (4G/5G) */
  pci?: number;
  /** Absolute Radio Frequency Channel Number */
  arfcn?: number;
  /** Whether encryption is active on this cell */
  encryptionActive?: boolean;
  /** Cipher algorithm identifier (e.g. A5/0 = null cipher) */
  cipherAlgorithm?: string;
}

/** Evidence types that can be extracted from DIAG logs */
export type DiagEvidenceType =
  | 'AKA_BYPASS'
  | 'IMSI_EXPOSURE'
  | 'NULL_CIPHER'
  | 'DOWNGRADE'
  | 'PRIVACY_LEAK'
  | 'ROGUE_TOWER';

/** A single piece of protocol-level evidence from DIAG logs */
export interface DiagEvidence {
  /** Evidence category */
  type: DiagEvidenceType;
  /** Unix epoch milliseconds when the event was logged */
  timestamp: number;
  /** Raw details extracted from the DIAG frame */
  details: Record<string, unknown>;
}

/** Threat detection rule identifiers */
export type ThreatType =
  | 'AKA_BYPASS'
  | 'IMSI_EXPOSURE'
  | 'NULL_CIPHER'
  | 'DOWNGRADE'
  | 'PRIVACY_LEAK'
  | 'ROGUE_TOWER';

/** Alert severity level */
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

/** A deduplicated threat alert dispatched by the engine */
export interface ThreatAlert {
  /** Unique stable identifier (hash of type + cellId) */
  id: string;
  /** Which threat rule fired */
  type: ThreatType;
  /** Severity determined by the rule + evidence */
  severity: AlertSeverity;
  /** The cell that triggered the alert */
  cellId: string;
  /** When the alert was first raised (Unix ms) */
  timestamp: number;
  /** Aggregated evidence payload */
  evidence: Record<string, unknown>;
  /** Whether the alert has been acknowledged */
  acknowledged: boolean;
}

/**
 * Live safety state exposed by ProtoWatchMonitor.
 * - safe     : no active threats
 * - warning  : medium / low threats only
 * - critical : at least one high or critical threat
 * - offline  : native collection unavailable
 */
export type SafetyState = 'safe' | 'warning' | 'critical' | 'offline';

/** Behavioral baseline stored per tower */
export interface TowerBaseline {
  cellId: string;
  mcc: string;
  mnc: string;
  generation: CellGeneration;
  /** Running average signal strength */
  avgSignalStrength: number;
  /** Total number of observations */
  observationCount: number;
  /** First time we saw this tower */
  firstSeen: number;
  /** Most recent observation */
  lastSeen: number;
  /** Set of observed PCI values */
  knownPcis: number[];
  /** Set of observed ARFCN values */
  knownArfcns: number[];
}

/** Configuration for ProtoWatchMonitor */
export interface MonitorConfig {
  /** Poll interval for cellular snapshots in ms (default: 5 000) */
  pollIntervalMs?: number;
  /** Cooldown between push notifications for the same alert in ms (default: 60 000) */
  notificationCooldownMs?: number;
  /** Minimum observations before rogue-tower detection fires (default: 3) */
  minBaselineObservations?: number;
  /** Use simulated data instead of real native collection */
  simulatorMode?: boolean;
}
