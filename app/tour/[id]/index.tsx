import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTourStore } from '@/src/stores/tourStore';
import { TourProgress } from '@/src/components/TourProgress';
import { VideoFramePicker } from '@/src/components/VideoFramePicker';
import type { Scene } from '@/src/types/tour';
import { getCoverageSummary, SECTOR_COUNT } from '@/src/utils/sectorCoverage';

const MODE_LABELS: Record<string, string> = {
  panorama: '360° Panorama',
  gaussian_splat: '3D Splat',
  roomplan: 'RoomPlan',
};

function SceneCard({
  scene,
  onCapture,
  onPreview,
}: {
  scene: Scene;
  onCapture: () => void;
  onPreview: () => void;
}) {
  const hasMedia = !!scene.panorama_url;
  const cov = getCoverageSummary(scene);

  return (
    <TouchableOpacity
      style={styles.sceneCard}
      onPress={hasMedia ? onPreview : onCapture}
      activeOpacity={0.7}
    >
      {hasMedia ? (
        <Image
          source={{ uri: scene.thumbnail_url ?? scene.panorama_url ?? '' }}
          style={styles.sceneThumbnail}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.scenePlaceholder}>
          <Text style={styles.scenePlaceholderIcon}>📷</Text>
          <Text style={styles.scenePlaceholderLabel}>Çekim bekliyor</Text>
        </View>
      )}
      <View style={styles.sceneCardFooter}>
        <View style={[styles.statusDot, hasMedia ? styles.statusDone : styles.statusEmpty]} />
        <Text style={styles.sceneName} numberOfLines={1}>{scene.name}</Text>
      </View>
      {hasMedia && cov.hasGuidedData && (
        <View style={styles.coverageBadge}>
          <Text
            style={[
              styles.coverageBadgeText,
              cov.incomplete ? styles.coverageBadgeWarn : styles.coverageBadgeOk,
            ]}
          >
            {cov.incomplete
              ? `360° ${cov.filled}/${SECTOR_COUNT}`
              : `360° ✓`}
          </Text>
        </View>
      )}
      {!hasMedia && (
        <View style={styles.captureOverlay}>
          <Text style={styles.captureOverlayText}>Çek</Text>
        </View>
      )}
      {hasMedia && (
        <TouchableOpacity style={styles.recaptureBtn} onPress={onCapture} hitSlop={8}>
          <Text style={styles.recaptureBtnText}>↻</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

type CaptureOption = 'camera' | 'gallery_photo' | 'gallery_video';

export default function TourDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    currentTour, loading, fetchTour,
    addScene, setSceneMedia, deleteTour,
    getCompletedCount,
  } = useTourStore();

  const [captureModalScene, setCaptureModalScene] = useState<Scene | null>(null);
  const [busy, setBusy] = useState(false);
  const [videoPickerData, setVideoPickerData] = useState<{ sceneId: string; uri: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (id) fetchTour(id);
  }, [id]);

  const handleCaptureOption = async (scene: Scene, option: CaptureOption) => {
    setCaptureModalScene(null);
    setBusy(true);

    try {
      if (option === 'camera') {
        router.push(`/tour/${id}/camera?sceneId=${scene.id}&sceneName=${encodeURIComponent(scene.name)}`);
        setBusy(false);
        return;
      }

      if (option === 'gallery_photo') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('İzin gerekli', 'Galeri erişim izni verin.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 1,
        });
        if (!result.canceled && result.assets[0]) {
          await setSceneMedia(scene.id, result.assets[0].uri, 'photo');
          await fetchTour(id!);
        }
        return;
      }

      if (option === 'gallery_video') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('İzin gerekli', 'Galeri erişim izni verin.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['videos'],
          quality: 1,
        });
        if (!result.canceled && result.assets[0]) {
          setVideoPickerData({ sceneId: scene.id, uri: result.assets[0].uri });
        }
        return;
      }
    } catch (e: any) {
      Alert.alert('Hata', e.message ?? 'İşlem başarısız');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkGallery = async () => {
    if (!currentTour) return;
    const emptyScenes = (currentTour.scenes ?? []).filter((s) => !s.panorama_url);
    if (emptyScenes.length === 0) {
      Alert.alert('Bilgi', 'Tüm odalara zaten medya eklenmiş.');
      return;
    }

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('İzin gerekli', 'Galeri erişim izni verin.');
      return;
    }

    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: true,
        selectionLimit: emptyScenes.length,
        orderedSelection: true,
      });

      if (result.canceled || !result.assets.length) return;

      for (let i = 0; i < Math.min(result.assets.length, emptyScenes.length); i++) {
        await setSceneMedia(emptyScenes[i].id, result.assets[i].uri, 'photo');
      }
      await fetchTour(currentTour.id);
    } catch (e: any) {
      Alert.alert('Hata', e.message ?? 'Toplu yükleme başarısız');
    } finally {
      setBusy(false);
    }
  };

  const handleAddRoom = async () => {
    if (!currentTour) return;
    const sceneType = currentTour.capture_mode === 'gaussian_splat'
      ? 'gaussian_splat' as const
      : currentTour.capture_mode === 'roomplan'
        ? 'roomplan' as const
        : 'panorama' as const;

    if (typeof Alert.prompt === 'function') {
      Alert.prompt(
        'Yeni Oda',
        'Oda adini girin',
        async (name) => {
          if (!name?.trim()) return;
          await addScene(currentTour.id, name.trim(), sceneType);
          await fetchTour(currentTour.id);
        },
      );
    } else {
      const defaultName = `Oda ${(currentTour.scenes?.length ?? 0) + 1}`;
      await addScene(currentTour.id, defaultName, sceneType);
      await fetchTour(currentTour.id);
    }
  };

  const handleDelete = () => {
    Alert.alert('Tur Sil', 'Bu turu silmek istediğinizden emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
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
      Alert.alert('Uyarı', 'Turu görüntülemek için en az bir odanın fotoğrafını çekin.');
    }
  };

  const handleEditHotspots = () => {
    router.push(`/tour/${id}/hotspots`);
  };

  if (loading || !currentTour) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#8b5cf6" />
      </View>
    );
  }

  const scenes = currentTour.scenes ?? [];
  const { completed, total } = getCompletedCount(currentTour.id);
  const allDone = completed === total && total > 0;
  const coverageIncompleteCount = scenes.filter((s) => {
    const g = getCoverageSummary(s);
    return g.hasGuidedData && g.incomplete;
  }).length;

  return (
    <>
      <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{currentTour.title}</Text>
          <View style={styles.modeBadge}>
            <Text style={styles.modeBadgeText}>{MODE_LABELS[currentTour.capture_mode]}</Text>
          </View>
        </View>

        {currentTour.description ? (
          <Text style={styles.description}>{currentTour.description}</Text>
        ) : null}

        <TourProgress
          completed={completed}
          total={total}
          onPressIncomplete={() => {
            const firstEmpty = scenes.findIndex((s) => !s.panorama_url);
            if (firstEmpty >= 0) setCaptureModalScene(scenes[firstEmpty]);
          }}
          coverageHint={
            coverageIncompleteCount > 0
              ? `${coverageIncompleteCount} odada 360° kapsam eksik — kamera ile tamamlayın`
              : null
          }
        />

        <View style={styles.actions}>
          <TouchableOpacity style={styles.viewButton} onPress={handleViewTour} activeOpacity={0.8}>
            <Text style={styles.viewButtonText}>▶ Turu Görüntüle</Text>
          </TouchableOpacity>
          {allDone && (
            <TouchableOpacity
              style={styles.hotspotButton}
              onPress={handleEditHotspots}
              activeOpacity={0.8}
            >
              <Text style={styles.hotspotButtonText}>🔗 Hotspot</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.deleteButton} onPress={handleDelete} activeOpacity={0.8}>
            <Text style={styles.deleteButtonText}>🗑</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.scenesHeader}>
          <Text style={styles.sectionTitle}>Odalar ({scenes.length})</Text>
        </View>

        {scenes.length === 0 ? (
          <View style={styles.emptyScenes}>
            <Text style={styles.emptyScenesText}>
              Henüz oda tanımlanmamış. "+" ile oda ekleyin veya turu yeniden oluşturun.
            </Text>
          </View>
        ) : (
          <View style={styles.scenesGrid}>
            {scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                onCapture={() => setCaptureModalScene(scene)}
                onPreview={() => {
                  const idx = scenes.filter((s) => s.panorama_url).findIndex((s) => s.id === scene.id);
                  if (idx >= 0) router.push(`/tour/${id}/viewer?startScene=${idx}`);
                }}
              />
            ))}
          </View>
        )}

        <View style={styles.bottomActions}>
          <TouchableOpacity
            style={styles.bulkButton}
            onPress={handleBulkGallery}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={styles.bulkButtonText}>
              {busy ? 'Yükleniyor...' : '🖼 Eksiklere toplu fotoğraf ata'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.addRoomBtn}
            onPress={handleAddRoom}
            activeOpacity={0.8}
          >
            <Text style={styles.addRoomBtnText}>+ Yeni oda ekle</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Video frame picker */}
      <VideoFramePicker
        videoUri={videoPickerData?.uri ?? ''}
        visible={!!videoPickerData}
        onSelectFrame={async (frameUri) => {
          if (videoPickerData) {
            await setSceneMedia(videoPickerData.sceneId, frameUri, 'video_frame');
            await fetchTour(id!);
          }
          setVideoPickerData(null);
        }}
        onCancel={() => setVideoPickerData(null)}
      />

      {/* Capture option modal */}
      <Modal
        visible={!!captureModalScene}
        transparent
        animationType="slide"
        onRequestClose={() => setCaptureModalScene(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setCaptureModalScene(null)}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {captureModalScene?.name ?? 'Oda'} — Çekim Yöntemi
            </Text>

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => captureModalScene && handleCaptureOption(captureModalScene, 'camera')}
            >
              <Text style={styles.modalOptionIcon}>📸</Text>
              <View style={styles.modalOptionContent}>
                <Text style={styles.modalOptionTitle}>Kamera ile Çek</Text>
                <Text style={styles.modalOptionSub}>Rehberli 360° çekim</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => captureModalScene && handleCaptureOption(captureModalScene, 'gallery_photo')}
            >
              <Text style={styles.modalOptionIcon}>🖼</Text>
              <View style={styles.modalOptionContent}>
                <Text style={styles.modalOptionTitle}>Galeriden Fotoğraf</Text>
                <Text style={styles.modalOptionSub}>Mevcut panoramik fotoğraf seçin</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalOption}
              onPress={() => captureModalScene && handleCaptureOption(captureModalScene, 'gallery_video')}
            >
              <Text style={styles.modalOptionIcon}>🎬</Text>
              <View style={styles.modalOptionContent}>
                <Text style={styles.modalOptionTitle}>Video Yükle</Text>
                <Text style={styles.modalOptionSub}>Videodan sahne oluşturun</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancel}
              onPress={() => setCaptureModalScene(null)}
            >
              <Text style={styles.modalCancelText}>İptal</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f0f23' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '700', color: '#fff', flex: 1 },
  modeBadge: { backgroundColor: '#8b5cf633', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  modeBadgeText: { color: '#8b5cf6', fontSize: 12, fontWeight: '600' },
  description: { fontSize: 15, color: '#9ca3af', marginBottom: 16, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 10, marginVertical: 16 },
  viewButton: { flex: 1, backgroundColor: '#8b5cf6', borderRadius: 12, padding: 14, alignItems: 'center' },
  viewButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  hotspotButton: { backgroundColor: '#2d2d5e', borderRadius: 12, padding: 14, paddingHorizontal: 16 },
  hotspotButtonText: { color: '#c4b5fd', fontSize: 14, fontWeight: '600' },
  deleteButton: { backgroundColor: '#ef444433', borderRadius: 12, padding: 14, paddingHorizontal: 18, justifyContent: 'center' },
  deleteButtonText: { fontSize: 18 },
  scenesHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 },
  emptyScenes: { backgroundColor: '#1e1e3a', borderRadius: 14, padding: 24, alignItems: 'center' },
  emptyScenesText: { color: '#6b7280', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  scenesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  sceneCard: {
    width: '47%' as any, backgroundColor: '#1e1e3a', borderRadius: 12, overflow: 'hidden',
  },
  sceneThumbnail: { width: '100%', height: 110 },
  scenePlaceholder: {
    width: '100%', height: 110, backgroundColor: '#2d2d5e',
    justifyContent: 'center', alignItems: 'center', gap: 4,
  },
  scenePlaceholderIcon: { fontSize: 28 },
  scenePlaceholderLabel: { color: '#6b7280', fontSize: 11 },
  sceneCardFooter: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDone: { backgroundColor: '#34d399' },
  statusEmpty: { backgroundColor: '#ef4444' },
  sceneName: { color: '#fff', fontSize: 14, fontWeight: '500', flex: 1 },
  coverageBadge: {
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  coverageBadgeText: { fontSize: 11, fontWeight: '600' },
  coverageBadgeWarn: { color: '#fbbf24' },
  coverageBadgeOk: { color: '#34d399' },
  captureOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 110,
    backgroundColor: 'rgba(139,92,246,0.15)', justifyContent: 'center', alignItems: 'center',
  },
  captureOverlayText: { color: '#c4b5fd', fontSize: 15, fontWeight: '700' },
  recaptureBtn: {
    position: 'absolute', top: 6, right: 6,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center',
  },
  recaptureBtnText: { color: '#fff', fontSize: 16 },
  bottomActions: { marginTop: 20, gap: 10 },
  bulkButton: {
    backgroundColor: '#1e1e3a', borderRadius: 12, padding: 16, alignItems: 'center',
    borderWidth: 1, borderColor: '#8b5cf644', borderStyle: 'dashed',
  },
  bulkButtonText: { color: '#8b5cf6', fontSize: 15, fontWeight: '600' },
  addRoomBtn: {
    backgroundColor: '#1e1e3a', borderRadius: 12, padding: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#2d2d5e',
  },
  addRoomBtnText: { color: '#9ca3af', fontSize: 14, fontWeight: '500' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12,
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#4b5563',
    alignSelf: 'center', marginBottom: 16,
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 20 },
  modalOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#2d2d5e', borderRadius: 14, padding: 16, marginBottom: 10,
  },
  modalOptionIcon: { fontSize: 28 },
  modalOptionContent: { flex: 1 },
  modalOptionTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalOptionSub: { color: '#9ca3af', fontSize: 13, marginTop: 2 },
  modalCancel: { padding: 16, alignItems: 'center', marginTop: 4 },
  modalCancelText: { color: '#6b7280', fontSize: 16 },
});
