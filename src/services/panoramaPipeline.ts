import type {
  SceneCaptureSet,
  ProcessingJob,
  SceneMediaType,
  Scene,
  SceneProjection,
  SceneStitchedAsset,
  StitchStatus,
} from '@/src/types/tour';
import { buildPreviewProjectionFromCaptureSet } from '@/src/utils/sceneProjection';
import { getOrderedCaptureShots, isCaptureSetComplete } from '@/src/utils/sceneState';

interface StartPanoramaPipelineParams {
  sceneId: string;
  tourId: string;
  mode: Scene['scene_type'];
  mediaType: SceneMediaType;
  captureSet?: SceneCaptureSet | null;
}

interface StartPanoramaPipelineResult {
  previewProjection: SceneProjection | null;
  processingJob: ProcessingJob | null;
  stitchStatus: StitchStatus;
}

interface RemoteQueueResponse {
  jobId?: string;
  status?: ProcessingJob['status'];
  estimatedStage?: string;
}

interface RemoteStatusResponse {
  jobId?: string;
  status?: ProcessingJob['status'];
  progress?: number;
  panoramaUrl?: string;
  thumbnailUrl?: string;
  errorMessage?: string | null;
}

interface PollPanoramaPipelineResult {
  stitchedAsset?: SceneStitchedAsset | null;
  processingJob?: ProcessingJob | null;
  panoramaUrl?: string | null;
  thumbnailUrl?: string | null;
  stitchStatus?: StitchStatus;
}

const REMOTE_STITCH_URL = process.env.EXPO_PUBLIC_PANORAMA_STITCH_URL;
const REMOTE_STITCH_STATUS_URL = process.env.EXPO_PUBLIC_PANORAMA_STITCH_STATUS_URL;

function shouldQueueRemoteStitch(
  params: StartPanoramaPipelineParams,
): boolean {
  return Boolean(
    REMOTE_STITCH_URL &&
      params.captureSet &&
      isCaptureSetComplete(params.captureSet) &&
      params.mediaType !== null,
  );
}

function buildPendingJob(sceneId: string, inputUrl: string, remoteJobId?: string): ProcessingJob {
  const now = new Date().toISOString();

  return {
    id: remoteJobId ?? `panorama-stitch-${sceneId}-${Date.now()}`,
    scene_id: sceneId,
    job_type: 'panorama_stitch',
    input_url: inputUrl,
    status: 'pending',
    progress: 5,
    error_message: null,
    created_at: now,
    updated_at: now,
  };
}

function buildStatusUrl(jobId: string): string | null {
  if (!REMOTE_STITCH_STATUS_URL) {
    return null;
  }

  if (REMOTE_STITCH_STATUS_URL.includes('{jobId}')) {
    return REMOTE_STITCH_STATUS_URL.replace('{jobId}', encodeURIComponent(jobId));
  }

  return `${REMOTE_STITCH_STATUS_URL.replace(/\/$/, '')}/${encodeURIComponent(jobId)}`;
}

async function queueRemotePanoramaStitch(
  params: StartPanoramaPipelineParams,
): Promise<RemoteQueueResponse> {
  const captureShots = getOrderedCaptureShots(params.captureSet);
  const response = await fetch(REMOTE_STITCH_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sceneId: params.sceneId,
      tourId: params.tourId,
      mode: params.mode,
      mediaType: params.mediaType,
      captureSet: params.captureSet,
      sources: captureShots.map((shot) => ({
        direction: shot.direction,
        uri: shot.uri,
        capturedAt: shot.captured_at,
        yawDeg: shot.yawDeg,
        pitchDeg: shot.pitchDeg,
        rollDeg: shot.rollDeg,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Remote stitch queue failed: ${response.status}`);
  }

  const json = (await response.json()) as RemoteQueueResponse;
  return json;
}

export async function startPanoramaPipeline(
  params: StartPanoramaPipelineParams,
): Promise<StartPanoramaPipelineResult> {
  const previewProjection = buildPreviewProjectionFromCaptureSet(params.captureSet);
  const primaryShot = params.captureSet?.shots[params.captureSet.primary_direction ?? 'front']
    ?? getOrderedCaptureShots(params.captureSet)[0]
    ?? null;

  if (!shouldQueueRemoteStitch(params)) {
    return {
      previewProjection,
      processingJob: null,
      stitchStatus: 'idle',
    };
  }

  try {
    const remote = await queueRemotePanoramaStitch(params);
    const remoteStatus = remote.status ?? 'pending';

    return {
      previewProjection,
      processingJob: buildPendingJob(params.sceneId, primaryShot?.uri ?? '', remote.jobId),
      stitchStatus: remoteStatus === 'processing' ? 'processing' : 'queued',
    };
  } catch {
    return {
      previewProjection,
      processingJob: null,
      stitchStatus: 'idle',
    };
  }
}

export async function pollPanoramaPipeline(scene: Scene): Promise<PollPanoramaPipelineResult | null> {
  const processingJob = scene.processing_job;
  const projection = scene.preview_projection ?? scene.projection;

  if (
    !processingJob ||
    !projection ||
    (processingJob.status !== 'pending' && processingJob.status !== 'processing')
  ) {
    return null;
  }

  const remoteJobId = processingJob.id;
  const statusUrl = buildStatusUrl(remoteJobId);

  if (!statusUrl) {
    return null;
  }

  try {
    const response = await fetch(statusUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Remote stitch status failed: ${response.status}`);
    }

    const json = (await response.json()) as RemoteStatusResponse;
    const nextStatus = json.status ?? processingJob.status;
    const nextJob: ProcessingJob = {
      ...processingJob,
      id: json.jobId ?? processingJob.id,
      status: nextStatus,
      progress: json.progress ?? processingJob.progress,
      error_message: json.errorMessage ?? processingJob.error_message,
      updated_at: new Date().toISOString(),
    };

    if (nextStatus === 'completed' && json.panoramaUrl) {
      const stitchedAsset: SceneStitchedAsset = {
        uri: json.panoramaUrl,
        provider: 'remote',
        job_id: remoteJobId,
        created_at: new Date().toISOString(),
      };

      return {
        panoramaUrl: json.panoramaUrl,
        thumbnailUrl: json.thumbnailUrl ?? json.panoramaUrl,
        stitchedAsset,
        processingJob: {
          ...nextJob,
          progress: 100,
        },
        stitchStatus: 'completed',
      };
    }

    if (nextStatus === 'failed') {
      return {
        processingJob: nextJob,
        stitchStatus: 'failed',
      };
    }

    return {
      processingJob: nextJob,
      stitchStatus: nextStatus === 'processing' ? 'processing' : 'queued',
    };
  } catch {
    return {
      processingJob: {
        ...processingJob,
        status: 'failed',
        error_message: 'Remote stitch status unavailable',
        updated_at: new Date().toISOString(),
      },
      stitchStatus: 'failed',
    };
  }
}
