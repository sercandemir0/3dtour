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
  Switch,
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
  roomProgressLabel?: string;
  existingCapture?: {
    primaryUri?: string | null;
    sources?: SceneCaptureSource[];
    sectorMask?: boolean[];
    mediaType?: SceneMediaType;
  } | null;
  onComplete: (payload: GuidedCapturePayload) => void;
  onClose: () => void;
}

function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

function relativeYawDeg(alphaRad: number, refRad: number): number {
  return normalizeYawDeg(radToDeg(alphaRad - refRad));
}

function normalizeSectorMask(mask?: boolean[]): boolean[] {
  return Array.from({ length: SECTOR_COUNT }, (_, i) => !!mask?.[i]);
}

function mergeCaptureSources(
  current: SceneCaptureSource[],
  incoming: SceneCaptureSource[],
): SceneCaptureSource[] {
  const bySector = new Map<number, SceneCaptureSource>();
  const withoutSector: SceneCaptureSource[] = [];

  const pushSource = (source: SceneCaptureSource) => {
    if (source.sectorIndex != null) {
      bySector.set(source.sectorIndex, source);
      return;
    }

    if (!withoutSector.some((item) => item.uri === source.uri)) {
      withoutSector.push(source);
    }
  };

  current.forEach(pushSource);
  incoming.forEach(pushSource);

  return [
    ...Array.from(bySector.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, source]) => source),
    ...withoutSector,
  ];
}

export function GuidedCamera({
  sceneName,
  nextSceneName,
  roomProgressLabel,
  existingCapture,
  onComplete,
  onClose,
}: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);

  const resumeMask = normalizeSectorMask(existingCapture?.sectorMask);
  const shouldResumeCapture = resumeMask.some(Boolean) && !isFullCoverage(resumeMask);
  const resumedSources = shouldResumeCapture ? existingCapture?.sources ?? [] : [];
  const resumedPrimaryUri = shouldResumeCapture
    ? existingCapture?.primaryUri ?? resumedSources[0]?.uri ?? null
    : null;

  const [phase, setPhase] = useState<Phase>('level');

  const [orientation, setOrientation] = useState({ beta: 0, gamma: 0, alpha: 0 });
  const [isLevel, setIsLevel] = useState(false);
  const refAlphaRad = useRef<number | null>(null);
  const alphaLiveRef = useRef(0);

  const [sweepMode, setSweepMode] = useState<'photo' | 'video' | null>(
    shouldResumeCapture ? 'photo' : null,
  );
  const [sectorMask, setSectorMask] = useState<boolean[]>(shouldResumeCapture ? resumeMask : emptySectorMask());
  const [sources, setSources] = useState<SceneCaptureSource[]>(resumedSources);
  const [primaryUri, setPrimaryUri] = useState<string | null>(resumedPrimaryUri);

  const [capturing, setCapturing] = useState(false);
  /** When false, aligned hold triggers automatic capture (native photo sweep only). */
  const [manualShutter, setManualShutter] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [processingVideo, setProcessingVideo] = useState(false);
  const recordingPromiseRef = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const yawSamplesRef = useRef<{ atMs: number; yawRelDeg: number }[]>([]);
  const recordStartRef = useRef(0);
  const yawPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoShutterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const takeSectorPhotoRef = useRef<() => Promise<void>>(async () => {});

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const currentYawRel =
    refAlphaRad.current != null
      ? relativeYawDeg(alphaLiveRef.current, refAlphaRad.current)
      : 0;

  const targetSector = (() => {
    const i = sectorMask.findIndex((v) => !v);
    return i >= 0 ? i : null;
  })();

  const aligned =
    targetSector != null && isYawAlignedToSector(currentYawRel, targetSector);

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
      if (autoShutterTimerRef.current) clearTimeout(autoShutterTimerRef.current);
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
    if (shouldResumeCapture) {
      setSweepMode('photo');
      beginSweepReference();
      setPhase('sweep_photo');
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

  const restartVideoSweep = () => {
    yawSamplesRef.current = [];
    recordingPromiseRef.current = null;
    setSweepMode('video');
    setSources([]);
    setSectorMask(emptySectorMask());
    setPrimaryUri(null);
    setPhase('sweep_video');
  };

  const continueWithPhotoSweep = () => {
    setSweepMode('photo');
    beginSweepReference();
    setPhase('sweep_photo');
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

      if (newSources.length === 0) {
        Alert.alert(
          'Tarama tamamlanamadı',
          'Video yön bilgisi çıkarılamadı. Aynı oda için fotoğraf rehberiyle devam edin veya videoyu yeniden çekin.',
        );
        setPhase('review');
        return;
      }

      const newMask = emptySectorMask();
      for (const s of newSources) {
        if (s.sectorIndex != null) newMask[s.sectorIndex] = true;
      }

      setSources((prev) => mergeCaptureSources(prev, newSources));
      const mergedMask = mergeMasks(sectorMask, newMask);
      setSectorMask(mergedMask);
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
      setSources((prev) => mergeCaptureSources(prev, [src]));
      const nextMask = markSector(sectorMask, targetSector);
      setSectorMask(nextMask);
      if (!primaryUri) setPrimaryUri(photo.uri);
      if (isFullCoverage(nextMask)) {
        setTimeout(() => setPhase('review'), 180);
      }
    } catch (e) {
      Alert.alert('Hata', 'Fotoğraf çekilemedi');
    } finally {
      setCapturing(false);
    }
  };

  takeSectorPhotoRef.current = takeSectorPhoto;

  useEffect(() => {
    if (
      Platform.OS === 'web' ||
      phase !== 'sweep_photo' ||
      manualShutter ||
      !aligned ||
      targetSector == null ||
      capturing ||
      !cameraReady
    ) {
      if (autoShutterTimerRef.current) {
        clearTimeout(autoShutterTimerRef.current);
        autoShutterTimerRef.current = null;
      }
      return;
    }
    autoShutterTimerRef.current = setTimeout(() => {
      autoShutterTimerRef.current = null;
      void takeSectorPhotoRef.current();
    }, 750);
    return () => {
      if (autoShutterTimerRef.current) {
        clearTimeout(autoShutterTimerRef.current);
        autoShutterTimerRef.current = null;
      }
    };
  }, [phase, manualShutter, aligned, targetSector, capturing, cameraReady]);

  const webSingleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.88 });
      if (photo?.uri) {
        onComplete({
          primaryUri: photo.uri,
          sources: [{ uri: photo.uri }],
          sectorMask: emptySectorMask(),
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
    const hasGuidedCoverage = mask.some(Boolean);
    if (Platform.OS !== 'web' && hasGuidedCoverage && !isFullCoverage(mask)) {
      Alert.alert(
        '360° tarama eksik',
        'Kaydetmeden önce eksik yönleri tamamlayın veya videoyu yeniden çekin.',
      );
      return;
    }
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

  const capturedCount = sectorMask.filter(Boolean).length;
  const hasPrimary = !!(primaryUri ?? sources[0]?.uri);
  const canFinishReview =
    hasPrimary && (Platform.OS === 'web' || !sectorMask.some(Boolean) || isFullCoverage(sectorMask));

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
                {roomProgressLabel ? (
                  <Text style={styles.topProgressLabel}>{roomProgressLabel}</Text>
                ) : null}
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
                {shouldResumeCapture ? (
                  <Text style={styles.resumeHint}>
                    Bu odada {resumeMask.filter(Boolean).length}/{SECTOR_COUNT} yön kayıtlı. Eksik yönlerden devam edeceksiniz.
                  </Text>
                ) : null}
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
                  <Text style={styles.choiceSub}>
                    Her yöne hizalayın; sabit tutunca otomatik kare (veya manuel deklanşör)
                  </Text>
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
                  <Text style={styles.captureProgressText}>
                    {capturedCount}/{SECTOR_COUNT} yön tamamlandı
                  </Text>
                  <Text style={styles.hintMain}>
                    {targetSector == null
                      ? 'Tüm yönler tamam — Özeti açın'
                      : `Hedef: ${SECTOR_LABELS_TR[targetSector]} — ${
                          aligned
                            ? manualShutter
                              ? 'Çekin'
                              : 'Sabit tutun — otomatik çekilecek'
                            : 'Yönü hizalayın'
                        }`}
                  </Text>
                  <Text style={styles.hintSub}>Göreli yaw: {Math.round(currentYawRel)}°</Text>
                  <View style={styles.shutterToggleRow}>
                    <Text style={styles.shutterToggleLabel}>Manuel deklanşör</Text>
                    <Switch
                      value={manualShutter}
                      onValueChange={setManualShutter}
                      trackColor={{ false: '#4b5563', true: '#6d28d9' }}
                      thumbColor={manualShutter ? '#e9d5ff' : '#9ca3af'}
                    />
                  </View>
                </View>
                <View style={styles.bottomBar}>
                  <TouchableOpacity
                    style={[styles.secondaryBtn, capturedCount === 0 && styles.secondaryBtnDisabled]}
                    onPress={() => setPhase('review')}
                    disabled={capturedCount === 0}
                  >
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
              {sweepMode === 'photo' && !canFinishReview && (
                <TouchableOpacity
                  style={styles.secondaryBtnWide}
                  onPress={continueWithPhotoSweep}
                >
                  <Text style={styles.secondaryBtnText}>Eksikleri çek</Text>
                </TouchableOpacity>
              )}
              {sweepMode === 'video' && !canFinishReview ? (
                <>
                  <TouchableOpacity style={styles.secondaryBtnWide} onPress={continueWithPhotoSweep}>
                    <Text style={styles.secondaryBtnText}>Eksikleri fotoğrafla tamamla</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.secondaryBtnWide} onPress={restartVideoSweep}>
                    <Text style={styles.secondaryBtnText}>Videoyu yeniden çek</Text>
                  </TouchableOpacity>
                </>
              ) : null}
              <TouchableOpacity
                style={[styles.primaryBtnWide, !canFinishReview && styles.primaryBtnDisabled]}
                onPress={finishReview}
                disabled={!canFinishReview}
              >
                <Text style={styles.primaryBtnText}>
                  {nextSceneName ? 'Kaydet ve sonraki odaya geç' : 'Kaydet ve bitir'}
                </Text>
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
  topProgressLabel: { color: '#c4b5fd', fontSize: 11, fontWeight: '700', marginBottom: 2 },
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
  resumeHint: { color: '#c4b5fd', fontSize: 13, lineHeight: 18, marginBottom: 10 },
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
  captureProgressText: { color: '#c4b5fd', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  hintMain: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  hintSub: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  shutterToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 12,
  },
  shutterToggleLabel: { color: '#9ca3af', fontSize: 13 },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  secondaryBtn: { padding: 12 },
  secondaryBtnDisabled: { opacity: 0.35 },
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
