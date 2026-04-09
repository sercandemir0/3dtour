import type {
  Scene,
  SceneCaptureSource,
  SceneProjection,
} from '@/src/types/tour';
import { isFullCoverage, SECTOR_COUNT } from '@/src/utils/sectorCoverage';

function sortCaptureSourcesBySector(sources: SceneCaptureSource[]): SceneCaptureSource[] {
  return [...sources].sort((a, b) => {
    const aIndex = a.sectorIndex ?? Number.MAX_SAFE_INTEGER;
    const bIndex = b.sectorIndex ?? Number.MAX_SAFE_INTEGER;
    return aIndex - bIndex;
  });
}

function getGuidedProjectionSources(sources: SceneCaptureSource[]): SceneCaptureSource[] | null {
  const ordered = sortCaptureSourcesBySector(sources).filter(
    (source) => source.sectorIndex != null,
  );

  if (ordered.length !== SECTOR_COUNT) {
    return null;
  }

  for (let i = 0; i < SECTOR_COUNT; i += 1) {
    if (ordered[i].sectorIndex !== i) {
      return null;
    }
  }

  return ordered;
}

export function buildSceneProjection(params: {
  primaryUri: string;
  sources?: SceneCaptureSource[];
  sectorMask?: boolean[];
}): SceneProjection {
  const orderedGuidedSources =
    params.sources && params.sectorMask && isFullCoverage(params.sectorMask)
      ? getGuidedProjectionSources(params.sources)
      : null;

  if (orderedGuidedSources) {
    return {
      version: 1,
      kind: 'guided_strip_360',
      source_uris: orderedGuidedSources.map((source) => source.uri),
      provider: 'local',
      coverage_sector_count: SECTOR_COUNT,
    };
  }

  return {
    version: 1,
    kind: 'single_image',
    source_uris: [params.primaryUri],
    provider: 'local',
  };
}

export function getSceneProjection(scene: Scene): SceneProjection {
  if (scene.projection?.source_uris?.length) {
    return {
      ...scene.projection,
      provider: scene.projection.provider ?? 'local',
    };
  }

  return buildSceneProjection({
    primaryUri: scene.panorama_url ?? scene.thumbnail_url ?? '',
    sources: scene.capture_sources,
    sectorMask: scene.coverage_sector_mask,
  });
}

export function getGuidedPanoramaUris(scene: Scene): string[] | null {
  const projection = getSceneProjection(scene);

  if (projection.kind !== 'guided_strip_360') {
    return null;
  }

  return projection.source_uris.length === SECTOR_COUNT ? projection.source_uris : null;
}
