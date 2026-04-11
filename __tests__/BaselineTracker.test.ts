import { BaselineTracker } from '../src/engine/BaselineTracker';
import type { CellSnapshot } from '../src/types';

function makeSnapshot(
  overrides: Partial<CellSnapshot> = {},
): CellSnapshot {
  return {
    cellId: 'cell-1',
    mcc: '310',
    mnc: '260',
    generation: '4G',
    signalStrength: -85,
    timestamp: Date.now(),
    pci: 100,
    arfcn: 1000,
    ...overrides,
  };
}

describe('BaselineTracker', () => {
  let tracker: BaselineTracker;

  beforeEach(() => {
    tracker = new BaselineTracker();
  });

  test('creates a new baseline on first observation', () => {
    const snap = makeSnapshot();
    tracker.update(snap);

    const baseline = tracker.get('cell-1');
    expect(baseline).toBeDefined();
    expect(baseline!.observationCount).toBe(1);
    expect(baseline!.generation).toBe('4G');
    expect(baseline!.avgSignalStrength).toBe(-85);
    expect(baseline!.knownPcis).toEqual([100]);
    expect(baseline!.knownArfcns).toEqual([1000]);
  });

  test('updates running average signal strength', () => {
    tracker.update(makeSnapshot({ signalStrength: -80 }));
    tracker.update(makeSnapshot({ signalStrength: -90 }));

    const baseline = tracker.get('cell-1');
    expect(baseline!.observationCount).toBe(2);
    // average of -80 and -90 = -85
    expect(baseline!.avgSignalStrength).toBe(-85);
  });

  test('accumulates unique PCI values', () => {
    tracker.update(makeSnapshot({ pci: 100 }));
    tracker.update(makeSnapshot({ pci: 101 }));
    tracker.update(makeSnapshot({ pci: 100 })); // duplicate – should not be added

    const baseline = tracker.get('cell-1');
    expect(baseline!.knownPcis).toHaveLength(2);
    expect(baseline!.knownPcis).toContain(100);
    expect(baseline!.knownPcis).toContain(101);
  });

  test('isEstablished returns false below minimum observations', () => {
    tracker.update(makeSnapshot());
    tracker.update(makeSnapshot());

    expect(tracker.isEstablished('cell-1', 3)).toBe(false);
    tracker.update(makeSnapshot());
    expect(tracker.isEstablished('cell-1', 3)).toBe(true);
  });

  test('isGenerationDowngrade detects a downgrade', () => {
    // Establish baseline as 4G
    for (let i = 0; i < 3; i++) tracker.update(makeSnapshot({ generation: '4G' }));

    // Now observe 2G on same cell
    const downgraded = makeSnapshot({ generation: '2G' });
    expect(tracker.isGenerationDowngrade(downgraded)).toBe(true);
  });

  test('isGenerationDowngrade returns false for same or higher generation', () => {
    for (let i = 0; i < 3; i++) tracker.update(makeSnapshot({ generation: '4G' }));

    expect(tracker.isGenerationDowngrade(makeSnapshot({ generation: '4G' }))).toBe(false);
    expect(tracker.isGenerationDowngrade(makeSnapshot({ generation: '5G' }))).toBe(false);
  });

  test('isUnknownPci detects an unseen PCI', () => {
    for (let i = 0; i < 3; i++) tracker.update(makeSnapshot({ pci: 100 }));

    // A completely different PCI should be flagged
    expect(tracker.isUnknownPci(makeSnapshot({ pci: 999 }))).toBe(true);
    // A known PCI should not be flagged
    expect(tracker.isUnknownPci(makeSnapshot({ pci: 100 }))).toBe(false);
  });

  test('reset clears all baselines', () => {
    tracker.update(makeSnapshot());
    tracker.reset();

    expect(tracker.get('cell-1')).toBeUndefined();
    expect(tracker.getAll()).toHaveLength(0);
  });
});
