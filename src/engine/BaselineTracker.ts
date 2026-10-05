import type { CellSnapshot, TowerBaseline, CellGeneration } from '../types';

/**
 * Builds and maintains a behavioral baseline for each observed cell tower.
 *
 * A baseline captures the "normal" characteristics of a tower so that
 * anomalous changes (generation downgrade, PCI / ARFCN shifts) can be
 * detected by the threat rules.
 */
export class BaselineTracker {
  /** Map of cellId → TowerBaseline */
  private baselines = new Map<string, TowerBaseline>();

  /**
   * Ingest a new cell snapshot and update (or create) the baseline for
   * the corresponding tower.
   */
  update(snapshot: CellSnapshot): void {
    const existing = this.baselines.get(snapshot.cellId);

    if (!existing) {
      this.baselines.set(snapshot.cellId, {
        cellId: snapshot.cellId,
        mcc: snapshot.mcc,
        mnc: snapshot.mnc,
        generation: snapshot.generation,
        avgSignalStrength: snapshot.signalStrength,
        observationCount: 1,
        firstSeen: snapshot.timestamp,
        lastSeen: snapshot.timestamp,
        knownPcis: snapshot.pci !== undefined ? [snapshot.pci] : [],
        knownArfcns: snapshot.arfcn !== undefined ? [snapshot.arfcn] : [],
      });
      return;
    }

    // Incremental running average for signal strength
    const n = existing.observationCount + 1;
    existing.avgSignalStrength =
      (existing.avgSignalStrength * existing.observationCount + snapshot.signalStrength) / n;
    existing.observationCount = n;
    existing.lastSeen = snapshot.timestamp;

    // Track unique PCI values
    if (snapshot.pci !== undefined && !existing.knownPcis.includes(snapshot.pci)) {
      existing.knownPcis.push(snapshot.pci);
    }

    // Track unique ARFCN values
    if (snapshot.arfcn !== undefined && !existing.knownArfcns.includes(snapshot.arfcn)) {
      existing.knownArfcns.push(snapshot.arfcn);
    }
  }

  /**
   * Retrieve the current baseline for a given cell, or undefined if the
   * tower has never been seen before.
   */
  get(cellId: string): TowerBaseline | undefined {
    return this.baselines.get(cellId);
  }

  /**
   * Return all stored baselines.
   */
  getAll(): TowerBaseline[] {
    return Array.from(this.baselines.values());
  }

  /**
   * Return true if the tower has enough observations to be considered
   * "known" (i.e., the baseline is statistically meaningful).
   */
  isEstablished(cellId: string, minObservations: number): boolean {
    const baseline = this.baselines.get(cellId);
    return baseline !== undefined && baseline.observationCount >= minObservations;
  }

  /**
   * Detect whether the generation reported in a snapshot represents a
   * downgrade compared to the established baseline.
   *
   * Returns true when the baseline generation is strictly higher than the
   * snapshot generation (e.g., baseline=4G, snapshot=2G).
   */
  isGenerationDowngrade(snapshot: CellSnapshot): boolean {
    const baseline = this.baselines.get(snapshot.cellId);
    if (!baseline) return false;
    return generationRank(snapshot.generation) < generationRank(baseline.generation);
  }

  /**
   * Check whether the snapshot's PCI is entirely new compared to the
   * established baseline (potential rogue tower substitution).
   */
  isUnknownPci(snapshot: CellSnapshot): boolean {
    const baseline = this.baselines.get(snapshot.cellId);
    if (!baseline || snapshot.pci === undefined) return false;
    return baseline.knownPcis.length > 0 && !baseline.knownPcis.includes(snapshot.pci);
  }

  /** Clear all baselines */
  reset(): void {
    this.baselines.clear();
  }
}

/** Numeric rank for generation comparisons (higher = newer) */
function generationRank(gen: CellGeneration): number {
  const ranks: Record<CellGeneration, number> = { '2G': 1, '3G': 2, '4G': 3, '5G': 4 };
  return ranks[gen];
}
