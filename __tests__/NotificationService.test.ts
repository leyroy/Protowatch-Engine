import { NotificationService } from '../src/monitor/NotificationService';
import type { ThreatAlert } from '../src/types';

function makeAlert(overrides: Partial<ThreatAlert> = {}): ThreatAlert {
  return {
    id: 'ROGUE_TOWER::cell-1',
    type: 'ROGUE_TOWER',
    severity: 'critical',
    cellId: 'cell-1',
    timestamp: 1_000_000,
    evidence: {},
    acknowledged: false,
    ...overrides,
  };
}

describe('NotificationService', () => {
  let sendFn: jest.Mock;
  let service: NotificationService;
  const COOLDOWN = 60_000;
  const BASE_TIME = 1_700_000_000_000;

  beforeEach(() => {
    sendFn = jest.fn();
    service = new NotificationService(sendFn, COOLDOWN);
  });

  test('sends notification for critical alert', async () => {
    await service.notify([makeAlert({ severity: 'critical' })], BASE_TIME);
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  test('sends notification for high-severity alert', async () => {
    await service.notify([makeAlert({ severity: 'high' })], BASE_TIME);
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  test('does not send notification for medium-severity alert', async () => {
    await service.notify([makeAlert({ severity: 'medium' })], BASE_TIME);
    expect(sendFn).not.toHaveBeenCalled();
  });

  test('does not send notification for low-severity alert', async () => {
    await service.notify([makeAlert({ severity: 'low' })], BASE_TIME);
    expect(sendFn).not.toHaveBeenCalled();
  });

  test('respects cooldown: does not send within cooldown window', async () => {
    await service.notify([makeAlert()], BASE_TIME);
    // Second notification within cooldown window
    await service.notify([makeAlert()], BASE_TIME + COOLDOWN - 1);

    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  test('sends again after cooldown has elapsed', async () => {
    await service.notify([makeAlert()], BASE_TIME);
    await service.notify([makeAlert()], BASE_TIME + COOLDOWN + 1);

    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  test('cooldown is per-alert-id: different ids do not share cooldown', async () => {
    const alert1 = makeAlert({ id: 'ROGUE_TOWER::cell-1' });
    const alert2 = makeAlert({ id: 'ROGUE_TOWER::cell-2' });

    await service.notify([alert1], BASE_TIME);
    await service.notify([alert2], BASE_TIME); // different id → not in cooldown

    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  test('resetCooldowns allows re-notification immediately', async () => {
    await service.notify([makeAlert()], BASE_TIME);
    service.resetCooldowns();
    await service.notify([makeAlert()], BASE_TIME + 1); // well within original cooldown

    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  test('isNotifiable returns true for a fresh critical alert', () => {
    expect(service.isNotifiable(makeAlert({ severity: 'critical' }), BASE_TIME)).toBe(true);
  });

  test('isNotifiable returns false within cooldown', () => {
    service.isNotifiable(makeAlert(), BASE_TIME); // prime the check (doesn't set cooldown)
    // Manually trigger to set cooldown
    sendFn.mockImplementation(() => {});
    service.notify([makeAlert()], BASE_TIME);
    expect(service.isNotifiable(makeAlert(), BASE_TIME + 1)).toBe(false);
  });
});
