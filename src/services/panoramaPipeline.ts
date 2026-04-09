import type {
  ProcessingJob,
  SceneCaptureSource,
  SceneMediaType,
  Scene,
  SceneProjection,
} from '@/src/types/tour';
import { buildSceneProjection } from '@/src/utils/sceneProjection';

interface StartPanoramaPipelineParams {
  sceneId: string;
  primaryUri: string;
  mediaType: SceneMediaType;
  sources?: SceneCaptureSource[];
  sectorMask?: boolean[];
}

interface StartPanoramaPipelineResult {
  projection: SceneProjection;
  processingJob: ProcessingJob | null;
}

interface RemoteQueueResponse {
  jobId?: string;
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
  projection?: SceneProjection | null;
  processingJob?: ProcessingJob | null;
  panoramaUrl?: string | null;
  thumbnailUrl?: string | null;
}

const REMOTE_STITCH_URL = process.env.EXPO_PUBLIC_PANORAMA_STITCH_URL;
const REMOTE_STITCH_STATUS_URL = process.env.EXPO_PUBLIC_PANORAMA_STITCH_STATUS_URL;

function shouldQueueRemoteStitch(
  projection: SceneProjection,
  params: StartPanoramaPipelineParams,
): boolean {
  return Boolean(
    REMOTE_STITCH_URL &&
      projection.kind === 'guided_strip_360' &&
      params.mediaType !== 'photo',
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
  const response = await fetch(REMOTE_STITCH_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sceneId: params.sceneId,
      primaryUri: params.primaryUri,
      mediaType: params.mediaType,
      sources: params.sources ?? [],
      sectorMask: params.sectorMask ?? [],
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
  const projection = buildSceneProjection({
    primaryUri: params.primaryUri,
    sources: params.sources,
    sectorMask: params.sectorMask,
  });

  if (!shouldQueueRemoteStitch(projection, params)) {
    return {
      projection,
      processingJob: null,
    };
  }

  try {
    const remote = await queueRemotePanoramaStitch(params);

    return {
      projection: {
        ...projection,
        provider: 'remote',
        remote_job_id: remote.jobId ?? null,
      },
      processingJob: buildPendingJob(params.sceneId, params.primaryUri, remote.jobId),
    };
  } catch {
    return {
      projection,
      processingJob: null,
    };
  }
}

export async function pollPanoramaPipeline(scene: Scene): Promise<PollPanoramaPipelineResult | null> {
  const processingJob = scene.processing_job;
  const projection = scene.projection;

  if (
    !processingJob ||
    !projection ||
    projection.provider !== 'remote' ||
    (processingJob.status !== 'pending' && processingJob.status !== 'processing')
  ) {
    return null;
  }

  const remoteJobId = projection.remote_job_id ?? processingJob.id;
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
      return {
        panoramaUrl: json.panoramaUrl,
        thumbnailUrl: json.thumbnailUrl ?? json.panoramaUrl,
        projection: {
          version: 1,
          kind: 'single_image',
          source_uris: [json.panoramaUrl],
          provider: 'remote',
          remote_job_id: remoteJobId,
        },
        processingJob: {
          ...nextJob,
          progress: 100,
        },
      };
    }

    if (nextStatus === 'failed') {
      return {
        processingJob: nextJob,
      };
    }

    return {
      processingJob: nextJob,
    };
  } catch {
    return {
      processingJob: {
        ...processingJob,
        status: 'failed',
        error_message: 'Remote stitch status unavailable',
        updated_at: new Date().toISOString(),
      },
    };
  }
}
