import { ThreatEngine } from '../src/engine/ThreatEngine';
import type { CellSnapshot, DiagEvidence } from '../src/types';

function makeSnapshot(overrides: Partial<CellSnapshot> = {}): CellSnapshot {
  return {
    cellId: 'cell-1',
    mcc: '310',
    mnc: '260',
    generation: '4G',
    signalStrength: -85,
    timestamp: Date.now(),
    pci: 100,
    arfcn: 1000,
    encryptionActive: true,
    cipherAlgorithm: 'EEA2',
    ...overrides,
  };
}

function makeEvidence(
  type: DiagEvidence['type'],
  tsOffset = 0,
): DiagEvidence {
  return { type, timestamp: Date.now() + tsOffset, details: {} };
}

describe('ThreatEngine', () => {
  let engine: ThreatEngine;

  beforeEach(() => {
    engine = new ThreatEngine({ minBaselineObservations: 3 });
  });

  test('ingestDiag adds evidence to the DIAG window', () => {
    engine.ingestDiag(makeEvidence('AKA_BYPASS'));
    expect(engine.diag.size).toBe(1);
  });

  test('processSnapshot updates the baseline', () => {
    const snap = makeSnapshot();
    engine.processSnapshot(snap);
    expect(engine.baseline.get('cell-1')).toBeDefined();
  });

  test('processSnapshot fires alert when AKA_BYPASS diag evidence is present', () => {
    engine.ingestDiag(makeEvidence('AKA_BYPASS'));
    const snap = makeSnapshot();
    const alerts = engine.processSnapshot(snap);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('AKA_BYPASS');
    expect(alerts[0].severity).toBe('critical');
  });

  test('processSnapshot fires null-cipher alert for A5/0', () => {
    const snap = makeSnapshot({ cipherAlgorithm: 'A5/0' });
    const alerts = engine.processSnapshot(snap);

    expect(alerts.some((a) => a.type === 'NULL_CIPHER')).toBe(true);
  });

  test('processSnapshot fires downgrade alert after baseline established', () => {
    // Establish 4G baseline
    const snap4g = makeSnapshot({ generation: '4G' });
    for (let i = 0; i < 3; i++) {
      engine.processSnapshot({ ...snap4g, timestamp: Date.now() + i });
    }

    // Observe 2G on the same cell
    const alerts = engine.processSnapshot(makeSnapshot({ generation: '2G' }));
    expect(alerts.some((a) => a.type === 'DOWNGRADE')).toBe(true);
  });

  test('processSnapshot fires rogue-tower alert after baseline established', () => {
    const knownSnap = makeSnapshot({ pci: 100 });
    for (let i = 0; i < 3; i++) {
      engine.processSnapshot({ ...knownSnap, timestamp: Date.now() + i });
    }

    const rogueSnap = makeSnapshot({ pci: 999 });
    const alerts = engine.processSnapshot(rogueSnap);
    expect(alerts.some((a) => a.type === 'ROGUE_TOWER')).toBe(true);
  });

  test('deduplicates alerts across multiple snapshots', () => {
    engine.ingestDiag(makeEvidence('AKA_BYPASS'));
    engine.processSnapshot(makeSnapshot());
    // Same evidence type + cell → second cycle should not produce a new alert
    engine.ingestDiag(makeEvidence('AKA_BYPASS'));
    const secondCycleAlerts = engine.processSnapshot(makeSnapshot());

    expect(secondCycleAlerts).toHaveLength(0);
    expect(engine.activeAlerts).toHaveLength(1);
  });

  test('reset clears all state', () => {
    engine.ingestDiag(makeEvidence('AKA_BYPASS'));
    engine.processSnapshot(makeSnapshot());

    engine.reset();
    expect(engine.activeAlerts).toHaveLength(0);
    expect(engine.diag.size).toBe(0);
    expect(engine.baseline.getAll()).toHaveLength(0);
  });

  test('activeAlerts reflects all current alerts', () => {
    engine.ingestDiag(makeEvidence('AKA_BYPASS'));
    engine.processSnapshot(makeSnapshot({ cipherAlgorithm: 'A5/0' }));

    const active = engine.activeAlerts;
    const types = active.map((a) => a.type);
    expect(types).toContain('AKA_BYPASS');
    expect(types).toContain('NULL_CIPHER');
  });
});
