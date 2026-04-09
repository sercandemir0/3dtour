import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useTourStore } from '@/src/stores/tourStore';
import { PanoramaViewer } from '@/src/components/TourViewer/PanoramaViewer';
import type { Scene } from '@/src/types/tour';

export default function ViewerScreen() {
  const { id, startScene } = useLocalSearchParams<{ id: string; startScene?: string }>();
  const { currentTour, loading, fetchTour } = useTourStore();
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const scenes = (currentTour?.scenes ?? []).filter((s) => s.panorama_url);

  useEffect(() => {
    if (id) fetchTour(id);
  }, [id]);

  useEffect(() => {
    if (!scenes.length || startScene == null) return;
    const parsed = Number(startScene);
    if (!Number.isFinite(parsed)) return;
    setActiveSceneIndex(Math.max(0, Math.min(scenes.length - 1, parsed)));
  }, [startScene, scenes.length]);

  if (loading || !currentTour) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8b5cf6" />
        <Text style={styles.loadingText}>Tur yukleniyor...</Text>
      </View>
    );
  }

  if (scenes.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Gorsel bulunamadi</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>Geri Don</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const activeScene = scenes[activeSceneIndex];

  const handleHotspotClick = (targetSceneId: string) => {
    const idx = scenes.findIndex((s) => s.id === targetSceneId);
    if (idx >= 0) setActiveSceneIndex(idx);
  };

  return (
    <View style={styles.container}>
      <PanoramaViewer
        scene={activeScene}
        scenes={scenes}
        onHotspotClick={handleHotspotClick}
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.sceneName}>{activeScene.name}</Text>
        <Text style={styles.sceneCounter}>
          {activeSceneIndex + 1}/{scenes.length}
        </Text>
      </View>

      {/* Scene selector */}
      {scenes.length > 1 && (
        <View style={styles.bottomBar}>
          {scenes.map((scene, idx) => (
            <TouchableOpacity
              key={scene.id}
              style={[
                styles.sceneTab,
                idx === activeSceneIndex && styles.sceneTabActive,
              ]}
              onPress={() => setActiveSceneIndex(idx)}
            >
              <Text
                style={[
                  styles.sceneTabText,
                  idx === activeSceneIndex && styles.sceneTabTextActive,
                ]}
                numberOfLines={1}
              >
                {scene.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0f0f23',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { color: '#9ca3af', fontSize: 15 },
  backLink: { color: '#8b5cf6', fontSize: 15, fontWeight: '600' },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 54 : 36,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  sceneName: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  sceneCounter: { color: '#9ca3af', fontSize: 13, fontWeight: '500', width: 36, textAlign: 'right' },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    paddingTop: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    gap: 8,
  },
  sceneTab: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  sceneTabActive: {
    backgroundColor: '#8b5cf6',
  },
  sceneTabText: { color: '#9ca3af', fontSize: 12, fontWeight: '500' },
  sceneTabTextActive: { color: '#fff' },
});
