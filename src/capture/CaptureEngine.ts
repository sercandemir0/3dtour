/**
 * CaptureEngine — pure-logic state machine for the panorama capture flow.
 *
 * Phases: permission → leveling → calibration → capturing → review → done.
 *
 * The engine is framework-agnostic; the React component (GuidedCamera)
 * drives it via dispatched actions and reads its state for rendering.
 */
import type { CaptureTarget, GridConfig } from './CaptureGrid';
import {
  buildCaptureGrid,
  isTargetAligned,
  findNearestTarget,
  getCompletionStats,
  shortestYawDeltaDeg,
  sphericalDistance,
} from './CaptureGrid';
import type { Orientation } from './OrientationTracker';
import type { QualityReport } from './QualityGate';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface CaptureFrame {
  id: number;
  uri: string;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  timestamp: string;
  blurScore: number;
  brightnessAvg: number;
  validation: 'passed' | 'warning' | 'failed';
}

export interface CaptureSession {
  version: 2;
  gridConfig: {
    cameraFovDeg: number;
    overlapRatio: number;
    totalTargets: number;
  };
  frames: CaptureFrame[];
  completedTargetIds: number[];
  refQuaternion: [number, number, number, number];
  startedAt: string;
  finalizedAt: string | null;
  deviceInfo: {
    cameraFov: number;
    platform: string;
  };
}

export type Phase =
  | 'permission'
  | 'leveling'
  | 'calibration'
  | 'capturing'
  | 'review'
  | 'done';

export type CaptureSubPhase =
  | 'guiding'
  | 'stabilizing'
  | 'shutter'
  | 'validating';

export interface DirectionHint {
  yawDir: 'left' | 'right' | 'none';
  pitchDir: 'up' | 'down' | 'none';
  label: string;
  /** Degrees to turn: positive = target is to the right (turn right). */
  yawDeltaDeg: number;
  /** Degrees to tilt: positive = look up toward target. */
  pitchDeltaDeg: number;
}

export interface EngineState {
  phase: Phase;
  captureSubPhase: CaptureSubPhase;
  targets: CaptureTarget[];
  completedIds: Set<number>;
  frames: CaptureFrame[];
  currentTarget: CaptureTarget | null;
  aligned: boolean;
  stable: boolean;
  directionHint: DirectionHint;
  orientation: Orientation;
  sessionBrightness: number | null;
  manualShutter: boolean;
  gridConfig: GridConfig;
  /** Latest quality report (set after each shutter). */
  lastQualityReport: QualityReport | null;
  lastQualityIssueText: string | null;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const DEFAULT_GRID: GridConfig = {
  cameraFovDeg: 70,
  overlapRatio: 0.30,
  capsRequired: false,
};

export function createInitialState(gridConfig?: Partial<GridConfig>): EngineState {
  const cfg: GridConfig = { ...DEFAULT_GRID, ...gridConfig };
  const targets = buildCaptureGrid(cfg);
  return {
    phase: 'permission',
    captureSubPhase: 'guiding',
    targets,
    completedIds: new Set(),
    frames: [],
    currentTarget: null,
    aligned: false,
    stable: false,
    directionHint: { yawDir: 'none', pitchDir: 'none', label: '', yawDeltaDeg: 0, pitchDeltaDeg: 0 },
    orientation: { yawDeg: 0, pitchDeg: 0, rollDeg: 0, angularVelocityDegPerSec: 0, timestamp: 0 },
    sessionBrightness: null,
    manualShutter: false,
    gridConfig: cfg,
    lastQualityReport: null,
    lastQualityIssueText: null,
  };
}

// -- Transitions -------------------------------------------------------------

export function advanceToLeveling(state: EngineState): EngineState {
  return { ...state, phase: 'leveling' };
}

export function advanceToCalibration(state: EngineState): EngineState {
  return { ...state, phase: 'calibration' };
}

export function advanceToCapturing(state: EngineState): EngineState {
  const first = findNearestTarget(state.targets, state.completedIds, 0, 0);
  return {
    ...state,
    phase: 'capturing',
    captureSubPhase: 'guiding',
    currentTarget: first,
  };
}

export function advanceToReview(state: EngineState): EngineState {
  return { ...state, phase: 'review', currentTarget: null };
}

export function returnToCapturing(state: EngineState): EngineState {
  const next = findNearestTarget(
    state.targets,
    state.completedIds,
    state.orientation.yawDeg,
    state.orientation.pitchDeg,
  );
  return {
    ...state,
    phase: 'capturing',
    captureSubPhase: 'guiding',
    currentTarget: next,
    lastQualityReport: null,
    lastQualityIssueText: null,
  };
}

export function finalize(state: EngineState): EngineState {
  return { ...state, phase: 'done' };
}

// -- Orientation update (called ~12-16× per second) -------------------------

export function updateOrientation(state: EngineState, o: Orientation): EngineState {
  if (state.phase !== 'capturing') return { ...state, orientation: o };

  const { currentTarget, completedIds, targets } = state;

  const active = currentTarget ?? findNearestTarget(targets, completedIds, o.yawDeg, o.pitchDeg);
  const aligned = active ? isTargetAligned(active, o.yawDeg, o.pitchDeg) : false;
  const hint = active
    ? computeDirectionHint(active, o)
    : {
        yawDir: 'none' as const,
        pitchDir: 'none' as const,
        label: '',
        yawDeltaDeg: 0,
        pitchDeltaDeg: 0,
      };

  let subPhase = state.captureSubPhase;
  if (!aligned) {
    subPhase = 'guiding';
  } else if (subPhase === 'guiding') {
    subPhase = 'stabilizing';
  }

  return {
    ...state,
    orientation: o,
    currentTarget: active,
    aligned,
    stable: false, // will be set by stability check separately
    directionHint: hint,
    captureSubPhase: subPhase,
  };
}

export function markStable(state: EngineState, isStable: boolean): EngineState {
  return { ...state, stable: isStable };
}

// -- Shutter result ----------------------------------------------------------

export function recordFrame(
  state: EngineState,
  frame: CaptureFrame,
  report: QualityReport,
): EngineState {
  if (report.validation === 'failed') {
    return {
      ...state,
      captureSubPhase: 'guiding',
      lastQualityReport: report,
      lastQualityIssueText: report.issues.join('; '),
    };
  }

  const newCompleted = new Set(state.completedIds);
  newCompleted.add(frame.id);
  const newFrames = [...state.frames, frame];

  const avgBrightness =
    newFrames.reduce((s, f) => s + f.brightnessAvg, 0) / newFrames.length;

  const next = findNearestTarget(
    state.targets,
    newCompleted,
    state.orientation.yawDeg,
    state.orientation.pitchDeg,
  );

  const stats = getCompletionStats(state.targets, newCompleted);
  const autoReview = stats.allRequiredDone && next == null;

  return {
    ...state,
    completedIds: newCompleted,
    frames: newFrames,
    currentTarget: autoReview ? null : next,
    captureSubPhase: autoReview ? 'guiding' : 'guiding',
    phase: autoReview ? 'review' : 'capturing',
    sessionBrightness: avgBrightness,
    lastQualityReport: report,
    lastQualityIssueText: report.issues.length > 0 ? report.issues.join('; ') : null,
  };
}

export function toggleManualShutter(state: EngineState): EngineState {
  return { ...state, manualShutter: !state.manualShutter };
}

// -- Helpers -----------------------------------------------------------------

function computeDirectionHint(target: CaptureTarget, o: Orientation): DirectionHint {
  const yawDeltaDeg = shortestYawDeltaDeg(target.yawDeg, o.yawDeg);
  const pitchDeltaDeg = target.pitchDeg - o.pitchDeg;

  const aligned = isTargetAligned(target, o.yawDeg, o.pitchDeg);

  let yawDir: 'left' | 'right' | 'none' = 'none';
  if (Math.abs(yawDeltaDeg) > 4) {
    yawDir = yawDeltaDeg > 0 ? 'right' : 'left';
  }

  let pitchDir: 'up' | 'down' | 'none' = 'none';
  if (Math.abs(pitchDeltaDeg) > 4) {
    pitchDir = pitchDeltaDeg > 0 ? 'up' : 'down';
  }

  if (aligned) {
    return {
      yawDir: 'none',
      pitchDir: 'none',
      label: '',
      yawDeltaDeg,
      pitchDeltaDeg,
    };
  }

  const ay = Math.abs(yawDeltaDeg);
  const ap = Math.abs(pitchDeltaDeg);
  const sphereErr =
    target.ring === 'zenith' || target.ring === 'nadir'
      ? sphericalDistance(target.yawDeg, target.pitchDeg, o.yawDeg, o.pitchDeg)
      : null;

  const parts: string[] = [];
  if (yawDir === 'left') parts.push(`Sola ~${Math.round(ay)}°`);
  else if (yawDir === 'right') parts.push(`Sağa ~${Math.round(ay)}°`);

  if (pitchDir === 'up') parts.push(`Yukarı ~${Math.round(ap)}°`);
  else if (pitchDir === 'down') parts.push(`Aşağı ~${Math.round(ap)}°`);

  let label = parts.join(' · ');
  if (!label && sphereErr != null) {
    label = `Hedefe ~${Math.round(sphereErr)}°`;
  }
  if (!label) {
    label = 'Konumu ince ayarlayın';
  }

  return { yawDir, pitchDir, label, yawDeltaDeg, pitchDeltaDeg };
}

export function buildCaptureSession(
  state: EngineState,
  refQuat: [number, number, number, number],
  platform: string,
): CaptureSession {
  return {
    version: 2,
    gridConfig: {
      cameraFovDeg: state.gridConfig.cameraFovDeg,
      overlapRatio: state.gridConfig.overlapRatio,
      totalTargets: state.targets.length,
    },
    frames: state.frames,
    completedTargetIds: Array.from(state.completedIds),
    refQuaternion: refQuat,
    startedAt: state.frames[0]?.timestamp ?? new Date().toISOString(),
    finalizedAt: new Date().toISOString(),
    deviceInfo: {
      cameraFov: state.gridConfig.cameraFovDeg,
      platform,
    },
  };
}
