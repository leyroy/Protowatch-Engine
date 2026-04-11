import { PermissionsAndroid, Platform } from 'react-native';

/** Permissions required for cellular telemetry collection */
const REQUIRED_PERMISSIONS = [
  PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
  PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
] as const;

export type PermissionStatus = 'granted' | 'denied' | 'never_ask_again';

export interface PermissionsResult {
  allGranted: boolean;
  results: Record<string, PermissionStatus>;
}

/**
 * Handles Android runtime permission requests for cellular telemetry.
 *
 * On non-Android platforms (e.g., iOS simulator or web) this module is a
 * no-op and always reports permissions as granted so the simulator path
 * can run without modification.
 */
export class PermissionsManager {
  /**
   * Request all permissions needed for cellular data collection.
   *
   * @returns `allGranted: true` when every required permission was granted.
   */
  async requestAll(): Promise<PermissionsResult> {
    if (Platform.OS !== 'android') {
      return this.buildGrantedResult();
    }

    const granted = await PermissionsAndroid.requestMultiple([...REQUIRED_PERMISSIONS]);

    const results: Record<string, PermissionStatus> = {};
    let allGranted = true;

    for (const [permission, status] of Object.entries(granted)) {
      const mapped = this.mapStatus(status);
      results[permission] = mapped;
      if (mapped !== 'granted') allGranted = false;
    }

    return { allGranted, results };
  }

  /**
   * Check current permission state without prompting the user.
   */
  async checkAll(): Promise<PermissionsResult> {
    if (Platform.OS !== 'android') {
      return this.buildGrantedResult();
    }

    const results: Record<string, PermissionStatus> = {};
    let allGranted = true;

    for (const permission of REQUIRED_PERMISSIONS) {
      const ok = await PermissionsAndroid.check(permission);
      results[permission] = ok ? 'granted' : 'denied';
      if (!ok) allGranted = false;
    }

    return { allGranted, results };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private mapStatus(status: string): PermissionStatus {
    switch (status) {
      case PermissionsAndroid.RESULTS.GRANTED:
        return 'granted';
      case PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN:
        return 'never_ask_again';
      default:
        return 'denied';
    }
  }

  private buildGrantedResult(): PermissionsResult {
    const results: Record<string, PermissionStatus> = {};
    for (const p of REQUIRED_PERMISSIONS) {
      results[p] = 'granted';
    }
    return { allGranted: true, results };
  }
}
