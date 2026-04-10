import type {
  CaptureDirection,
  CaptureStatus,
  CaptureSession,
  Scene,
  SceneCaptureSet,
  SceneCaptureShot,
  SceneProjection,
  SceneStitchedAsset,
  StitchStatus,
} from '@/src/types/tour';
import { CAPTURE_DIRECTIONS } from '@/src/types/tour';

export const CAPTURE_DIRECTION_LABELS_TR: Record<CaptureDirection, string> = {
  front: 'On',
  right: 'Sag',
  back: 'Arka',
  left: 'Sol',
  up: 'Tavan',
  down: 'Zemin',
};

export const CAPTURE_DIRECTION_HINTS_TR: Record<CaptureDirection, string> = {
  front: 'Kapinin veya odanin ana bakis yonune dogru cekin.',
  right: 'Saga 90° donup duz tutarak cekin.',
  back: 'Arkaniza 180° donup duz tutarak cekin.',
  left: 'Sola 90° donup duz tutarak cekin.',
  up: 'Kamerayi tavana cevirin.',
  down: 'Kamerayi zemine cevirin.',
};

export function createEmptyCaptureSet(): SceneCaptureSet {
  return {
    version: 1,
    required_directions: [...CAPTURE_DIRECTIONS],
    shots: {},
    primary_direction: 'front',
    finalized_at: null,
  };
}

export function getCaptureShot(scene: Scene, direction: CaptureDirection): SceneCaptureShot | null {
  return scene.capture_set?.shots?.[direction] ?? null;
}

export function getOrderedCaptureShots(
  captureSet?: SceneCaptureSet | null,
): SceneCaptureShot[] {
  if (!captureSet) {
    return [];
  }

  return CAPTURE_DIRECTIONS
    .map((direction) => captureSet.shots[direction] ?? null)
    .filter(Boolean) as SceneCaptureShot[];
}

export function countCaptureShots(captureSet?: SceneCaptureSet | null): number {
  return getOrderedCaptureShots(captureSet).length;
}

export function deriveCaptureStatus(captureSet?: SceneCaptureSet | null, captureSession?: CaptureSession | null): CaptureStatus {
  if (captureSession) {
    if (captureSession.frames.length === 0) return 'empty';
    const ratio = captureSession.frames.length / captureSession.gridConfig.totalTargets;
    return ratio >= 0.7 ? 'complete' : 'partial';
  }
  const count = countCaptureShots(captureSet);
  if (count === 0) {
    return 'empty';
  }
  if (count === CAPTURE_DIRECTIONS.length) {
    return 'complete';
  }
  return 'partial';
}

export function isCaptureSetComplete(captureSet?: SceneCaptureSet | null): boolean {
  return deriveCaptureStatus(captureSet) === 'complete';
}

function isGuidedPreviewProjection(projection?: SceneProjection | null): boolean {
  if (!projection) return false;
  if (projection.kind === 'equirect_grid' && projection.source_uris.length > 0) return true;
  return projection.kind === 'guided_strip_360' && projection.source_uris.length === CAPTURE_DIRECTIONS.length;
}

export function deriveLegacyStitchedAsset(scene: Scene): SceneStitchedAsset | null {
  if (!scene.panorama_url) {
    return null;
  }

  const guidedPreview = isGuidedPreviewProjection(scene.preview_projection)
    || isGuidedPreviewProjection(scene.projection);

  if (guidedPreview) {
    return null;
  }

  return {
    uri: scene.panorama_url,
    provider: 'local',
    job_id: null,
    created_at: scene.created_at,
  };
}

export function deriveStitchStatus(scene: Scene): StitchStatus {
  if (scene.stitch_status) {
    return scene.stitch_status;
  }
  if (scene.stitched_asset?.uri || deriveLegacyStitchedAsset(scene)?.uri) {
    return 'completed';
  }
  if (scene.processing_job?.status === 'failed') {
    return 'failed';
  }
  if (scene.processing_job?.status === 'processing') {
    return 'processing';
  }
  if (scene.processing_job?.status === 'pending') {
    return 'queued';
  }
  return 'idle';
}

export function getSceneCaptureStatus(scene: Scene): CaptureStatus {
  return scene.capture_status ?? deriveCaptureStatus(scene.capture_set, scene.capture_session);
}

export function getSceneStitchedAsset(scene: Scene): SceneStitchedAsset | null {
  return scene.stitched_asset ?? deriveLegacyStitchedAsset(scene);
}

export function getScenePreviewProjection(scene: Scene): SceneProjection | null {
  return scene.preview_projection ?? scene.projection ?? null;
}

export function isLegacySingleImageScene(scene: Scene): boolean {
  return !scene.capture_set && !!scene.panorama_url && !isGuidedPreviewProjection(getScenePreviewProjection(scene));
}

export function isSceneViewable(scene: Scene): boolean {
  return !!(
    getSceneStitchedAsset(scene)?.uri ||
    isGuidedPreviewProjection(getScenePreviewProjection(scene)) ||
    isLegacySingleImageScene(scene)
  );
}

export function getSceneThumbnailUri(scene: Scene): string | null {
  if (scene.thumbnail_url) {
    return scene.thumbnail_url;
  }

  const stitched = getSceneStitchedAsset(scene);
  if (stitched?.uri) {
    return stitched.uri;
  }

  const primaryDirection = scene.capture_set?.primary_direction ?? 'front';
  const primaryShot = scene.capture_set?.shots?.[primaryDirection];
  if (primaryShot?.uri) {
    return primaryShot.uri;
  }

  const firstShot = getOrderedCaptureShots(scene.capture_set)[0];
  if (firstShot?.uri) {
    return firstShot.uri;
  }

  return scene.panorama_url ?? null;
}

export function getSceneViewerMode(scene: Scene): 'stitched' | 'preview' | 'legacy' | 'none' {
  if (getSceneStitchedAsset(scene)?.uri) {
    return scene.capture_set ? 'stitched' : 'legacy';
  }
  if (isGuidedPreviewProjection(getScenePreviewProjection(scene))) {
    return 'preview';
  }
  if (isLegacySingleImageScene(scene)) {
    return 'legacy';
  }
  return 'none';
}

export function getSceneStatus(scene: Scene):
  | 'capture_incomplete'
  | 'ready_for_stitch'
  | 'processing'
  | 'stitched'
  | 'failed'
  | 'legacy_ready' {
  const captureStatus = getSceneCaptureStatus(scene);
  const stitchStatus = deriveStitchStatus(scene);
  const viewerMode = getSceneViewerMode(scene);

  if (isLegacySingleImageScene(scene)) {
    return 'legacy_ready';
  }
  if (stitchStatus === 'completed' && !!getSceneStitchedAsset(scene)?.uri) {
    return 'stitched';
  }
  if (stitchStatus === 'failed') {
    return 'failed';
  }
  if (stitchStatus === 'queued' || stitchStatus === 'processing') {
    return 'processing';
  }
  if (viewerMode === 'preview' && captureStatus === 'empty') {
    return 'ready_for_stitch';
  }
  if (captureStatus !== 'complete') {
    return 'capture_incomplete';
  }
  return 'ready_for_stitch';
}

export function canEditSceneHotspots(scene: Scene): boolean {
  const mode = getSceneViewerMode(scene);
  return mode === 'stitched' || mode === 'preview' || mode === 'legacy';
}
