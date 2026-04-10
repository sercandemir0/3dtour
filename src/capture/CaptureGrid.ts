/**
 * CaptureGrid — generates a spherical grid of capture targets.
 *
 * The grid consists of horizontal rings at different pitch levels plus
 * single zenith/nadir caps. The number of targets per ring is determined
 * by the camera FOV and desired overlap ratio so that adjacent frames
 * share enough visual content for later stitching.
 */

export type RingName = 'horizon' | 'upper' | 'lower' | 'zenith' | 'nadir';

export interface CaptureTarget {
  id: number;
  yawDeg: number;
  pitchDeg: number;
  ring: RingName;
  required: boolean;
  toleranceDeg: number;
}

export interface GridConfig {
  /** Camera horizontal FOV in degrees (typically ~70 for phones). */
  cameraFovDeg: number;
  /** Desired overlap ratio between adjacent frames (0-1, e.g. 0.30). */
  overlapRatio: number;
  /** Whether zenith/nadir caps are required or optional. */
  capsRequired: boolean;
}

const DEFAULT_CONFIG: GridConfig = {
  cameraFovDeg: 70,
  overlapRatio: 0.30,
  capsRequired: false,
};

interface RingDef {
  name: RingName;
  pitchDeg: number;
  count: number;
  tolerance: number;
  required: boolean;
}

function effectiveFov(fov: number, overlap: number): number {
  return fov * (1 - overlap);
}

function ringCount(pitchDeg: number, effectiveStep: number): number {
  const circumference = 360 * Math.cos((pitchDeg * Math.PI) / 180);
  const n = Math.max(3, Math.ceil(circumference / effectiveStep));
  return n;
}

export function buildCaptureGrid(config: Partial<GridConfig> = {}): CaptureTarget[] {
  const cfg: GridConfig = { ...DEFAULT_CONFIG, ...config };
  const step = effectiveFov(cfg.cameraFovDeg, cfg.overlapRatio);

  const rings: RingDef[] = [
    {
      name: 'horizon',
      pitchDeg: 0,
      count: ringCount(0, step),
      tolerance: 12,
      required: true,
    },
    {
      name: 'upper',
      pitchDeg: 50,
      count: ringCount(50, step),
      tolerance: 15,
      required: true,
    },
    {
      name: 'lower',
      pitchDeg: -50,
      count: ringCount(-50, step),
      tolerance: 15,
      required: true,
    },
    {
      name: 'zenith',
      pitchDeg: 85,
      count: 1,
      tolerance: 20,
      required: cfg.capsRequired,
    },
    {
      name: 'nadir',
      pitchDeg: -85,
      count: 1,
      tolerance: 20,
      required: cfg.capsRequired,
    },
  ];

  const targets: CaptureTarget[] = [];
  let nextId = 0;

  for (const ring of rings) {
    const yawStep = 360 / ring.count;
    for (let i = 0; i < ring.count; i++) {
      targets.push({
        id: nextId++,
        yawDeg: normalizeAngle(i * yawStep),
        pitchDeg: ring.pitchDeg,
        ring: ring.name,
        required: ring.required,
        toleranceDeg: ring.tolerance,
      });
    }
  }

  return targets;
}

export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

export function angleDiff(a: number, b: number): number {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(d, 360 - d);
}

export function sphericalDistance(
  yaw1: number, pitch1: number,
  yaw2: number, pitch2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p1 = toRad(pitch1);
  const p2 = toRad(pitch2);
  const dY = toRad(yaw1 - yaw2);
  const cos = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dY);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

export function isTargetAligned(
  target: CaptureTarget,
  currentYaw: number,
  currentPitch: number,
): boolean {
  return sphericalDistance(target.yawDeg, target.pitchDeg, currentYaw, currentPitch) <= target.toleranceDeg;
}

/**
 * Find the nearest uncaptured target to the current orientation.
 * Prefers required targets over optional ones.
 */
export function findNearestTarget(
  targets: CaptureTarget[],
  completedIds: Set<number>,
  currentYaw: number,
  currentPitch: number,
): CaptureTarget | null {
  let bestRequired: CaptureTarget | null = null;
  let bestRequiredDist = Infinity;
  let bestOptional: CaptureTarget | null = null;
  let bestOptionalDist = Infinity;

  for (const t of targets) {
    if (completedIds.has(t.id)) continue;
    const dist = sphericalDistance(t.yawDeg, t.pitchDeg, currentYaw, currentPitch);
    if (t.required) {
      if (dist < bestRequiredDist) {
        bestRequired = t;
        bestRequiredDist = dist;
      }
    } else {
      if (dist < bestOptionalDist) {
        bestOptional = t;
        bestOptionalDist = dist;
      }
    }
  }

  return bestRequired ?? bestOptional ?? null;
}

export function getCompletionStats(
  targets: CaptureTarget[],
  completedIds: Set<number>,
): { completed: number; required: number; total: number; allRequiredDone: boolean } {
  const required = targets.filter((t) => t.required).length;
  const requiredDone = targets.filter((t) => t.required && completedIds.has(t.id)).length;
  return {
    completed: completedIds.size,
    required,
    total: targets.length,
    allRequiredDone: requiredDone >= required,
  };
}
