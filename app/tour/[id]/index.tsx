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
import {
  getCaptureSessionBadgeText,
  getSceneCaptureStatus,
  getSceneStatus,
  getSceneThumbnailUri,
  getSceneViewerMode,
  isSceneViewable,
} from '@/src/utils/sceneState';

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
  const hasMedia = isSceneViewable(scene);
  const status = getSceneStatus(scene);
  const captureStatus = getSceneCaptureStatus(scene);
  const previewSource = getSceneThumbnailUri(scene);
  const completedCaptureCount = scene.capture_set
    ? Object.values(scene.capture_set.shots).filter(Boolean).length
    : 0;
  const sessionBadge = getCaptureSessionBadgeText(scene);

  return (
    <TouchableOpacity
      style={styles.sceneCard}
      onPress={hasMedia ? onPreview : onCapture}
      activeOpacity={0.7}
    >
      {hasMedia ? (
        <Image
          source={{ uri: previewSource ?? '' }}
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
      {(sessionBadge || scene.capture_set) ? (
        <View style={styles.coverageBadge}>
          <Text
            style={[
              styles.coverageBadgeText,
              captureStatus !== 'complete' ? styles.coverageBadgeWarn : styles.coverageBadgeOk,
            ]}
          >
            {sessionBadge
              ? sessionBadge + (captureStatus === 'complete' ? ' ✓' : '')
              : captureStatus === 'complete'
                ? '6/6 yön'
                : `${completedCaptureCount}/6 yön`}
          </Text>
        </View>
      ) : null}
      {status === 'ready_for_stitch' ? (
        <View style={styles.processingBadge}>
          <Text style={styles.processingBadgeText}>ready for stitch</Text>
        </View>
      ) : null}
      {status === 'processing' ? (
        <View style={styles.processingBadge}>
          <Text style={styles.processingBadgeText}>stitch queue</Text>
        </View>
      ) : null}
      {status === 'failed' ? (
        <View style={[styles.processingBadge, styles.processingBadgeFailed]}>
          <Text style={styles.processingBadgeText}>stitch fail</Text>
        </View>
      ) : null}
      {status === 'stitched' ? (
        <View style={[styles.processingBadge, styles.processingBadgeSuccess]}>
          <Text style={styles.processingBadgeText}>stitched</Text>
        </View>
      ) : null}
      {status === 'legacy_ready' ? (
        <View style={[styles.processingBadge, styles.processingBadgeLegacy]}>
          <Text style={styles.processingBadgeText}>legacy pano</Text>
        </View>
      ) : null}
      {!hasMedia && (
        <View style={styles.captureOverlay}>
          <Text style={styles.captureOverlayText}>Çek</Text>
        </View>
      )}
      {hasMedia && (
        <TouchableOpacity style={styles.recaptureBtn} onPress={onCapture} hitSlop={8}>
          <Text style={styles.recaptureBtnText}>
            {captureStatus !== 'complete' ? '→' : '↻'}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

export default function TourDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const {
    currentTour, loading, fetchTour,
    addScene, setSceneMedia, deleteTour, reconcileTourProcessing,
    getCompletedCount,
  } = useTourStore();

  const [galleryModal, setGalleryModal] = useState<
    null | { step: 'rooms' } | { step: 'kind'; scene: Scene }
  >(null);
  const [busy, setBusy] = useState(false);
  const [videoPickerData, setVideoPickerData] = useState<{ sceneId: string; uri: string } | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (id) fetchTour(id);
  }, [id]);

  useEffect(() => {
    if (!currentTour?.id) {
      return;
    }

    const hasPendingRemoteJobs = (currentTour.scenes ?? []).some((scene) => {
      const job = scene.processing_job;
      return (
        job != null &&
        (job.status === 'pending' || job.status === 'processing')
      );
    });

    if (!hasPendingRemoteJobs) {
      return;
    }

    void reconcileTourProcessing(currentTour.id);
    const timer = setInterval(() => {
      void reconcileTourProcessing(currentTour.id);
    }, 5000);

    return () => clearInterval(timer);
  }, [currentTour, reconcileTourProcessing]);

  const openGuidedCamera = (scene: Scene) => {
    router.push(
      `/tour/${id}/camera?sceneId=${scene.id}&sceneName=${encodeURIComponent(scene.name)}`,
    );
  };

  const handleGalleryPhoto = async (scene: Scene) => {
    setGalleryModal(null);
    setBusy(true);
    try {
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
    } catch (e: any) {
      Alert.alert('Hata', e.message ?? 'İşlem başarısız');
    } finally {
      setBusy(false);
    }
  };

  const handleGalleryVideo = async (scene: Scene) => {
    setGalleryModal(null);
    setBusy(true);
    try {
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
    } catch (e: any) {
      Alert.alert('Hata', e.message ?? 'İşlem başarısız');
    } finally {
      setBusy(false);
    }
  };

  const openLegacyGallery = () => {
    if (!currentTour) return;
    const list = currentTour.scenes ?? [];
    if (list.length === 0) {
      Alert.alert('Bilgi', 'Önce bir görünüm ekleyin.');
      return;
    }
    if (list.length === 1) {
      setGalleryModal({ step: 'kind', scene: list[0] });
      return;
    }
    setGalleryModal({ step: 'rooms' });
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
        'Yeni görünüm',
        'Görünüm adını girin',
        async (name) => {
          if (!name?.trim()) return;
          await addScene(currentTour.id, name.trim(), sceneType);
          await fetchTour(currentTour.id);
        },
      );
    } else {
      const defaultName = `Görünüm ${(currentTour.scenes?.length ?? 0) + 1}`;
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
    if (currentTour?.scenes?.some((scene) => isSceneViewable(scene))) {
      router.push(`/tour/${id}/viewer`);
    } else {
      Alert.alert('Uyarı', 'Turu görüntülemek için önce bir sahneyi tamamlayın veya legacy panorama içe aktarın.');
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
  const coverageIncompleteCount = scenes.filter((scene) => getSceneCaptureStatus(scene) === 'partial').length;
  const allDone = scenes.length > 0 && scenes.every((scene) => {
    const status = getSceneStatus(scene);
    return status === 'stitched' || status === 'legacy_ready' || status === 'ready_for_stitch';
  });

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
            const firstEmpty = scenes.find((scene) => getSceneViewerMode(scene) === 'none');
            if (firstEmpty) {
              openGuidedCamera(firstEmpty);
              return;
            }
            const covInc = scenes.find((scene) => getSceneCaptureStatus(scene) === 'partial');
            if (covInc) openGuidedCamera(covInc);
          }}
          coverageHint={
            coverageIncompleteCount > 0
              ? `${coverageIncompleteCount} görünümde 360° kapsam eksik — kamera ile tamamlayın`
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
          <Text style={styles.sectionTitle}>Görünümler ({scenes.length})</Text>
        </View>

        {scenes.length === 0 ? (
          <View style={styles.emptyScenes}>
            <Text style={styles.emptyScenesText}>
              Henüz görünüm yok. Aşağıdan yeni görünüm ekleyebilirsiniz.
            </Text>
          </View>
        ) : (
          <View style={styles.scenesGrid}>
            {scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                onCapture={() => openGuidedCamera(scene)}
                onPreview={() => {
                  const idx = scenes.filter((item) => isSceneViewable(item)).findIndex((item) => item.id === scene.id);
                  if (idx >= 0) router.push(`/tour/${id}/viewer?startScene=${idx}`);
                }}
              />
            ))}
          </View>
        )}

        <View style={styles.bottomActions}>
          <TouchableOpacity
            style={styles.galleryImportLink}
            onPress={openLegacyGallery}
            activeOpacity={0.7}
          >
            <Text style={styles.galleryImportLinkText}>Galeriden legacy panorama içe aktar</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.addRoomBtn}
            onPress={handleAddRoom}
            activeOpacity={0.8}
          >
            <Text style={styles.addRoomBtnText}>+ Yeni görünüm ekle</Text>
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

      {/* Galeri içe aktarma: önce oda, sonra tür */}
      <Modal
        visible={galleryModal != null}
        transparent
        animationType="slide"
        onRequestClose={() => setGalleryModal(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setGalleryModal(null)}
        >
          <TouchableOpacity activeOpacity={1} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              {galleryModal?.step === 'rooms' && (
                <>
                  <Text style={styles.modalTitle}>Hangi görünüme?</Text>
                  <Text style={styles.modalSubtitle}>
                    Rehberli çekim için karttan başlayın. Bu akış tek dosyalık legacy panorama içe aktarımı içindir.
                  </Text>
                  <ScrollView style={styles.roomPickList} nestedScrollEnabled>
                    {scenes.map((s) => (
                      <TouchableOpacity
                        key={s.id}
                        style={styles.roomPickRow}
                        onPress={() => setGalleryModal({ step: 'kind', scene: s })}
                      >
                        <Text style={styles.roomPickName}>{s.name}</Text>
                        <Text style={styles.roomPickArrow}>›</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </>
              )}
              {galleryModal?.step === 'kind' && (
                <>
                  <Text style={styles.modalTitle}>{galleryModal.scene.name}</Text>
                  <Text style={styles.modalSubtitle}>İçe aktarma türü</Text>
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => handleGalleryPhoto(galleryModal.scene)}
                  >
                    <Text style={styles.modalOptionIcon}>🖼</Text>
                    <View style={styles.modalOptionContent}>
                      <Text style={styles.modalOptionTitle}>Fotoğraf seç</Text>
                      <Text style={styles.modalOptionSub}>Hazir panorama veya legacy tek gorsel</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalOption}
                    onPress={() => handleGalleryVideo(galleryModal.scene)}
                  >
                    <Text style={styles.modalOptionIcon}>🎬</Text>
                    <View style={styles.modalOptionContent}>
                      <Text style={styles.modalOptionTitle}>Video seç</Text>
                      <Text style={styles.modalOptionSub}>Yalniz legacy kare import icin</Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalBack}
                    onPress={() => setGalleryModal({ step: 'rooms' })}
                  >
                    <Text style={styles.modalBackText}>← Görünüm listesine dön</Text>
                  </TouchableOpacity>
                </>
              )}
              <TouchableOpacity style={styles.modalCancel} onPress={() => setGalleryModal(null)}>
                <Text style={styles.modalCancelText}>Kapat</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
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
  processingBadge: {
    marginHorizontal: 10,
    marginBottom: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#2563eb33',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  processingBadgeFailed: {
    backgroundColor: '#ef444433',
  },
  processingBadgeSuccess: {
    backgroundColor: '#14532d88',
  },
  processingBadgeLegacy: {
    backgroundColor: '#4b556333',
  },
  processingBadgeText: {
    color: '#bfdbfe',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
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
  galleryImportLink: { paddingVertical: 12, alignItems: 'center' },
  galleryImportLinkText: { color: '#8b5cf6', fontSize: 15, fontWeight: '600' },
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
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalSubtitle: { color: '#9ca3af', fontSize: 13, lineHeight: 18, marginBottom: 16 },
  roomPickList: { maxHeight: 280, marginBottom: 8 },
  roomPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#2d2d5e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  roomPickName: { color: '#fff', fontSize: 15, fontWeight: '500', flex: 1 },
  roomPickArrow: { color: '#6b7280', fontSize: 20, marginLeft: 8 },
  modalBack: { paddingVertical: 12, alignItems: 'center', marginBottom: 4 },
  modalBackText: { color: '#8b5cf6', fontSize: 14, fontWeight: '600' },
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
