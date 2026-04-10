import * as VideoThumbnails from 'expo-video-thumbnails';
import { normalizeYawDeg } from './sectorCoverage';
import type { SweepTelemetryPoint, SweepFrame } from '@/src/types/tour';

const SWEEP_SECTOR_COUNT = 24;
const SWEEP_SECTOR_DEG = 360 / SWEEP_SECTOR_COUNT; // 15°

export { SWEEP_SECTOR_COUNT, SWEEP_SECTOR_DEG };

export function sweepSectorIndex(yawDeg: number): number {
  const y = normalizeYawDeg(yawDeg);
  let idx = Math.floor(y / SWEEP_SECTOR_DEG);
  if (idx >= SWEEP_SECTOR_COUNT) idx = SWEEP_SECTOR_COUNT - 1;
  if (idx < 0) idx = 0;
  return idx;
}

/**
 * Given a telemetry array, find the timestamps where each 15° sector
 * boundary is first crossed. Returns up to 24 timestamps (one per sector).
 */
export function pickSectorTimestamps(
  telemetry: SweepTelemetryPoint[],
): { atMs: number; yawDeg: number; sectorIndex: number }[] {
  if (telemetry.length === 0) return [];

  const sectorHit = new Map<number, { atMs: number; yawDeg: number }>();

  for (const point of telemetry) {
    const sector = sweepSectorIndex(point.yawDeg);
    if (!sectorHit.has(sector)) {
      // Pick the first time we enter each sector — closest to sector center is ideal
      sectorHit.set(sector, { atMs: point.atMs, yawDeg: point.yawDeg });
    } else {
      // If we have a point closer to the sector center, prefer it
      const existing = sectorHit.get(sector)!;
      const centerDeg = sector * SWEEP_SECTOR_DEG + SWEEP_SECTOR_DEG / 2;
      const existingDist = Math.abs(normalizeYawDeg(existing.yawDeg) - centerDeg);
      const newDist = Math.abs(normalizeYawDeg(point.yawDeg) - centerDeg);
      if (newDist < existingDist) {
        sectorHit.set(sector, { atMs: point.atMs, yawDeg: point.yawDeg });
      }
    }
  }

  const results: { atMs: number; yawDeg: number; sectorIndex: number }[] = [];
  for (let i = 0; i < SWEEP_SECTOR_COUNT; i++) {
    const hit = sectorHit.get(i);
    if (hit) {
      results.push({ atMs: hit.atMs, yawDeg: hit.yawDeg, sectorIndex: i });
    }
  }

  return results.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Compute total coverage in degrees from telemetry data.
 */
export function computeCoverageDeg(telemetry: SweepTelemetryPoint[]): number {
  if (telemetry.length < 2) return 0;

  const sectors = new Set<number>();
  for (const point of telemetry) {
    sectors.add(sweepSectorIndex(point.yawDeg));
  }
  return sectors.size * SWEEP_SECTOR_DEG;
}

/**
 * Compute average rotation speed in degrees per second from telemetry.
 */
export function computeAvgSpeed(telemetry: SweepTelemetryPoint[]): number {
  if (telemetry.length < 2) return 0;

  let totalDeg = 0;
  for (let i = 1; i < telemetry.length; i++) {
    const diff = Math.abs(normalizeYawDeg(telemetry[i].yawDeg) - normalizeYawDeg(telemetry[i - 1].yawDeg));
    totalDeg += Math.min(diff, 360 - diff);
  }

  const totalMs = telemetry[telemetry.length - 1].atMs - telemetry[0].atMs;
  if (totalMs <= 0) return 0;

  return totalDeg / (totalMs / 1000);
}

/**
 * Extract frames from a video at telemetry-guided timestamps.
 * Returns SweepFrame[] with quality initially set to 'good'.
 */
export async function extractSweepFrames(
  videoUri: string,
  telemetry: SweepTelemetryPoint[],
): Promise<SweepFrame[]> {
  const timestamps = pickSectorTimestamps(telemetry);
  if (timestamps.length === 0) return [];

  const frames: SweepFrame[] = [];
  let consecutiveFail = 0;

  for (const ts of timestamps) {
    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(videoUri, {
        time: ts.atMs,
        quality: 0.8,
      });

      // Find the telemetry point closest to this timestamp for pitch
      const closest = telemetry.reduce((best, p) =>
        Math.abs(p.atMs - ts.atMs) < Math.abs(best.atMs - ts.atMs) ? p : best,
      );

      frames.push({
        uri: thumb.uri,
        atMs: ts.atMs,
        yawDeg: ts.yawDeg,
        pitchDeg: closest.pitchDeg,
        quality: 'good',
        sectorIndex: ts.sectorIndex,
      });
      consecutiveFail = 0;
    } catch {
      consecutiveFail += 1;
      if (consecutiveFail >= 4 && frames.length > 0) break;
    }
  }

  return frames;
}

/**
 * Build a coverage mask for 24 sectors from sweep frames.
 */
export function buildSweepCoverageMask(frames: SweepFrame[]): boolean[] {
  const mask = Array(SWEEP_SECTOR_COUNT).fill(false);
  for (const frame of frames) {
    if (frame.sectorIndex >= 0 && frame.sectorIndex < SWEEP_SECTOR_COUNT) {
      mask[frame.sectorIndex] = true;
    }
  }
  return mask;
}

/**
 * Find gap arcs (contiguous uncovered sectors) wider than thresholdDeg.
 */
export function findGaps(
  frames: SweepFrame[],
  thresholdDeg: number = 30,
): { startDeg: number; endDeg: number; gapDeg: number }[] {
  const mask = buildSweepCoverageMask(frames);
  const gaps: { startDeg: number; endDeg: number; gapDeg: number }[] = [];

  let i = 0;
  while (i < SWEEP_SECTOR_COUNT) {
    if (!mask[i]) {
      const start = i;
      while (i < SWEEP_SECTOR_COUNT && !mask[i]) i++;
      const gapSectors = i - start;
      const gapDeg = gapSectors * SWEEP_SECTOR_DEG;
      if (gapDeg >= thresholdDeg) {
        gaps.push({
          startDeg: start * SWEEP_SECTOR_DEG,
          endDeg: i * SWEEP_SECTOR_DEG,
          gapDeg,
        });
      }
    } else {
      i++;
    }
  }

  return gaps;
}
