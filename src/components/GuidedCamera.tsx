import { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import type { SceneCaptureSource, SceneMediaType } from '@/src/types/tour';
import { CoverageRing } from '@/src/components/CoverageRing';
import {
  SECTOR_COUNT,
  SECTOR_LABELS_TR,
  emptySectorMask,
  markSector,
  mergeMasks,
  isYawAlignedToSector,
  isFullCoverage,
  missingSectorLabels,
  mapFramesToSectors,
  normalizeYawDeg,
} from '@/src/utils/sectorCoverage';
import { extractFramesAdaptive } from '@/src/utils/videoFrameExtractor';

export interface GuidedCapturePayload {
  primaryUri: string;
  sources: SceneCaptureSource[];
  sectorMask: boolean[];
  mediaType: SceneMediaType;
}

type Phase = 'level' | 'chooseMode' | 'sweep_photo' | 'sweep_video' | 'review';

interface Props {
  sceneName: string;
  nextSceneName?: string;
  onComplete: (payload: GuidedCapturePayload) => void;
  onClose: () => void;
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

function relativeYawDeg(alphaRad: number, refRad: number): number {
  return normalizeYawDeg(radToDeg(alphaRad - refRad));
}

export function GuidedCamera({ sceneName, nextSceneName, onComplete, onClose }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('level');
  const [cameraReady, setCameraReady] = useState(false);

  const [orientation, setOrientation] = useState({ beta: 0, gamma: 0, alpha: 0 });
  const [isLevel, setIsLevel] = useState(false);
  const refAlphaRad = useRef<number | null>(null);
  const alphaLiveRef = useRef(0);

  const [sweepMode, setSweepMode] = useState<'photo' | 'video' | null>(null);
  const [sectorMask, setSectorMask] = useState<boolean[]>(() => emptySectorMask());
  const [sources, setSources] = useState<SceneCaptureSource[]>([]);
  const [primaryUri, setPrimaryUri] = useState<string | null>(null);

  const [capturing, setCapturing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [processingVideo, setProcessingVideo] = useState(false);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const yawSamplesRef = useRef<{ atMs: number; yawRelDeg: number }[]>([]);
  const recordStartRef = useRef(0);
  const yawPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const currentYawRel =
    refAlphaRad.current != null
      ? relativeYawDeg(alphaLiveRef.current, refAlphaRad.current)
      : 0;

  const targetSector = (() => {
    const i = sectorMask.findIndex((v) => !v);
    return i >= 0 ? i : null;
  })();

  useEffect(() => {
    let sub: ReturnType<typeof DeviceMotion.addListener> | null = null;
    const startSensor = async () => {
      if (Platform.OS === 'web') return;
      try {
        const { granted } = await DeviceMotion.requestPermissionsAsync();
        if (!granted) return;
        DeviceMotion.setUpdateInterval(80);
        sub = DeviceMotion.addListener((data) => {
          if (data.rotation) {
            const beta = radToDeg(data.rotation.beta);
            const gamma = radToDeg(data.rotation.gamma);
            const alpha = data.rotation.alpha;
            alphaLiveRef.current = alpha;
            setOrientation({ beta, gamma, alpha });
            setIsLevel(Math.abs(beta) < 14 && Math.abs(gamma - 90) < 18);
          }
        });
      } catch {}
    };
    startSensor();
    return () => {
      sub?.remove();
      if (yawPollRef.current) clearInterval(yawPollRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase === 'sweep_photo' && targetSector != null && isYawAlignedToSector(currentYawRel, targetSector)) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [phase, targetSector, currentYawRel, isLevel]);

  const beginSweepReference = useCallback(() => {
    refAlphaRad.current = alphaLiveRef.current;
    yawSamplesRef.current = [];
    recordStartRef.current = Date.now();
  }, []);

  const goChooseMode = () => {
    if (Platform.OS === 'web') {
      setSweepMode('photo');
      setPhase('sweep_photo');
      refAlphaRad.current = 0;
      return;
    }
    setPhase('chooseMode');
  };

  const pickPhotoSweep = () => {
    setSweepMode('photo');
    beginSweepReference();
    setPhase('sweep_photo');
  };

  const pickVideoSweep = () => {
    setSweepMode('video');
    setPhase('sweep_video');
  };

  const startVideoRecording = async () => {
    if (!cameraRef.current || !cameraReady) return;
    beginSweepReference();
    setIsRecording(true);
    yawPollRef.current = setInterval(() => {
      if (refAlphaRad.current == null) return;
      const y = relativeYawDeg(alphaLiveRef.current, refAlphaRad.current);
      yawSamplesRef.current.push({ atMs: Date.now() - recordStartRef.current, yawRelDeg: y });
    }, 200);

    try {
      recordingPromiseRef.current = cameraRef.current.recordAsync({
        maxDuration: 90_000,
      });
    } catch (e) {
      setIsRecording(false);
      if (yawPollRef.current) clearInterval(yawPollRef.current);
      Alert.alert('Hata', 'Kayıt başlatılamadı');
    }
  };

  const stopVideoRecording = async () => {
    if (yawPollRef.current) {
      clearInterval(yawPollRef.current);
      yawPollRef.current = null;
    }
    cameraRef.current?.stopRecording();
    setIsRecording(false);
    setProcessingVideo(true);
    try {
      const result = await recordingPromiseRef.current;
      recordingPromiseRef.current = null;
      if (!result?.uri) {
        Alert.alert('Uyarı', 'Video kaydı alınamadı');
        setProcessingVideo(false);
        return;
      }
      const frames = await extractFramesAdaptive(result.uri, 16, 90_000);
      const mapped = mapFramesToSectors(
        frames.map((f) => ({ uri: f.uri, timeMs: f.timeMs })),
        yawSamplesRef.current
      );

      const bySector: Record<number, SceneCaptureSource> = {};
      for (const m of mapped) {
        if (!bySector[m.sectorIndex]) {
          bySector[m.sectorIndex] = {
            uri: m.uri,
            yawDeg: m.yawDeg,
            atMs: m.timeMs,
            sectorIndex: m.sectorIndex,
          };
        }
      }

      const newSources = Object.keys(bySector)
        .sort()
        .map((k) => bySector[Number(k)]);

      const newMask = emptySectorMask();
      for (const s of newSources) {
        if (s.sectorIndex != null) newMask[s.sectorIndex] = true;
      }

      setSources((prev) => [...prev, ...newSources]);
      setSectorMask((prev) => mergeMasks(prev, newMask));
      if (!primaryUri && newSources[0]) setPrimaryUri(newSources[0].uri);

      setPhase('review');
    } catch (e) {
      Alert.alert('Hata', 'Video işlenemedi');
    } finally {
      setProcessingVideo(false);
    }
  };

  const takeSectorPhoto = async () => {
    if (!cameraRef.current || capturing || targetSector == null) return;
    if (!isYawAlignedToSector(currentYawRel, targetSector)) {
      Alert.alert('Yön', `${SECTOR_LABELS_TR[targetSector]} yönüne hizalayın`);
      return;
    }
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.88 });
      if (!photo?.uri) return;
      const src: SceneCaptureSource = {
        uri: photo.uri,
        yawDeg: currentYawRel,
        sectorIndex: targetSector,
      };
      setSources((prev) => [...prev, src]);
      setSectorMask((prev) => markSector(prev, targetSector));
      if (!primaryUri) setPrimaryUri(photo.uri);
    } catch (e) {
      Alert.alert('Hata', 'Fotoğraf çekilemedi');
    } finally {
      setCapturing(false);
    }
  };

  const webSingleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.88 });
      if (photo?.uri) {
        const full = Array(SECTOR_COUNT).fill(true) as boolean[];
        onComplete({
          primaryUri: photo.uri,
          sources: [{ uri: photo.uri, sectorIndex: 0 }],
          sectorMask: full,
          mediaType: 'camera',
        });
      }
    } finally {
      setCapturing(false);
    }
  };

  const finishReview = () => {
    const primary = primaryUri ?? sources[0]?.uri;
    if (!primary) {
      Alert.alert('Uyarı', 'En az bir görüntü seçin');
      return;
    }
    const mask = sectorMask.length === SECTOR_COUNT ? sectorMask : emptySectorMask();
    onComplete({
      primaryUri: primary,
      sources: sources.length ? sources : [{ uri: primary }],
      sectorMask: mask,
      mediaType: sweepMode === 'video' ? 'video_frame' : 'camera',
    });
  };

  if (!permission) {
    return (
      <View style={styles.container}>
        <Text style={styles.permText}>Kamera izni kontrol ediliyor...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.permText}>Kamera erişimi gerekli</Text>
        <TouchableOpacity style={styles.permButton} onPress={requestPermission}>
          <Text style={styles.permButtonText}>İzin Ver</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Geri Dön</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const aligned =
    targetSector != null && isYawAlignedToSector(currentYawRel, targetSector);

  return (
    <View style={styles.container}>
      {phase !== 'review' && (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing="back"
          onCameraReady={() => setCameraReady(true)}
        >
          <View style={styles.overlay}>
            <View style={styles.topBar}>
              <TouchableOpacity style={styles.topCloseBtn} onPress={onClose}>
                <Text style={styles.topCloseBtnText}>✕</Text>
              </TouchableOpacity>
              <View style={styles.topInfo}>
                <Text style={styles.topSceneName}>{sceneName}</Text>
                {nextSceneName ? (
                  <Text style={styles.topNextHint}>Sonraki oda: {nextSceneName}</Text>
                ) : null}
              </View>
              <View style={{ width: 36 }} />
            </View>

            {phase === 'level' && (
              <View style={styles.panel}>
                <Text style={styles.phaseTitle}>1. Cihazı hazırlayın</Text>
                <Text style={styles.phaseBody}>
                  Telefonu yatay tutun ve düz çevirin. Yeşil olduğunda devam edin.
                </Text>
                <View style={[styles.levelBadge, isLevel && styles.levelBadgeOk]}>
                  <Text style={styles.levelBadgeText}>
                    {Platform.OS === 'web' ? 'Web: sensör yok, devam edebilirsiniz' : isLevel ? 'Hazır' : 'Hizalanıyor...'}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.primaryBtn, Platform.OS !== 'web' && !isLevel && styles.primaryBtnDisabled]}
                  onPress={goChooseMode}
                  disabled={Platform.OS !== 'web' && !isLevel}
                >
                  <Text style={styles.primaryBtnText}>Devam</Text>
                </TouchableOpacity>
              </View>
            )}

            {phase === 'chooseMode' && (
              <View style={styles.panel}>
                <Text style={styles.phaseTitle}>2. Tarama modu</Text>
                <TouchableOpacity style={styles.choiceBtn} onPress={pickPhotoSweep}>
                  <Text style={styles.choiceTitle}>Fotoğraf ile tarama</Text>
                  <Text style={styles.choiceSub}>Her yöne dönüp kare çekin (6 yön)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.choiceBtn} onPress={pickVideoSweep}>
                  <Text style={styles.choiceTitle}>Video ile tarama</Text>
                  <Text style={styles.choiceSub}>Yavaşça 360° dönün, kaydı durdurun</Text>
                </TouchableOpacity>
              </View>
            )}

            {phase === 'sweep_photo' && Platform.OS === 'web' && (
              <View style={styles.panel}>
                <Text style={styles.phaseTitle}>Tek fotoğraf</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={webSingleCapture} disabled={capturing}>
                  <Text style={styles.primaryBtnText}>{capturing ? '...' : 'Çek'}</Text>
                </TouchableOpacity>
              </View>
            )}

            {phase === 'sweep_photo' && Platform.OS !== 'web' && (
              <>
                <View style={styles.ringWrap}>
                  <CoverageRing mask={sectorMask} activeSector={targetSector} />
                </View>
                <View style={styles.hintContainer}>
                  <Text style={styles.hintMain}>
                    {targetSector == null
                      ? 'Tüm yönler tamam — Özeti açın'
                      : `Hedef: ${SECTOR_LABELS_TR[targetSector]} — ${aligned ? 'Çekin' : 'Yöneyi hizalayın'}`}
                  </Text>
                  <Text style={styles.hintSub}>Göreli yaw: {Math.round(currentYawRel)}°</Text>
                </View>
                <View style={styles.bottomBar}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={() => setPhase('review')}>
                    <Text style={styles.secondaryBtnText}>Özet</Text>
                  </TouchableOpacity>
                  <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                    <TouchableOpacity
                      style={[
                        styles.captureBtn,
                        (capturing || targetSector == null || !aligned) && styles.captureBtnDisabled,
                      ]}
                      onPress={takeSectorPhoto}
                      disabled={capturing || targetSector == null || !aligned}
                    >
                      <View style={styles.captureBtnInner} />
                    </TouchableOpacity>
                  </Animated.View>
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => {
                      beginSweepReference();
                      Alert.alert('Referans', 'Yön sıfırlandı — önden tekrar başlayın');
                    }}
                  >
                    <Text style={styles.secondaryBtnText}>Sıfırla</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {phase === 'sweep_video' && (
              <View style={styles.panel}>
                <Text style={styles.phaseTitle}>Video tarama</Text>
                <Text style={styles.phaseBody}>
                  Kaydı başlatın, yavaşça odanın etrafında 360° dönün, sonra durdurun.
                </Text>
                {processingVideo ? (
                  <ActivityIndicator size="large" color="#8b5cf6" style={{ marginVertical: 20 }} />
                ) : !isRecording ? (
                  <TouchableOpacity style={styles.primaryBtn} onPress={startVideoRecording}>
                    <Text style={styles.primaryBtnText}>Kaydı başlat</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: '#ef4444' }]} onPress={stopVideoRecording}>
                    <Text style={styles.primaryBtnText}>Durdur ve işle</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </CameraView>
      )}

      {phase === 'review' && (
        <View style={styles.reviewFull}>
          <View style={styles.reviewHeader}>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.reviewClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.reviewTitle}>Özet — {sceneName}</Text>
            <View style={{ width: 28 }} />
          </View>
          <ScrollView contentContainerStyle={styles.reviewScroll}>
            <CoverageRing mask={sectorMask} activeSector={null} />
            <Text style={styles.reviewStats}>
              {isFullCoverage(sectorMask)
                ? 'Tüm yönler kaydedildi'
                : `Eksik: ${missingSectorLabels(sectorMask).join(', ') || '—'}`}
            </Text>
            <Text style={styles.reviewLabel}>Ana görüntü (turda gösterilir)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
              {sources.map((s, idx) => (
                <TouchableOpacity key={`${s.uri}-${idx}`} onPress={() => setPrimaryUri(s.uri)}>
                  <Image
                    source={{ uri: s.uri }}
                    style={[styles.thumb, primaryUri === s.uri && styles.thumbSelected]}
                  />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={styles.reviewActions}>
              {sweepMode === 'photo' && !isFullCoverage(sectorMask) && (
                <TouchableOpacity
                  style={styles.secondaryBtnWide}
                  onPress={() => {
                    beginSweepReference();
                    setPhase('sweep_photo');
                  }}
                >
                  <Text style={styles.secondaryBtnText}>Eksikleri çek</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.primaryBtnWide} onPress={finishReview}>
                <Text style={styles.primaryBtnText}>Kaydet ve bitir</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1, width: '100%' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  permText: { color: '#9ca3af', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  permButton: { backgroundColor: '#8b5cf6', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  permButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  closeBtn: { marginTop: 12 },
  closeBtnText: { color: '#8b5cf6', fontSize: 15 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 54 : 36,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  topCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topCloseBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  topInfo: { flex: 1, alignItems: 'center' },
  topSceneName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  topNextHint: { color: '#9ca3af', fontSize: 12, marginTop: 2 },
  panel: {
    marginHorizontal: 16,
    marginBottom: Platform.OS === 'ios' ? 120 : 100,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 16,
    padding: 18,
  },
  phaseTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 8 },
  phaseBody: { color: '#9ca3af', fontSize: 14, lineHeight: 20, marginBottom: 14 },
  levelBadge: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#3f2f2f',
    marginBottom: 14,
  },
  levelBadgeOk: { backgroundColor: '#14532d88' },
  levelBadgeText: { color: '#e5e7eb', textAlign: 'center' },
  primaryBtn: {
    backgroundColor: '#8b5cf6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  choiceBtn: {
    backgroundColor: '#2d2d5e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  choiceTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  choiceSub: { color: '#9ca3af', fontSize: 13, marginTop: 4 },
  ringWrap: { alignItems: 'center', marginTop: 8, marginBottom: 100 },
  hintContainer: { alignItems: 'center', paddingHorizontal: 16 },
  hintMain: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  hintSub: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  secondaryBtn: { padding: 12 },
  secondaryBtnText: { color: '#c4b5fd', fontSize: 14, fontWeight: '600' },
  captureBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureBtnDisabled: { opacity: 0.4 },
  captureBtnInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  reviewFull: { flex: 1, backgroundColor: '#0f0f23' },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 54 : 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  reviewClose: { color: '#fff', fontSize: 22 },
  reviewTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  reviewScroll: { padding: 20, paddingBottom: 48 },
  reviewStats: { color: '#fbbf24', fontSize: 14, textAlign: 'center', marginVertical: 12 },
  reviewLabel: { color: '#9ca3af', fontSize: 13, marginBottom: 8 },
  thumbRow: { flexGrow: 0, marginBottom: 24 },
  thumb: {
    width: 88,
    height: 66,
    borderRadius: 8,
    marginRight: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  thumbSelected: { borderColor: '#8b5cf6' },
  reviewActions: { gap: 12 },
  secondaryBtnWide: {
    borderWidth: 1,
    borderColor: '#8b5cf6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  primaryBtnWide: { backgroundColor: '#8b5cf6', borderRadius: 12, padding: 16, alignItems: 'center' },
});
