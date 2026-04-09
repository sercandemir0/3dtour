import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTourStore } from '@/src/stores/tourStore';
import type { Scene } from '@/src/types/tour';

const MODE_LABELS: Record<string, string> = {
  panorama: '360° Panorama',
  gaussian_splat: '3D Splat',
  roomplan: 'RoomPlan',
};

function SceneCard({ scene, onPress }: { scene: Scene; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.sceneCard} onPress={onPress} activeOpacity={0.7}>
      {scene.panorama_url || scene.thumbnail_url ? (
        <Image
          source={{ uri: scene.thumbnail_url ?? scene.panorama_url ?? '' }}
          style={styles.sceneThumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.scenePlaceholder}>
          <Text style={styles.scenePlaceholderText}>🖼</Text>
        </View>
      )}
      <Text style={styles.sceneName} numberOfLines={1}>{scene.name}</Text>
    </TouchableOpacity>
  );
}

export default function TourDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentTour, loading, fetchTour, addScene, updateScene, deleteTour } = useTourStore();
  const [addingScene, setAddingScene] = useState(false);

  useEffect(() => {
    if (id) fetchTour(id);
  }, [id]);

  const handleAddScene = async () => {
    if (!currentTour) return;

    const sceneType = currentTour.capture_mode === 'gaussian_splat'
      ? 'gaussian_splat'
      : currentTour.capture_mode === 'roomplan'
        ? 'roomplan'
        : 'panorama';

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('İzin gerekli', 'Galeriden fotoğraf seçmek için medya kitaplığı izni verin.');
      return;
    }

    setAddingScene(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: true,
        selectionLimit: 0,
        orderedSelection: true,
      });

      if (result.canceled || !result.assets.length) return;

      const baseCount = currentTour.scenes?.length ?? 0;
      for (let i = 0; i < result.assets.length; i++) {
        const asset = result.assets[i];
        const scene = await addScene(
          currentTour.id,
          `Oda ${baseCount + i + 1}`,
          sceneType
        );
        await updateScene(scene.id, {
          panorama_url: asset.uri,
          thumbnail_url: asset.uri,
        });
      }

      await fetchTour(currentTour.id);
    } catch (e: any) {
      Alert.alert('Hata', e.message ?? 'Sahne eklenemedi');
    } finally {
      setAddingScene(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Tur Sil', 'Bu turu silmek istediginizden emin misiniz?', [
      { text: 'Iptal', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          if (id) {
            await deleteTour(id);
            router.back();
          }
        },
      },
    ]);
  };

  const handleViewTour = () => {
    if (currentTour?.scenes?.some((s) => s.panorama_url)) {
      router.push(`/tour/${id}/viewer`);
    } else {
      Alert.alert('Uyari', 'Turu goruntulemek icin en az bir panoramik gorsel ekleyin.');
    }
  };

  if (loading || !currentTour) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#8b5cf6" />
      </View>
    );
  }

  const scenes = currentTour.scenes ?? [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Tour Info */}
      <View style={styles.header}>
        <Text style={styles.title}>{currentTour.title}</Text>
        <View style={styles.modeBadge}>
          <Text style={styles.modeBadgeText}>
            {MODE_LABELS[currentTour.capture_mode]}
          </Text>
        </View>
      </View>

      {currentTour.description ? (
        <Text style={styles.description}>{currentTour.description}</Text>
      ) : null}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.viewButton} onPress={handleViewTour} activeOpacity={0.8}>
          <Text style={styles.viewButtonText}>▶ Turu Goruntule</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} activeOpacity={0.8}>
          <Text style={styles.deleteButtonText}>🗑</Text>
        </TouchableOpacity>
      </View>

      {/* Scenes */}
      <View style={styles.scenesHeader}>
        <Text style={styles.sectionTitle}>
          Sahneler ({scenes.length})
        </Text>
      </View>

      {scenes.length === 0 ? (
        <View style={styles.emptyScenes}>
          <Text style={styles.emptyScenesText}>
            Henüz sahne yok. Aşağıdan galeriyi açıp birden fazla panoramik fotoğrafı aynı anda seçerek
            odalarınızı ekleyin; her fotoğraf turdaki ayrı bir sahne olur.
          </Text>
        </View>
      ) : (
        <View style={styles.scenesGrid}>
          {scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              onPress={() => {
                // TODO: scene detail/edit
              }}
            />
          ))}
        </View>
      )}

      <TouchableOpacity
        style={[styles.addSceneButton, addingScene && { opacity: 0.6 }]}
        onPress={handleAddScene}
        disabled={addingScene}
        activeOpacity={0.8}
      >
        <Text style={styles.addSceneButtonText}>
          {addingScene ? 'Ekleniyor...' : '+ Sahne ekle (çoklu fotoğraf)'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f23' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', flex: 1 },
  modeBadge: {
    backgroundColor: '#8b5cf633',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  modeBadgeText: { color: '#8b5cf6', fontSize: 12, fontWeight: '600' },
  description: { fontSize: 15, color: '#9ca3af', marginBottom: 16, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 10, marginVertical: 16 },
  viewButton: {
    flex: 1,
    backgroundColor: '#8b5cf6',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  viewButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  deleteButton: {
    backgroundColor: '#ef444433',
    borderRadius: 12,
    padding: 14,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  deleteButtonText: { fontSize: 18 },
  scenesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  emptyScenes: {
    backgroundColor: '#1e1e3a',
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
  },
  emptyScenesText: { color: '#6b7280', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  scenesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sceneCard: {
    width: '47%' as any,
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  sceneThumbnail: { width: '100%', height: 100 },
  scenePlaceholder: {
    width: '100%',
    height: 100,
    backgroundColor: '#2d2d5e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scenePlaceholderText: { fontSize: 32 },
  sceneName: { color: '#fff', fontSize: 14, fontWeight: '500', padding: 10 },
  addSceneButton: {
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#8b5cf644',
    borderStyle: 'dashed',
  },
  addSceneButtonText: { color: '#8b5cf6', fontSize: 15, fontWeight: '600' },
});
