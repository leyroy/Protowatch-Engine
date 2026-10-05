import AsyncStorage from '@react-native-async-storage/async-storage';
import type { EmitterSubscription } from 'react-native';
import type {
  CellSnapshot,
  DiagEvidence,
  ThreatAlert,
  SafetyState,
  MonitorConfig,
} from '../types';
import { ThreatEngine } from '../engine/ThreatEngine';
import { cellularTelemetryBridge } from '../native/CellularTelemetry';
import { diagLogBridge } from '../native/DiagLog';
import { PermissionsManager } from './PermissionsManager';
import { NotificationService } from './NotificationService';

const STORAGE_KEY = '@protowatch/alerts';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_NOTIFICATION_COOLDOWN_MS = 60_000;
const DEFAULT_MIN_BASELINE_OBSERVATIONS = 3;

/** Listener signature for safety-state changes */
export type SafetyStateListener = (state: SafetyState) => void;
/** Listener signature for new or escalated alerts */
export type AlertListener = (alert: ThreatAlert) => void;

/**
 * ProtoWatchMonitor – top-level orchestrator for the ProtoWatch Engine.
 *
 * Responsibilities:
 *  - Request and validate Android permissions.
 *  - Start native cellular telemetry and DIAG log collection.
 *  - Fall back to simulator mode when native modules are unavailable.
 *  - Feed snapshots and DIAG evidence through the ThreatEngine pipeline.
 *  - Persist alerts to AsyncStorage.
 *  - Send critical notifications with a per-alert cooldown.
 *  - Maintain and broadcast a live SafetyState.
 */
export class ProtoWatchMonitor {
  // ── Dependencies ──────────────────────────────────────────────────────────
  private readonly engine: ThreatEngine;
  private readonly permissions: PermissionsManager;
  private readonly notifications: NotificationService;
  private readonly config: Required<MonitorConfig>;

  // ── State ──────────────────────────────────────────────────────────────────
  private _safetyState: SafetyState = 'offline';
  private _running = false;
  private simulatorMode = false;
  private simulatorTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // ── Subscriptions ──────────────────────────────────────────────────────────
  private snapshotSub: EmitterSubscription | null = null;
  private snapshotErrorSub: EmitterSubscription | null = null;
  private diagSub: EmitterSubscription | null = null;
  private diagErrorSub: EmitterSubscription | null = null;

  // ── Listeners ──────────────────────────────────────────────────────────────
  private safetyListeners = new Set<SafetyStateListener>();
  private alertListeners = new Set<AlertListener>();

  constructor(
    config: MonitorConfig = {},
    notifySend?: (alert: ThreatAlert) => void | Promise<void>,
  ) {
    this.config = {
      pollIntervalMs: config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      notificationCooldownMs:
        config.notificationCooldownMs ?? DEFAULT_NOTIFICATION_COOLDOWN_MS,
      minBaselineObservations:
        config.minBaselineObservations ?? DEFAULT_MIN_BASELINE_OBSERVATIONS,
      simulatorMode: config.simulatorMode ?? false,
    };

    this.engine = new ThreatEngine({
      minBaselineObservations: this.config.minBaselineObservations,
    });

    this.permissions = new PermissionsManager();

    this.notifications = new NotificationService(
      notifySend ?? this.defaultNotifySend,
      this.config.notificationCooldownMs,
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Current safety state */
  get safetyState(): SafetyState {
    return this._safetyState;
  }

  /** Whether the monitor is actively running */
  get isRunning(): boolean {
    return this._running;
  }

  /** Whether the monitor is operating in simulator mode */
  get isSimulatorMode(): boolean {
    return this.simulatorMode;
  }

  /**
   * Start monitoring.
   *
   * 1. Requests Android permissions.
   * 2. Starts native modules if available.
   * 3. Falls back to simulator if native collection is unavailable.
   * 4. Loads persisted alerts from storage.
   */
  async start(): Promise<void> {
    if (this._running) return;
    this._running = true;

    await this.loadPersistedAlerts();

    const forceSimulator = this.config.simulatorMode;
    const nativeAvailable =
      !forceSimulator &&
      cellularTelemetryBridge.isAvailable;

    if (nativeAvailable) {
      const { allGranted } = await this.permissions.requestAll();

      if (allGranted) {
        this.startNativeCollection();
      } else {
        // Permissions denied – fall back to simulator
        this.startSimulator();
      }
    } else {
      this.startSimulator();
    }

    this.setSafetyState('safe');
  }

  /** Stop monitoring and clean up all resources */
  stop(): void {
    if (!this._running) return;
    this._running = false;

    // Stop native modules
    cellularTelemetryBridge.stopCollection();
    diagLogBridge.stopIngestion();

    // Remove native subscriptions
    this.snapshotSub?.remove();
    this.snapshotErrorSub?.remove();
    this.diagSub?.remove();
    this.diagErrorSub?.remove();
    this.snapshotSub = null;
    this.snapshotErrorSub = null;
    this.diagSub = null;
    this.diagErrorSub = null;

    // Stop timers
    if (this.simulatorTimer) {
      clearInterval(this.simulatorTimer);
      this.simulatorTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.setSafetyState('offline');
  }

  /** Register a listener for safety-state changes */
  onSafetyStateChange(listener: SafetyStateListener): () => void {
    this.safetyListeners.add(listener);
    return () => this.safetyListeners.delete(listener);
  }

  /** Register a listener for new / escalated alerts */
  onAlert(listener: AlertListener): () => void {
    this.alertListeners.add(listener);
    return () => this.alertListeners.delete(listener);
  }

  /** All currently active alerts */
  get activeAlerts(): ThreatAlert[] {
    return this.engine.activeAlerts;
  }

  /** Acknowledge an alert by ID */
  async acknowledgeAlert(id: string): Promise<void> {
    this.engine.alertManager.acknowledge(id);
    await this.persistAlerts();
  }

  /** Dismiss (remove) an alert by ID */
  async dismissAlert(id: string): Promise<void> {
    this.engine.alertManager.dismiss(id);
    await this.persistAlerts();
    this.recomputeSafetyState();
  }

  // ── Internal – native collection ──────────────────────────────────────────

  private startNativeCollection(): void {
    this.simulatorMode = false;

    this.snapshotSub = cellularTelemetryBridge.onSnapshot((snapshot) => {
      this.handleSnapshot(snapshot);
    });

    this.snapshotErrorSub = cellularTelemetryBridge.onError(() => {
      this.setSafetyState('offline');
    });

    if (diagLogBridge.isAvailable) {
      this.diagSub = diagLogBridge.onEvidence((evidence) => {
        this.handleDiagEvidence(evidence);
      });

      this.diagErrorSub = diagLogBridge.onError(() => {
        // DIAG errors are non-fatal; continue without protocol evidence
      });

      diagLogBridge.startIngestion();
    }

    cellularTelemetryBridge.startCollection();
  }

  // ── Internal – simulator mode ─────────────────────────────────────────────

  private startSimulator(): void {
    this.simulatorMode = true;
    this.simulatorTimer = setInterval(
      () => this.handleSnapshot(buildSimulatedSnapshot()),
      this.config.pollIntervalMs,
    );
  }

  // ── Internal – event handlers ─────────────────────────────────────────────

  private async handleSnapshot(snapshot: CellSnapshot): Promise<void> {
    const newAlerts = this.engine.processSnapshot(snapshot);

    if (newAlerts.length > 0) {
      await this.notifications.notify(newAlerts);
      await this.persistAlerts();

      for (const alert of newAlerts) {
        this.alertListeners.forEach((l) => l(alert));
      }
    }

    this.recomputeSafetyState();
  }

  private handleDiagEvidence(evidence: DiagEvidence): void {
    this.engine.ingestDiag(evidence);
  }

  // ── Internal – safety state ───────────────────────────────────────────────

  private recomputeSafetyState(): void {
    const alerts = this.engine.activeAlerts;

    let next: SafetyState = 'safe';

    for (const alert of alerts) {
      if (alert.severity === 'critical' || alert.severity === 'high') {
        next = 'critical';
        break;
      }
      if (alert.severity === 'medium' || alert.severity === 'low') {
        next = 'warning';
      }
    }

    this.setSafetyState(next);
  }

  private setSafetyState(state: SafetyState): void {
    if (state === this._safetyState) return;
    this._safetyState = state;
    this.safetyListeners.forEach((l) => l(state));
  }

  // ── Internal – persistence ────────────────────────────────────────────────

  private async persistAlerts(): Promise<void> {
    try {
      const json = JSON.stringify(this.engine.activeAlerts);
      await AsyncStorage.setItem(STORAGE_KEY, json);
    } catch {
      // Non-fatal: persistence failure should not crash the monitor
    }
  }

  private async loadPersistedAlerts(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const alerts: ThreatAlert[] = JSON.parse(raw);
      for (const alert of alerts) {
        // Re-hydrate into the alert manager (they will not be re-emitted)
        this.engine.alertManager.process(
          alert.cellId,
          [{ type: alert.type, severity: alert.severity, evidence: alert.evidence }],
          alert.timestamp,
        );
      }
    } catch {
      // Non-fatal: start with empty alert list if storage is corrupt
    }
  }

  // ── Internal – default notification sender ────────────────────────────────

  private readonly defaultNotifySend = (_alert: ThreatAlert): void => {
    // Default is a no-op; consumers supply a real implementation via the
    // constructor's second argument.
  };
}

// ── Simulator helpers ─────────────────────────────────────────────────────────

let _simCounter = 0;
const SIM_CELLS = ['310-260-12345', '310-260-67890', '234-30-99999'];
const SIM_GENERATIONS = ['4G', '4G', '4G', '3G'] as const;

function buildSimulatedSnapshot(): CellSnapshot {
  const idx = _simCounter++ % SIM_CELLS.length;
  const cellId = SIM_CELLS[idx];
  const [mcc, mnc] = cellId.split('-');
  return {
    cellId,
    mcc,
    mnc,
    generation: SIM_GENERATIONS[idx % SIM_GENERATIONS.length],
    signalStrength: -80 + Math.floor(Math.random() * 20),
    timestamp: Date.now(),
    pci: 100 + (idx * 7),
    arfcn: 1000 + (idx * 50),
    encryptionActive: true,
    cipherAlgorithm: 'EEA2',
  };
}
