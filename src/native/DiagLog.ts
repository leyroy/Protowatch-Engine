import { NativeModules, NativeEventEmitter, EmitterSubscription } from 'react-native';
import type { DiagEvidence } from '../types';

const { DiagLog: NativeDiagLog } = NativeModules;

/**
 * Thin wrapper around the native `DiagLog` module.
 *
 * The Kotlin side exposes:
 *   - `startIngestion()` / `stopIngestion()`
 *   - Event `onDiagEvidence` emitting `DiagEvidence` objects
 *   - Event `onDiagError` emitting `{ message: string }`
 */
export class DiagLogBridge {
  private emitter: NativeEventEmitter | null = null;

  /** True when the native DIAG module is present on device */
  get isAvailable(): boolean {
    return NativeDiagLog != null;
  }

  private getEmitter(): NativeEventEmitter {
    if (!this.emitter) {
      this.emitter = new NativeEventEmitter(NativeDiagLog);
    }
    return this.emitter;
  }

  /** Start DIAG log ingestion */
  startIngestion(): void {
    if (this.isAvailable) {
      NativeDiagLog.startIngestion();
    }
  }

  /** Stop DIAG log ingestion */
  stopIngestion(): void {
    if (this.isAvailable) {
      NativeDiagLog.stopIngestion();
    }
  }

  /**
   * Subscribe to parsed DIAG evidence events.
   * Returns a subscription handle that must be removed when no longer needed.
   */
  onEvidence(handler: (evidence: DiagEvidence) => void): EmitterSubscription | null {
    if (!this.isAvailable) return null;
    return this.getEmitter().addListener('onDiagEvidence', handler);
  }

  /**
   * Subscribe to DIAG ingestion errors.
   */
  onError(handler: (err: { message: string }) => void): EmitterSubscription | null {
    if (!this.isAvailable) return null;
    return this.getEmitter().addListener('onDiagError', handler);
  }
}

export const diagLogBridge = new DiagLogBridge();
