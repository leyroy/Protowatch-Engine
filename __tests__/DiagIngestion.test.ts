import { DiagIngestion } from '../src/engine/DiagIngestion';
import type { DiagEvidence } from '../src/types';

function makeEvidence(
  type: DiagEvidence['type'],
  timestamp: number,
): DiagEvidence {
  return { type, timestamp, details: { raw: 'test' } };
}

describe('DiagIngestion', () => {
  let ingestion: DiagIngestion;

  beforeEach(() => {
    ingestion = new DiagIngestion();
  });

  test('ingest adds evidence and increments size', () => {
    ingestion.ingest(makeEvidence('AKA_BYPASS', 1000));
    expect(ingestion.size).toBe(1);
  });

  test('getFresh returns all evidence within the window', () => {
    const now = Date.now();
    ingestion.ingest(makeEvidence('AKA_BYPASS', now - 10_000)); // 10 s ago – fresh
    ingestion.ingest(makeEvidence('NULL_CIPHER', now - 5_000));  // 5 s ago – fresh

    const fresh = ingestion.getFresh(now);
    expect(fresh).toHaveLength(2);
  });

  test('getFresh evicts stale evidence', () => {
    const now = Date.now();
    ingestion.ingest(makeEvidence('AKA_BYPASS', now - 35_000)); // 35 s ago – stale
    ingestion.ingest(makeEvidence('NULL_CIPHER', now - 5_000));  // 5 s ago – fresh

    const fresh = ingestion.getFresh(now);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].type).toBe('NULL_CIPHER');
  });

  test('getFreshByType filters by type', () => {
    const now = Date.now();
    ingestion.ingest(makeEvidence('AKA_BYPASS', now));
    ingestion.ingest(makeEvidence('NULL_CIPHER', now));

    const byType = ingestion.getFreshByType('AKA_BYPASS', now);
    expect(byType).toHaveLength(1);
    expect(byType[0].type).toBe('AKA_BYPASS');
  });

  test('clear removes all evidence', () => {
    ingestion.ingest(makeEvidence('AKA_BYPASS', Date.now()));
    ingestion.clear();
    expect(ingestion.size).toBe(0);
  });

  test('size reflects eviction after getFresh', () => {
    const now = Date.now();
    ingestion.ingest(makeEvidence('DOWNGRADE', now - 40_000)); // stale
    ingestion.ingest(makeEvidence('PRIVACY_LEAK', now - 1_000)); // fresh

    ingestion.getFresh(now); // triggers eviction
    expect(ingestion.size).toBe(1);
  });
});
