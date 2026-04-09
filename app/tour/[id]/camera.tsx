import { useLocalSearchParams, router } from 'expo-router';
import { useTourStore } from '@/src/stores/tourStore';
import { GuidedCamera } from '@/src/components/GuidedCamera';

export default function CameraScreen() {
  const { id, sceneId, sceneName } = useLocalSearchParams<{
    id: string;
    sceneId: string;
    sceneName: string;
  }>();

  const { currentTour, setSceneMedia, fetchTour } = useTourStore();

  const scenes = currentTour?.scenes ?? [];
  const currentIdx = scenes.findIndex((s) => s.id === sceneId);
  const nextEmpty = scenes.find((s, i) => i > currentIdx && !s.panorama_url);

  const handleCapture = async (uri: string) => {
    if (!sceneId) return;
    await setSceneMedia(sceneId, uri, 'camera');

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
      onCapture={handleCapture}
      onClose={() => router.back()}
    />
  );
}
