import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTourStore } from '@/src/stores/tourStore';
import { HotspotEditor } from '@/src/components/HotspotEditor';
import { canEditSceneHotspots } from '@/src/utils/sceneState';

export default function HotspotsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentTour, loading, fetchTour, addHotspot, deleteHotspot } = useTourStore();
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);

  useEffect(() => {
    if (id) fetchTour(id);
  }, [id]);

  useEffect(() => {
    if (currentTour?.scenes?.length && !activeSceneId) {
      const firstWithMedia = currentTour.scenes.find((scene) => canEditSceneHotspots(scene));
      if (firstWithMedia) setActiveSceneId(firstWithMedia.id);
    }
  }, [currentTour]);

  if (loading || !currentTour) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#8b5cf6" />
      </View>
    );
  }

  const scenes = currentTour.scenes ?? [];

  return (
    <HotspotEditor
      scenes={scenes}
      activeSceneId={activeSceneId ?? ''}
      onAddHotspot={async (sceneId, targetSceneId, yaw, pitch, label) => {
        await addHotspot({
          scene_id: sceneId,
          target_scene_id: targetSceneId,
          yaw,
          pitch,
          position_3d: null,
          label,
          icon_type: 'navigate',
        });
        await fetchTour(id!);
      }}
      onDeleteHotspot={async (hotspotId) => {
        await deleteHotspot(hotspotId);
        await fetchTour(id!);
      }}
      onChangeScene={setActiveSceneId}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f23' },
});
