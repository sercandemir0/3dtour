import { useLocalSearchParams, router } from 'expo-router';
import { useTourStore } from '@/src/stores/tourStore';
import { GuidedCamera, type GuidedCapturePayload } from '@/src/components/GuidedCamera';

export default function CameraScreen() {
  const { id, sceneId, sceneName } = useLocalSearchParams<{
    id: string;
    sceneId: string;
    sceneName: string;
  }>();

  const { currentTour, commitSceneCapture, fetchTour } = useTourStore();

  const scenes = currentTour?.scenes ?? [];
  const currentIdx = scenes.findIndex((s) => s.id === sceneId);
  const nextEmpty = scenes.find((s, i) => i > currentIdx && !s.panorama_url);

  const handleComplete = async (payload: GuidedCapturePayload) => {
    if (!sceneId) return;
    await commitSceneCapture(sceneId, {
      primaryUri: payload.primaryUri,
      sources: payload.sources,
      sectorMask: payload.sectorMask,
      mediaType: payload.mediaType,
    });

    if (nextEmpty) {
      router.replace(
        `/tour/${id}/camera?sceneId=${nextEmpty.id}&sceneName=${encodeURIComponent(nextEmpty.name)}`
      );
    } else {
      await fetchTour(id!);
      router.back();
    }
  };

  return (
    <GuidedCamera
      sceneName={decodeURIComponent(sceneName ?? '')}
      nextSceneName={nextEmpty?.name}
      onComplete={handleComplete}
      onClose={() => router.back()}
    />
  );
}
