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
    saveCaptureShot,
    finalizeCaptureSet,
    queueStitch,
    fetchTour,
  } = useTourStore();

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
    for (const direction of payload.captureSet.required_directions) {
      const shot = payload.captureSet.shots[direction];
      if (!shot) {
        continue;
      }
      await saveCaptureShot(sceneId, direction, {
        uri: shot.uri,
        captured_at: shot.captured_at,
        yawDeg: shot.yawDeg,
        pitchDeg: shot.pitchDeg,
        rollDeg: shot.rollDeg,
        validation: shot.validation,
      });
    }

    await finalizeCaptureSet(sceneId, payload.mediaType);
    await queueStitch(sceneId);
    await fetchTour(id!);

    const refreshedScenes = useTourStore.getState().currentTour?.scenes ?? scenes;
    const updatedScenes = refreshedScenes.map((scene) =>
      scene.id === sceneId
        ? {
            ...scene,
            capture_set: payload.captureSet,
            capture_status: 'complete' as const,
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
              captureSet: currentScene.capture_set,
              mediaType: currentScene.media_type,
            }
          : null
      }
      onComplete={handleComplete}
      onClose={() => router.back()}
    />
  );
}
