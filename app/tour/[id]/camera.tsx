import { useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useTourStore } from '@/src/stores/tourStore';
import { GuidedCamera, type GuidedCapturePayload } from '@/src/components/GuidedCamera';
import { getCoverageSummary } from '@/src/utils/sectorCoverage';
import type { Scene } from '@/src/types/tour';

function sceneNeedsCapture(scene: Scene) {
  if (!scene.panorama_url) return true;
  const coverage = getCoverageSummary(scene);
  return coverage.hasGuidedData && coverage.incomplete;
}

function findNextPendingScene(scenes: Scene[], currentIdx: number) {
  return (
    scenes.find((scene, index) => index > currentIdx && sceneNeedsCapture(scene)) ??
    scenes.find((scene, index) => index < currentIdx && sceneNeedsCapture(scene)) ??
    null
  );
}

export default function CameraScreen() {
  const { id, sceneId, sceneName } = useLocalSearchParams<{
    id: string;
    sceneId: string;
    sceneName: string;
  }>();

  const { currentTour, commitSceneCapture, fetchTour } = useTourStore();

  useEffect(() => {
    if (id) {
      void fetchTour(id);
    }
  }, [id, fetchTour]);

  const scenes = currentTour?.scenes ?? [];
  const currentIdx = scenes.findIndex((s) => s.id === sceneId);
  const currentScene = scenes.find((scene) => scene.id === sceneId) ?? null;

  const handleComplete = async (payload: GuidedCapturePayload) => {
    if (!sceneId) return;
    await commitSceneCapture(sceneId, {
      primaryUri: payload.primaryUri,
      sources: payload.sources,
      sectorMask: payload.sectorMask,
      mediaType: payload.mediaType,
    });

    const updatedScenes = scenes.map((scene) =>
      scene.id === sceneId
        ? {
            ...scene,
            panorama_url: payload.primaryUri,
            thumbnail_url: payload.primaryUri,
            media_type: payload.mediaType,
            capture_sources: payload.sources,
            coverage_sector_mask: payload.sectorMask,
          }
        : scene,
    );
    const nextPending = findNextPendingScene(updatedScenes, currentIdx);

    if (nextPending) {
      router.replace(
        `/tour/${id}/camera?sceneId=${nextPending.id}&sceneName=${encodeURIComponent(nextPending.name)}`
      );
    } else {
      await fetchTour(id!);
      router.back();
    }
  };

  return (
    <GuidedCamera
      key={`${id ?? 'tour'}:${sceneId ?? 'scene'}`}
      sceneName={decodeURIComponent(sceneName ?? '')}
      nextSceneName={findNextPendingScene(scenes, currentIdx)?.name ?? undefined}
      roomProgressLabel={currentIdx >= 0 ? `Oda ${currentIdx + 1}/${scenes.length}` : undefined}
      existingCapture={
        currentScene
          ? {
              primaryUri: currentScene.panorama_url,
              sources: currentScene.capture_sources,
              sectorMask: currentScene.coverage_sector_mask,
              mediaType: currentScene.media_type,
            }
          : null
      }
      onComplete={handleComplete}
      onClose={() => router.back()}
    />
  );
}
