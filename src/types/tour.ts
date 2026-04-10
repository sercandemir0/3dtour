export type CaptureMode = 'panorama' | 'gaussian_splat' | 'roomplan';
export type TourStatus = 'draft' | 'processing' | 'published' | 'archived';
export type SceneType = 'panorama' | 'gaussian_splat' | 'roomplan';
export type SceneMediaType = 'photo' | 'video_frame' | 'camera' | null;
export type HotspotIconType = 'navigate' | 'info' | 'link';
export type JobType = 'panorama_stitch' | 'gaussian_splat' | 'video_extract' | 'video_sweep_stitch';
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type SceneProjectionKind = 'single_image' | 'guided_strip_360' | 'video_sweep_strip' | 'equirect_grid';
export type SceneProjectionProvider = 'local' | 'remote';
export type StitchStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';

// ---------------------------------------------------------------------------
// Legacy 6-direction types (kept for backward-compat, will be removed later)
// ---------------------------------------------------------------------------
export type CaptureDirection = 'front' | 'right' | 'back' | 'left' | 'up' | 'down';
export type CaptureStatus = 'empty' | 'partial' | 'complete';
export type CaptureMethod = 'discrete_6dir' | 'video_sweep';

export const CAPTURE_DIRECTIONS: CaptureDirection[] = [
  'front',
  'right',
  'back',
  'left',
  'up',
  'down',
];

export interface SceneCaptureShot {
  uri: string;
  direction: CaptureDirection;
  captured_at: string;
  yawDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  validation?: 'pending' | 'passed' | 'failed';
}

export interface SceneCaptureSet {
  version: 1;
  required_directions: CaptureDirection[];
  shots: Partial<Record<CaptureDirection, SceneCaptureShot>>;
  primary_direction: CaptureDirection | null;
  finalized_at: string | null;
}

// ---------------------------------------------------------------------------
// New v2 capture session types (spherical grid)
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

// ---------------------------------------------------------------------------
// Shared / general types
// ---------------------------------------------------------------------------

export interface SweepTelemetryPoint {
  atMs: number;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
}

export interface SweepFrame {
  uri: string;
  atMs: number;
  yawDeg: number;
  pitchDeg: number;
  quality: 'good' | 'blurry' | 'fast_motion';
  sectorIndex: number;
}

export interface SweepCaptureData {
  version: 2;
  method: CaptureMethod;
  videoUri: string | null;
  videoDurationMs: number;
  telemetry: SweepTelemetryPoint[];
  extractedFrames: SweepFrame[];
  supplementUpUri: string | null;
  supplementDownUri: string | null;
  coverageDeg: number;
  avgSpeedDegPerSec: number;
  qualityScore: number;
  startedAt: string;
  completedAt: string;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Profile {
  id: string;
  full_name: string | null;
  company: string | null;
  avatar_url: string | null;
  created_at: string;
}

export interface SceneCaptureSource {
  uri: string;
  yawDeg?: number;
  atMs?: number;
  sectorIndex?: number;
}

export interface SceneProjection {
  version: 1;
  kind: SceneProjectionKind;
  source_uris: string[];
  provider: SceneProjectionProvider;
  coverage_sector_count?: number;
  remote_job_id?: string | null;
}

export interface SceneStitchedAsset {
  uri: string;
  provider: SceneProjectionProvider;
  job_id: string | null;
  width?: number | null;
  height?: number | null;
  created_at: string;
}

export interface Tour {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  capture_mode: CaptureMode;
  status: TourStatus;
  share_slug: string | null;
  created_at: string;
  updated_at: string;
  scenes?: Scene[];
}

export interface Scene {
  id: string;
  tour_id: string;
  name: string;
  scene_type: SceneType;
  media_type: SceneMediaType;
  panorama_url: string | null;
  splat_url: string | null;
  roomplan_url: string | null;
  thumbnail_url: string | null;
  order: number;
  initial_yaw: number;
  initial_pitch: number;
  initial_fov: number;
  camera_position: Vector3 | null;
  camera_target: Vector3 | null;
  created_at: string;
  hotspots?: Hotspot[];
  /** @deprecated Use capture_session instead */
  capture_set?: SceneCaptureSet | null;
  /** New v2 capture session (spherical grid). */
  capture_session?: CaptureSession | null;
  capture_status?: CaptureStatus;
  stitch_status?: StitchStatus;
  stitched_asset?: SceneStitchedAsset | null;
  preview_projection?: SceneProjection | null;
  capture_sources?: SceneCaptureSource[];
  coverage_sector_mask?: boolean[];
  projection?: SceneProjection | null;
  processing_job?: ProcessingJob | null;
  sweep_data?: SweepCaptureData | null;
}

export interface Hotspot {
  id: string;
  scene_id: string;
  target_scene_id: string | null;
  yaw: number | null;
  pitch: number | null;
  position_3d: Vector3 | null;
  label: string | null;
  icon_type: HotspotIconType;
  created_at: string;
}

export interface ProcessingJob {
  id: string;
  scene_id: string;
  job_type: JobType;
  input_url: string;
  status: JobStatus;
  progress: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
