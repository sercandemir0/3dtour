import type { Scene } from '@/src/types/tour';

export const SECTOR_COUNT = 6;
export const SECTOR_DEG = 360 / SECTOR_COUNT;

/** Turkish labels for sectors 0..5 (relative to start heading). */
export const SECTOR_LABELS_TR = [
  'Ön',
  'Sağ-ön',
  'Sağ',
  'Arka',
  'Sol',
  'Sol-ön',
];

export function normalizeYawDeg(deg: number): number {
  let x = deg % 360;
  if (x < 0) x += 360;
  return x;
}

export function sectorIndexFromYaw(yawRelDeg: number): number {
  const y = normalizeYawDeg(yawRelDeg);
  let idx = Math.floor(y / SECTOR_DEG);
  if (idx >= SECTOR_COUNT) idx = SECTOR_COUNT - 1;
  if (idx < 0) idx = 0;
  return idx;
}

export function sectorCenterDeg(index: number): number {
  return normalizeYawDeg(index * SECTOR_DEG + SECTOR_DEG / 2);
}

/** Shortest difference between two headings in degrees. */
export function yawDiffDeg(a: number, b: number): number {
  const d = Math.abs(normalizeYawDeg(a) - normalizeYawDeg(b));
  return Math.min(d, 360 - d);
}

export function isYawAlignedToSector(yawRelDeg: number, sectorIndex: number, toleranceDeg = 28): boolean {
  return yawDiffDeg(yawRelDeg, sectorCenterDeg(sectorIndex)) <= toleranceDeg;
}

export function emptySectorMask(): boolean[] {
  return Array(SECTOR_COUNT).fill(false);
}

export function cloneMask(mask: boolean[]): boolean[] {
  return [...mask];
}

export function markSector(mask: boolean[], index: number): boolean[] {
  const next = cloneMask(mask);
  if (index >= 0 && index < SECTOR_COUNT) next[index] = true;
  return next;
}

export function mergeMasks(a: boolean[], b: boolean[]): boolean[] {
  return a.map((v, i) => v || !!b[i]);
}

export function filledSectorCount(mask: boolean[]): number {
  return mask.filter(Boolean).length;
}

export function isFullCoverage(mask: boolean[]): boolean {
  return mask.length === SECTOR_COUNT && mask.every(Boolean);
}

export function getCoverageSummary(scene: Scene): {
  hasGuidedData: boolean;
  filled: number;
  total: number;
  incomplete: boolean;
} {
  const mask = scene.coverage_sector_mask;
  if (!mask || mask.length !== SECTOR_COUNT) {
    return { hasGuidedData: false, filled: 0, total: SECTOR_COUNT, incomplete: false };
  }
  const filled = filledSectorCount(mask);
  if (filled === 0) {
    return { hasGuidedData: false, filled: 0, total: SECTOR_COUNT, incomplete: false };
  }
  return {
    hasGuidedData: true,
    filled,
    total: SECTOR_COUNT,
    incomplete: filled < SECTOR_COUNT,
  };
}

export function missingSectorLabels(mask: boolean[]): string[] {
  if (mask.length !== SECTOR_COUNT) return [];
  return mask
    .map((ok, i) => (!ok ? SECTOR_LABELS_TR[i] : null))
    .filter(Boolean) as string[];
}

/**
 * Map video frame timestamps to yaw samples; assign each frame to nearest sector.
 */
export function mapFramesToSectors(
  frames: { uri: string; timeMs: number }[],
  yawSamples: { atMs: number; yawRelDeg: number }[],
): { uri: string; timeMs: number; sectorIndex: number; yawDeg: number }[] {
  if (yawSamples.length === 0) {
    return [];
  }

  return frames.map((f) => {
    let best = yawSamples[0];
    let bestDt = Math.abs(f.timeMs - best.atMs);
    for (const s of yawSamples) {
      const dt = Math.abs(f.timeMs - s.atMs);
      if (dt < bestDt) {
        bestDt = dt;
        best = s;
      }
    }
    const sectorIndex = sectorIndexFromYaw(best.yawRelDeg);
    return { ...f, sectorIndex, yawDeg: normalizeYawDeg(best.yawRelDeg) };
  });
}
