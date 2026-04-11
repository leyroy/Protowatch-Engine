import type { ThreatAlert } from '../types';

/** Maps alert ID → last notification timestamp */
type CooldownMap = Map<string, number>;

/**
 * Sends critical-severity push notifications for threat alerts.
 *
 * A per-alert cooldown prevents the same alert from generating repeated
 * notifications within `cooldownMs` milliseconds.
 *
 * Actual notification delivery is delegated to a pluggable `send` function
 * so the service works with any RN notification library (e.g., notifee,
 * react-native-push-notification) without introducing a hard dependency.
 */
export class NotificationService {
  private readonly cooldownMs: number;
  private readonly cooldowns: CooldownMap = new Map();
  private readonly sendFn: (alert: ThreatAlert) => void | Promise<void>;

  /**
   * @param send        Function that dispatches a platform notification.
   * @param cooldownMs  Minimum interval between notifications for the same
   *                    alert ID (default: 60 000 ms).
   */
  constructor(
    send: (alert: ThreatAlert) => void | Promise<void>,
    cooldownMs = 60_000,
  ) {
    this.sendFn = send;
    this.cooldownMs = cooldownMs;
  }

  /**
   * Evaluate a batch of new/escalated alerts and send notifications for
   * those that pass the severity threshold and are not in cooldown.
   *
   * Only `high` and `critical` alerts trigger notifications by default.
   */
  async notify(alerts: ThreatAlert[], now = Date.now()): Promise<void> {
    for (const alert of alerts) {
      if (!this.isNotifiable(alert, now)) continue;
      this.cooldowns.set(alert.id, now);
      await this.sendFn(alert);
    }
  }

  /**
   * Return `true` when the alert should generate a notification:
   * - Severity is `high` or `critical`.
   * - The alert is not currently within its cooldown window.
   */
  isNotifiable(alert: ThreatAlert, now = Date.now()): boolean {
    if (alert.severity !== 'high' && alert.severity !== 'critical') return false;
    const last = this.cooldowns.get(alert.id);
    return last === undefined || now - last > this.cooldownMs;
  }

  /** Reset all cooldown timers (e.g., after app restart) */
  resetCooldowns(): void {
    this.cooldowns.clear();
  }
}
