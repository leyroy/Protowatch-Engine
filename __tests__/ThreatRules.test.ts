import { ThreatRules } from '../src/engine/ThreatRules';
import { BaselineTracker } from '../src/engine/BaselineTracker';
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

function makeEvidence(type: DiagEvidence['type'], overrides: Partial<DiagEvidence> = {}): DiagEvidence {
  return { type, timestamp: Date.now(), details: {}, ...overrides };
}

function establishBaseline(tracker: BaselineTracker, snapshot: CellSnapshot, count = 3) {
  for (let i = 0; i < count; i++) tracker.update(snapshot);
}

describe('ThreatRules', () => {
  let tracker: BaselineTracker;
  let rules: ThreatRules;
  const MIN_OBS = 3;

  beforeEach(() => {
    tracker = new BaselineTracker();
    rules = new ThreatRules(tracker, MIN_OBS);
  });

  // ── AKA Bypass ────────────────────────────────────────────────────────────

  describe('evaluateAkaBypass', () => {
    test('fires on AKA_BYPASS diag evidence', () => {
      const snap = makeSnapshot();
      const evidence = [makeEvidence('AKA_BYPASS')];
      const match = rules.evaluateAkaBypass(snap, evidence);

      expect(match).not.toBeNull();
      expect(match!.type).toBe('AKA_BYPASS');
      expect(match!.severity).toBe('critical');
    });

    test('returns null without evidence', () => {
      expect(rules.evaluateAkaBypass(makeSnapshot(), [])).toBeNull();
    });
  });

  // ── IMSI Exposure ─────────────────────────────────────────────────────────

  describe('evaluateImsiExposure', () => {
    test('fires on IMSI_EXPOSURE diag evidence', () => {
      const match = rules.evaluateImsiExposure(makeSnapshot(), [makeEvidence('IMSI_EXPOSURE')]);
      expect(match).not.toBeNull();
      expect(match!.type).toBe('IMSI_EXPOSURE');
      expect(match!.severity).toBe('critical');
    });

    test('fires with high severity when encryptionActive is false (no diag)', () => {
      const snap = makeSnapshot({ encryptionActive: false });
      const match = rules.evaluateImsiExposure(snap, []);
      expect(match).not.toBeNull();
      expect(match!.severity).toBe('high');
    });

    test('returns null when encryption is active and no diag', () => {
      expect(rules.evaluateImsiExposure(makeSnapshot({ encryptionActive: true }), [])).toBeNull();
    });
  });

  // ── Null Cipher ───────────────────────────────────────────────────────────

  describe('evaluateNullCipher', () => {
    test('fires on NULL_CIPHER diag evidence', () => {
      const match = rules.evaluateNullCipher(makeSnapshot(), [makeEvidence('NULL_CIPHER')]);
      expect(match).not.toBeNull();
      expect(match!.type).toBe('NULL_CIPHER');
      expect(match!.severity).toBe('critical');
    });

    test.each(['A5/0', 'UEA0', 'EEA0', 'NEA0'])(
      'fires when cipherAlgorithm is %s',
      (algo) => {
        const snap = makeSnapshot({ cipherAlgorithm: algo });
        const match = rules.evaluateNullCipher(snap, []);
        expect(match).not.toBeNull();
        expect(match!.type).toBe('NULL_CIPHER');
      },
    );

    test('returns null for a strong cipher', () => {
      const snap = makeSnapshot({ cipherAlgorithm: 'EEA2' });
      expect(rules.evaluateNullCipher(snap, [])).toBeNull();
    });
  });

  // ── Downgrade ─────────────────────────────────────────────────────────────

  describe('evaluateDowngrade', () => {
    test('fires when baseline is 4G but snapshot is 2G', () => {
      const snap4g = makeSnapshot({ generation: '4G' });
      establishBaseline(tracker, snap4g, MIN_OBS);

      const snap2g = makeSnapshot({ generation: '2G' });
      const match = rules.evaluateDowngrade(snap2g, []);

      expect(match).not.toBeNull();
      expect(match!.type).toBe('DOWNGRADE');
      expect(match!.severity).toBe('high');
      expect(match!.evidence.baselineGeneration).toBe('4G');
      expect(match!.evidence.currentGeneration).toBe('2G');
    });

    test('fires on DOWNGRADE diag evidence without baseline', () => {
      const match = rules.evaluateDowngrade(makeSnapshot(), [makeEvidence('DOWNGRADE')]);
      expect(match).not.toBeNull();
      expect(match!.type).toBe('DOWNGRADE');
    });

    test('does not fire without enough baseline observations', () => {
      // Only 2 observations (below MIN_OBS=3)
      tracker.update(makeSnapshot({ generation: '4G' }));
      tracker.update(makeSnapshot({ generation: '4G' }));

      const match = rules.evaluateDowngrade(makeSnapshot({ generation: '2G' }), []);
      expect(match).toBeNull();
    });

    test('does not fire for same-generation snapshot', () => {
      const snap4g = makeSnapshot({ generation: '4G' });
      establishBaseline(tracker, snap4g, MIN_OBS);
      expect(rules.evaluateDowngrade(makeSnapshot({ generation: '4G' }), [])).toBeNull();
    });
  });

  // ── Privacy Leak ──────────────────────────────────────────────────────────

  describe('evaluatePrivacyLeak', () => {
    test('fires on PRIVACY_LEAK diag evidence', () => {
      const match = rules.evaluatePrivacyLeak(makeSnapshot(), [makeEvidence('PRIVACY_LEAK')]);
      expect(match).not.toBeNull();
      expect(match!.type).toBe('PRIVACY_LEAK');
      expect(match!.severity).toBe('high');
    });

    test('returns null without diag evidence', () => {
      expect(rules.evaluatePrivacyLeak(makeSnapshot(), [])).toBeNull();
    });
  });

  // ── Rogue Tower ───────────────────────────────────────────────────────────

  describe('evaluateRogueTower', () => {
    test('fires when an unknown PCI appears on a known cell', () => {
      const known = makeSnapshot({ pci: 100 });
      establishBaseline(tracker, known, MIN_OBS);

      const rogue = makeSnapshot({ pci: 999 });
      const match = rules.evaluateRogueTower(rogue, []);

      expect(match).not.toBeNull();
      expect(match!.type).toBe('ROGUE_TOWER');
      expect(match!.severity).toBe('critical');
      expect(match!.evidence.observedPci).toBe(999);
      expect(match!.evidence.knownPcis).toContain(100);
    });

    test('fires on ROGUE_TOWER diag evidence', () => {
      const match = rules.evaluateRogueTower(makeSnapshot(), [makeEvidence('ROGUE_TOWER')]);
      expect(match).not.toBeNull();
    });

    test('does not fire for a known PCI', () => {
      const known = makeSnapshot({ pci: 100 });
      establishBaseline(tracker, known, MIN_OBS);
      expect(rules.evaluateRogueTower(makeSnapshot({ pci: 100 }), [])).toBeNull();
    });
  });

  // ── evaluateAll ───────────────────────────────────────────────────────────

  describe('evaluateAll', () => {
    test('returns multiple matches when multiple rules fire', () => {
      const evidence: DiagEvidence[] = [
        makeEvidence('AKA_BYPASS'),
        makeEvidence('NULL_CIPHER'),
      ];
      const matches = rules.evaluateAll(makeSnapshot(), evidence);
      expect(matches.length).toBeGreaterThanOrEqual(2);
      const types = matches.map((m) => m.type);
      expect(types).toContain('AKA_BYPASS');
      expect(types).toContain('NULL_CIPHER');
    });

    test('returns empty array when no rules fire', () => {
      const snap = makeSnapshot({ encryptionActive: true, cipherAlgorithm: 'EEA2' });
      expect(rules.evaluateAll(snap, [])).toHaveLength(0);
    });
  });
});
