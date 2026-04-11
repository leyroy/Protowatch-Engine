import { NativeModules, NativeEventEmitter, EmitterSubscription } from 'react-native';
import type { CellSnapshot } from '../types';

const { CellularTelemetry: NativeCellularTelemetry } = NativeModules;

/**
 * Thin wrapper around the native `CellularTelemetry` module.
 *
 * The Kotlin side exposes:
 *   - `startCollection()` / `stopCollection()`
 *   - Event `onCellSnapshot` emitting `CellSnapshot` objects
 *   - Event `onCollectionError` emitting `{ message: string }`
 */
export class CellularTelemetryBridge {
  private emitter: NativeEventEmitter | null = null;

  /** True when the native module is present on device */
  get isAvailable(): boolean {
    return NativeCellularTelemetry != null;
  }

  private getEmitter(): NativeEventEmitter {
    if (!this.emitter) {
      this.emitter = new NativeEventEmitter(NativeCellularTelemetry);
    }
    return this.emitter;
  }

  /** Start native cellular data collection */
  startCollection(): void {
    if (this.isAvailable) {
      NativeCellularTelemetry.startCollection();
    }
  }

  /** Stop native cellular data collection */
  stopCollection(): void {
    if (this.isAvailable) {
      NativeCellularTelemetry.stopCollection();
    }
  }

  /**
   * Subscribe to live cell snapshots from the native layer.
   * Returns a subscription handle that must be removed when no longer needed.
   */
  onSnapshot(handler: (snapshot: CellSnapshot) => void): EmitterSubscription | null {
    if (!this.isAvailable) return null;
    return this.getEmitter().addListener('onCellSnapshot', handler);
  }

  /**
   * Subscribe to collection errors from the native layer.
   */
  onError(handler: (err: { message: string }) => void): EmitterSubscription | null {
    if (!this.isAvailable) return null;
    return this.getEmitter().addListener('onCollectionError', handler);
  }
}

export const cellularTelemetryBridge = new CellularTelemetryBridge();
