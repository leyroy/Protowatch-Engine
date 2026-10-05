import { AlertManager } from '../src/engine/AlertManager';
import type { RuleMatch } from '../src/engine/ThreatRules';

function makeMatch(overrides: Partial<RuleMatch> = {}): RuleMatch {
  return {
    type: 'ROGUE_TOWER',
    severity: 'critical',
    evidence: { cellId: 'cell-1' },
    ...overrides,
  };
}

describe('AlertManager', () => {
  let manager: AlertManager;
  const TS = 1_000_000;

  beforeEach(() => {
    manager = new AlertManager();
  });

  test('creates a new alert on first match', () => {
    const newAlerts = manager.process('cell-1', [makeMatch()], TS);

    expect(newAlerts).toHaveLength(1);
    expect(newAlerts[0].type).toBe('ROGUE_TOWER');
    expect(newAlerts[0].cellId).toBe('cell-1');
    expect(newAlerts[0].acknowledged).toBe(false);
    expect(manager.count).toBe(1);
  });

  test('deduplicates identical matches', () => {
    manager.process('cell-1', [makeMatch()], TS);
    const second = manager.process('cell-1', [makeMatch()], TS + 1000);

    // Same (type, cellId) → not new, not escalated
    expect(second).toHaveLength(0);
    expect(manager.count).toBe(1);
  });

  test('escalates severity and returns the alert', () => {
    manager.process('cell-1', [makeMatch({ severity: 'high' })], TS);
    const escalated = manager.process('cell-1', [makeMatch({ severity: 'critical' })], TS + 1000);

    expect(escalated).toHaveLength(1);
    expect(escalated[0].severity).toBe('critical');
    expect(manager.getAll()[0].severity).toBe('critical');
  });

  test('does not escalate to a lower severity', () => {
    manager.process('cell-1', [makeMatch({ severity: 'critical' })], TS);
    const result = manager.process('cell-1', [makeMatch({ severity: 'high' })], TS + 1000);
    expect(result).toHaveLength(0);
    expect(manager.getAll()[0].severity).toBe('critical');
  });

  test('separate (type, cellId) pairs create separate alerts', () => {
    manager.process('cell-1', [makeMatch({ type: 'ROGUE_TOWER' })], TS);
    manager.process('cell-1', [makeMatch({ type: 'NULL_CIPHER' })], TS);

    expect(manager.count).toBe(2);
  });

  test('same type on different cells creates separate alerts', () => {
    manager.process('cell-1', [makeMatch()], TS);
    manager.process('cell-2', [makeMatch()], TS);

    expect(manager.count).toBe(2);
  });

  test('acknowledge marks alert as acknowledged', () => {
    manager.process('cell-1', [makeMatch()], TS);
    const id = manager.getAll()[0].id;

    const ok = manager.acknowledge(id);
    expect(ok).toBe(true);
    expect(manager.get(id)!.acknowledged).toBe(true);
  });

  test('acknowledge returns false for unknown id', () => {
    expect(manager.acknowledge('nonexistent')).toBe(false);
  });

  test('dismiss removes the alert', () => {
    manager.process('cell-1', [makeMatch()], TS);
    const id = manager.getAll()[0].id;

    expect(manager.dismiss(id)).toBe(true);
    expect(manager.count).toBe(0);
    expect(manager.get(id)).toBeUndefined();
  });

  test('getByMinSeverity filters correctly', () => {
    manager.process('cell-1', [makeMatch({ severity: 'low', type: 'PRIVACY_LEAK' })], TS);
    manager.process('cell-2', [makeMatch({ severity: 'critical', type: 'ROGUE_TOWER' })], TS);

    expect(manager.getByMinSeverity('high')).toHaveLength(1);
    expect(manager.getByMinSeverity('low')).toHaveLength(2);
    expect(manager.getByMinSeverity('critical')).toHaveLength(1);
  });

  test('clear removes all alerts', () => {
    manager.process('cell-1', [makeMatch()], TS);
    manager.clear();
    expect(manager.count).toBe(0);
  });
});
