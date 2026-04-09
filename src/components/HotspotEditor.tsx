import { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Dimensions,
} from 'react-native';
import type { Scene, Hotspot } from '@/src/types/tour';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PANORAMA_HEIGHT = 200;

interface Props {
  scenes: Scene[];
  activeSceneId: string;
  onAddHotspot: (
    sceneId: string,
    targetSceneId: string,
    yaw: number,
    pitch: number,
    label: string,
  ) => void;
  onDeleteHotspot: (hotspotId: string) => void;
  onChangeScene: (sceneId: string) => void;
}

export function HotspotEditor({
  scenes,
  activeSceneId,
  onAddHotspot,
  onDeleteHotspot,
  onChangeScene,
}: Props) {
  const [targetModalVisible, setTargetModalVisible] = useState(false);
  const [pendingTap, setPendingTap] = useState<{ yaw: number; pitch: number } | null>(null);

  const activeScene = scenes.find((s) => s.id === activeSceneId);
  const otherScenes = scenes.filter((s) => s.id !== activeSceneId && s.panorama_url);

  if (!activeScene?.panorama_url) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Bu odanın fotoğrafı henüz yok. Önce çekim yapın.</Text>
      </View>
    );
  }

  const handleImageTap = (evt: any) => {
    const { locationX, locationY } = evt.nativeEvent;
    const yaw = ((locationX / SCREEN_WIDTH) * 360) - 180;
    const pitch = 90 - ((locationY / PANORAMA_HEIGHT) * 180);
    setPendingTap({ yaw, pitch });
    setTargetModalVisible(true);
  };

  const handleSelectTarget = (targetSceneId: string, label: string) => {
    if (pendingTap) {
      onAddHotspot(activeSceneId, targetSceneId, pendingTap.yaw, pendingTap.pitch, label);
    }
    setTargetModalVisible(false);
    setPendingTap(null);
  };

  const hotspots = activeScene.hotspots ?? [];

  return (
    <View style={styles.container}>
      {/* Scene tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sceneTabs}>
        {scenes.filter((s) => s.panorama_url).map((scene) => (
          <TouchableOpacity
            key={scene.id}
            style={[styles.sceneTab, scene.id === activeSceneId && styles.sceneTabActive]}
            onPress={() => onChangeScene(scene.id)}
          >
            <Text
              style={[styles.sceneTabText, scene.id === activeSceneId && styles.sceneTabTextActive]}
              numberOfLines={1}
            >
              {scene.name}
            </Text>
            {(scene.hotspots?.length ?? 0) > 0 && (
              <View style={styles.hotspotBadge}>
                <Text style={styles.hotspotBadgeText}>{scene.hotspots!.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Panorama preview with tap-to-add */}
      <Text style={styles.hint}>Panoramaya dokunarak hotspot ekleyin</Text>
      <TouchableOpacity activeOpacity={0.9} onPress={handleImageTap}>
        <Image
          source={{ uri: activeScene.panorama_url }}
          style={styles.panoramaPreview}
          resizeMode="cover"
        />
        {/* Existing hotspot markers */}
        {hotspots.filter((h) => h.yaw != null && h.pitch != null).map((h) => {
          const x = ((h.yaw! + 180) / 360) * SCREEN_WIDTH;
          const y = ((90 - h.pitch!) / 180) * PANORAMA_HEIGHT;
          return (
            <View key={h.id} style={[styles.hotspotDot, { left: x - 12, top: y - 12 }]}>
              <Text style={styles.hotspotDotText}>●</Text>
            </View>
          );
        })}
      </TouchableOpacity>

      {/* Existing hotspots list */}
      <Text style={styles.sectionTitle}>Mevcut Hotspot'lar ({hotspots.length})</Text>
      <ScrollView style={styles.hotspotList}>
        {hotspots.length === 0 ? (
          <Text style={styles.noHotspots}>
            Henüz hotspot yok. Yukarıdaki panoramaya dokunarak ekleyin.
          </Text>
        ) : (
          hotspots.map((h) => {
            const targetScene = scenes.find((s) => s.id === h.target_scene_id);
            return (
              <View key={h.id} style={styles.hotspotRow}>
                <View style={styles.hotspotInfo}>
                  <Text style={styles.hotspotLabel}>
                    → {targetScene?.name ?? 'Bilinmeyen'}
                  </Text>
                  <Text style={styles.hotspotCoords}>
                    Yaw: {h.yaw?.toFixed(0)}° | Pitch: {h.pitch?.toFixed(0)}°
                  </Text>
                </View>
                <TouchableOpacity onPress={() => onDeleteHotspot(h.id)} hitSlop={8}>
                  <Text style={styles.hotspotDelete}>🗑</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Target scene selection modal */}
      <Modal visible={targetModalVisible} transparent animationType="slide" onRequestClose={() => setTargetModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Hedef Oda Seçin</Text>
            <Text style={styles.modalSubtitle}>
              Bu noktaya tıklandığında hangi odaya geçilsin?
            </Text>

            {otherScenes.length === 0 ? (
              <Text style={styles.noTargets}>
                Başka fotoğrafı olan oda yok. Önce diğer odaları çekin.
              </Text>
            ) : (
              otherScenes.map((scene) => (
                <TouchableOpacity
                  key={scene.id}
                  style={styles.targetOption}
                  onPress={() => handleSelectTarget(scene.id, scene.name)}
                >
                  {scene.thumbnail_url && (
                    <Image source={{ uri: scene.thumbnail_url }} style={styles.targetThumb} />
                  )}
                  <Text style={styles.targetName}>{scene.name}</Text>
                </TouchableOpacity>
              ))
            )}

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => { setTargetModalVisible(false); setPendingTap(null); }}
            >
              <Text style={styles.modalCancelText}>İptal</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyText: { color: '#6b7280', fontSize: 15, textAlign: 'center' },
  sceneTabs: { maxHeight: 48, paddingHorizontal: 16, paddingVertical: 8 },
  sceneTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#1e1e3a', marginRight: 8,
  },
  sceneTabActive: { backgroundColor: '#8b5cf6' },
  sceneTabText: { color: '#9ca3af', fontSize: 13, fontWeight: '500' },
  sceneTabTextActive: { color: '#fff' },
  hotspotBadge: {
    backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 10,
    width: 20, height: 20, justifyContent: 'center', alignItems: 'center',
  },
  hotspotBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  hint: { color: '#6b7280', fontSize: 12, paddingHorizontal: 16, paddingVertical: 6 },
  panoramaPreview: {
    width: SCREEN_WIDTH, height: PANORAMA_HEIGHT,
    backgroundColor: '#2d2d5e',
  },
  hotspotDot: {
    position: 'absolute', width: 24, height: 24,
    justifyContent: 'center', alignItems: 'center',
  },
  hotspotDotText: { color: '#8b5cf6', fontSize: 20, textShadowColor: '#000', textShadowRadius: 4 },
  sectionTitle: {
    fontSize: 13, fontWeight: '600', color: '#9ca3af',
    textTransform: 'uppercase', letterSpacing: 1,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  hotspotList: { flex: 1, paddingHorizontal: 16 },
  noHotspots: { color: '#4b5563', fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  hotspotRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1e1e3a', borderRadius: 10, padding: 14, marginBottom: 8,
  },
  hotspotInfo: { flex: 1 },
  hotspotLabel: { color: '#fff', fontSize: 15, fontWeight: '500' },
  hotspotCoords: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  hotspotDelete: { fontSize: 18 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#4b5563',
    alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  modalSubtitle: { color: '#9ca3af', fontSize: 13, marginBottom: 16 },
  noTargets: { color: '#4b5563', fontSize: 14, textAlign: 'center', paddingVertical: 20 },
  targetOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#2d2d5e', borderRadius: 12, padding: 14, marginBottom: 8,
  },
  targetThumb: { width: 50, height: 36, borderRadius: 6 },
  targetName: { color: '#fff', fontSize: 16, fontWeight: '500', flex: 1 },
  modalCancelBtn: { padding: 16, alignItems: 'center', marginTop: 4 },
  modalCancelText: { color: '#6b7280', fontSize: 16 },
});
