import { useEffect } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { useTourStore } from '@/src/stores/tourStore';
import { GuidedCamera, type GuidedCapturePayload } from '@/src/components/GuidedCamera';
import type { Scene } from '@/src/types/tour';
import { getSceneCaptureStatus, getSceneViewerMode } from '@/src/utils/sceneState';

function sceneNeedsCapture(scene: Scene) {
  return getSceneCaptureStatus(scene) !== 'complete' && getSceneViewerMode(scene) === 'none';
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

  const {
    currentTour,
    saveCaptureSession,
    fetchTour,
  } = useTourStore();

  useEffect(() => {
    if (id) {
      void fetchTour(id);
    }
  }, [id, fetchTour]);

  const scenes = currentTour?.scenes ?? [];
  const currentIdx = scenes.findIndex((s) => s.id === sceneId);

  const handleComplete = async (payload: GuidedCapturePayload) => {
    if (!sceneId) return;

    await saveCaptureSession(sceneId, payload.captureSession);
    await fetchTour(id!);

    const refreshedScenes = useTourStore.getState().currentTour?.scenes ?? scenes;
    const updatedScenes = refreshedScenes.map((scene) =>
      scene.id === sceneId
        ? { ...scene, capture_status: 'complete' as const }
        : scene,
    );
    const nextPending = findNextPendingScene(updatedScenes, currentIdx);
    const multiScene = updatedScenes.length > 1;

    if (nextPending && multiScene) {
      router.replace(
        `/tour/${id}/camera?sceneId=${nextPending.id}&sceneName=${encodeURIComponent(nextPending.name)}`
      );
    } else {
      await fetchTour(id!);
      router.back();
    }
  };

  const singleSceneMvp = scenes.length <= 1;

  return (
    <GuidedCamera
      key={`${id ?? 'tour'}:${sceneId ?? 'scene'}`}
      sceneName={decodeURIComponent(sceneName ?? '')}
      nextSceneName={
        singleSceneMvp ? undefined : findNextPendingScene(scenes, currentIdx)?.name
      }
      roomProgressLabel={
        singleSceneMvp || currentIdx < 0
          ? undefined
          : `Görünüm ${currentIdx + 1}/${scenes.length}`
      }
      onComplete={handleComplete}
      onClose={() => router.back()}
    />
  );
}
