import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
  ScrollView,
  Image,
  Alert,
  Switch,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import type { CaptureDirection, SceneCaptureSet, SceneMediaType } from '@/src/types/tour';
import { CAPTURE_DIRECTIONS } from '@/src/types/tour';
import { CoverageRing } from '@/src/components/CoverageRing';
import {
  yawDiffDeg,
  normalizeYawDeg,
} from '@/src/utils/sectorCoverage';
import {
  CAPTURE_DIRECTION_HINTS_TR,
  CAPTURE_DIRECTION_LABELS_TR,
  countCaptureShots,
  createEmptyCaptureSet,
  getOrderedCaptureShots,
  isCaptureSetComplete,
} from '@/src/utils/sceneState';

export interface GuidedCapturePayload {
  captureSet: SceneCaptureSet;
  mediaType: SceneMediaType;
}

type Phase = 'level' | 'chooseMode' | 'sweep_photo' | 'sweep_video' | 'review';

interface Props {
  sceneName: string;
  nextSceneName?: string;
  roomProgressLabel?: string;
  existingCapture?: {
    captureSet?: SceneCaptureSet | null;
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

function normalizeCaptureSet(captureSet?: SceneCaptureSet | null): SceneCaptureSet {
  if (!captureSet) {
    return createEmptyCaptureSet();
  }

  return {
    version: 1,
    required_directions: [...CAPTURE_DIRECTIONS],
    shots: { ...captureSet.shots },
    primary_direction: captureSet.primary_direction ?? 'front',
    finalized_at: captureSet.finalized_at ?? null,
  };
}

function getDirectionYaw(direction: CaptureDirection): number | null {
  switch (direction) {
    case 'front':
      return 0;
    case 'right':
      return 90;
    case 'back':
      return 180;
    case 'left':
      return 270;
    default:
      return null;
  }
}

function isDirectionAligned(
  direction: CaptureDirection,
  currentYawRel: number,
  isLevel: boolean,
): boolean {
  if (Platform.OS === 'web') {
    return true;
  }

  const targetYaw = getDirectionYaw(direction);
  if (targetYaw == null) {
    return true;
  }

  return isLevel && yawDiffDeg(currentYawRel, targetYaw) <= 28;
}

function getNextMissingDirection(captureSet: SceneCaptureSet): CaptureDirection | null {
  return CAPTURE_DIRECTIONS.find((direction) => !captureSet.shots[direction]) ?? null;
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

  const resumedCaptureSet = normalizeCaptureSet(existingCapture?.captureSet);
  const shouldResumeCapture =
    countCaptureShots(resumedCaptureSet) > 0 && !isCaptureSetComplete(resumedCaptureSet);

  const [phase, setPhase] = useState<Phase>('level');
  const [captureSet, setCaptureSet] = useState<SceneCaptureSet>(resumedCaptureSet);
  const [capturing, setCapturing] = useState(false);
  const [manualShutter, setManualShutter] = useState(false);

  const [orientation, setOrientation] = useState({ beta: 0, gamma: 0, alpha: 0 });
  const [isLevel, setIsLevel] = useState(false);
  const refAlphaRad = useRef<number | null>(null);
  const alphaLiveRef = useRef(0);
  const autoShutterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const takeDirectionPhotoRef = useRef<() => Promise<void>>(async () => {});

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const currentYawRel =
    refAlphaRad.current != null
      ? relativeYawDeg(alphaLiveRef.current, refAlphaRad.current)
      : 0;

  const captureMask = useMemo(
    () => CAPTURE_DIRECTIONS.map((direction) => !!captureSet.shots[direction]),
    [captureSet],
  );
  const capturedCount = countCaptureShots(captureSet);
  const targetDirection = getNextMissingDirection(captureSet);
  const targetSector = targetDirection ? CAPTURE_DIRECTIONS.indexOf(targetDirection) : null;
  const aligned = targetDirection ? isDirectionAligned(targetDirection, currentYawRel, isLevel) : false;
  const canFinishReview = isCaptureSetComplete(captureSet);

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
      if (autoShutterTimerRef.current) {
        clearTimeout(autoShutterTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (phase === 'sweep_photo' && targetDirection && aligned) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [phase, targetDirection, aligned, pulseAnim]);

  const beginSweepReference = useCallback(() => {
    refAlphaRad.current = alphaLiveRef.current;
  }, []);

  const goChooseMode = () => {
    if (Platform.OS === 'web') {
      setPhase('chooseMode');
      return;
    }
    if (shouldResumeCapture) {
      beginSweepReference();
      setPhase('chooseMode');
      return;
    }
    setPhase('chooseMode');
  };

  const startPhotoSweep = () => {
    beginSweepReference();
    setPhase('sweep_photo');
  };

  const openVideoHelper = () => {
    setPhase('sweep_video');
  };

  const takeDirectionPhoto = async () => {
    if (!cameraRef.current || capturing || !targetDirection) {
      return;
    }

    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!photo?.uri) {
        return;
      }

      setCaptureSet((current) => ({
        ...current,
        shots: {
          ...current.shots,
          [targetDirection]: {
            uri: photo.uri,
            direction: targetDirection,
            captured_at: new Date().toISOString(),
            yawDeg: getDirectionYaw(targetDirection) != null ? currentYawRel : undefined,
            validation: aligned ? 'passed' : 'pending',
          },
        },
        primary_direction: current.primary_direction ?? 'front',
        finalized_at: null,
      }));
    } catch {
      Alert.alert('Hata', 'Fotograf cekilemedi');
    } finally {
      setCapturing(false);
    }
  };

  takeDirectionPhotoRef.current = takeDirectionPhoto;

  useEffect(() => {
    if (
      Platform.OS === 'web' ||
      phase !== 'sweep_photo' ||
      manualShutter ||
      !targetDirection ||
      getDirectionYaw(targetDirection) == null ||
      !aligned ||
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
      void takeDirectionPhotoRef.current();
    }, 750);

    return () => {
      if (autoShutterTimerRef.current) {
        clearTimeout(autoShutterTimerRef.current);
        autoShutterTimerRef.current = null;
      }
    };
  }, [phase, manualShutter, targetDirection, aligned, capturing, cameraReady]);

  useEffect(() => {
    if (phase === 'sweep_photo' && isCaptureSetComplete(captureSet)) {
      setPhase('review');
    }
  }, [phase, captureSet]);

  const finishReview = () => {
    if (!isCaptureSetComplete(captureSet)) {
      Alert.alert('360 tarama eksik', 'Tum yonler tamamlanmadan oda kaydedilemez.');
      return;
    }

    onComplete({
      captureSet: {
        ...captureSet,
        finalized_at: new Date().toISOString(),
      },
      mediaType: 'camera',
    });
  };

  const orderedShots = getOrderedCaptureShots(captureSet);

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
        <Text style={styles.permText}>Kamera erisimi gerekli</Text>
        <TouchableOpacity style={styles.permButton} onPress={requestPermission}>
          <Text style={styles.permButtonText}>Izin Ver</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Geri Don</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
                <Text style={styles.phaseTitle}>1. Cihazi hazirlayin</Text>
                <Text style={styles.phaseBody}>
                  Bu oda icin 6 yon zorunlu: On, Sag, Arka, Sol, Tavan ve Zemin.
                </Text>
                {shouldResumeCapture ? (
                  <Text style={styles.resumeHint}>
                    Bu odada {capturedCount}/{CAPTURE_DIRECTIONS.length} yon mevcut. Eksik yonlerden devam edeceksiniz.
                  </Text>
                ) : null}
                <View style={[styles.levelBadge, isLevel && styles.levelBadgeOk]}>
                  <Text style={styles.levelBadgeText}>
                    {Platform.OS === 'web'
                      ? 'Web: sensor yok, yonleri manuel sirayla cekin'
                      : isLevel
                        ? 'Hazir'
                        : 'Telefonu yatay ve duz tutun'}
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
                <Text style={styles.phaseTitle}>2. Cekim modu</Text>
                <TouchableOpacity style={styles.choiceBtn} onPress={startPhotoSweep}>
                  <Text style={styles.choiceTitle}>Rehberli fotograf</Text>
                  <Text style={styles.choiceSub}>
                    Gercek tur uretimi icin 6 yon fotograf gerekli.
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.choiceBtn} onPress={openVideoHelper}>
                  <Text style={styles.choiceTitle}>Video yardim modu</Text>
                  <Text style={styles.choiceSub}>
                    Uretim kaynagi degil. Yonleri anlamak icin yardimci not ekrani.
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {phase === 'sweep_photo' && (
              <>
                <View style={styles.ringWrap}>
                  <CoverageRing mask={captureMask} activeSector={targetSector} />
                </View>
                <View style={styles.hintContainer}>
                  <Text style={styles.captureProgressText}>
                    {capturedCount}/{CAPTURE_DIRECTIONS.length} yon tamamlandi
                  </Text>
                  <Text style={styles.hintMain}>
                    {targetDirection == null
                      ? 'Tum yonler tamamlandi'
                      : `Hedef: ${CAPTURE_DIRECTION_LABELS_TR[targetDirection]}`}
                  </Text>
                  {targetDirection ? (
                    <Text style={styles.hintSub}>{CAPTURE_DIRECTION_HINTS_TR[targetDirection]}</Text>
                  ) : null}
                  {Platform.OS !== 'web' && targetDirection && getDirectionYaw(targetDirection) != null ? (
                    <Text style={styles.hintSub}>
                      {aligned ? 'Hizali' : 'Daha dogru sonuc icin yone hizalayin'} • Yaw {Math.round(currentYawRel)}°
                    </Text>
                  ) : null}
                  <View style={styles.directionChips}>
                    {CAPTURE_DIRECTIONS.map((direction) => {
                      const shot = captureSet.shots[direction];
                      const active = direction === targetDirection;
                      return (
                        <View
                          key={direction}
                          style={[
                            styles.directionChip,
                            shot && styles.directionChipDone,
                            active && styles.directionChipActive,
                          ]}
                        >
                          <Text style={styles.directionChipText}>{CAPTURE_DIRECTION_LABELS_TR[direction]}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={styles.shutterToggleRow}>
                    <Text style={styles.shutterToggleLabel}>Manuel deklansor</Text>
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
                    <Text style={styles.secondaryBtnText}>Ozet</Text>
                  </TouchableOpacity>
                  <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                    <TouchableOpacity
                      style={[
                        styles.captureBtn,
                        (capturing || !targetDirection) && styles.captureBtnDisabled,
                      ]}
                      onPress={takeDirectionPhoto}
                      disabled={capturing || !targetDirection}
                    >
                      <View style={styles.captureBtnInner} />
                    </TouchableOpacity>
                  </Animated.View>
                  <TouchableOpacity
                    style={styles.secondaryBtn}
                    onPress={() => {
                      beginSweepReference();
                      Alert.alert('Referans', 'On yon referansi sifirlandi.');
                    }}
                  >
                    <Text style={styles.secondaryBtnText}>Sifirla</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {phase === 'sweep_video' && (
              <View style={styles.panel}>
                <Text style={styles.phaseTitle}>Video yardim modu</Text>
                <Text style={styles.phaseBody}>
                  Gercek tur uretimi icin video yeterli degil. Bu surumde 6 yon fotograf zorunlu.
                </Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={startPhotoSweep}>
                  <Text style={styles.primaryBtnText}>Fotograf rehberine gec</Text>
                </TouchableOpacity>
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
            <Text style={styles.reviewTitle}>Ozet — {sceneName}</Text>
            <View style={{ width: 28 }} />
          </View>
          <ScrollView contentContainerStyle={styles.reviewScroll}>
            <CoverageRing mask={captureMask} activeSector={null} />
            <Text style={styles.reviewStats}>
              {canFinishReview
                ? 'Tum yonler kaydedildi. Stitch kuyrugu icin hazir.'
                : `${capturedCount}/${CAPTURE_DIRECTIONS.length} yon tamamlandi`}
            </Text>
            <View style={styles.reviewGrid}>
              {CAPTURE_DIRECTIONS.map((direction) => {
                const shot = captureSet.shots[direction];
                return (
                  <View key={direction} style={styles.reviewCard}>
                    <Text style={styles.reviewCardTitle}>{CAPTURE_DIRECTION_LABELS_TR[direction]}</Text>
                    {shot?.uri ? (
                      <Image source={{ uri: shot.uri }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={styles.reviewMissing}>
                        <Text style={styles.reviewMissingText}>Eksik</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            <View style={styles.reviewActions}>
              {!canFinishReview && (
                <TouchableOpacity
                  style={styles.secondaryBtnWide}
                  onPress={startPhotoSweep}
                >
                  <Text style={styles.secondaryBtnText}>Eksik yonleri cek</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.primaryBtnWide, !canFinishReview && styles.primaryBtnDisabled]}
                onPress={finishReview}
                disabled={!canFinishReview}
              >
                <Text style={styles.primaryBtnText}>
                  {nextSceneName ? 'Kaydet ve sonraki odaya gec' : 'Kaydet ve bitir'}
                </Text>
              </TouchableOpacity>
              {orderedShots.length > 0 ? (
                <Text style={styles.reviewFootnote}>
                  Not: Gercek panorama dosyasi stitch tamamlandiginda uretilecek. Bu adim sadece capture set kaydeder.
                </Text>
              ) : null}
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
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
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
  hintSub: { color: '#9ca3af', fontSize: 12, marginTop: 4, textAlign: 'center' },
  directionChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  directionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  directionChipActive: { backgroundColor: '#6d28d9' },
  directionChipDone: { backgroundColor: '#14532d' },
  directionChipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
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
  reviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 24,
  },
  reviewCard: {
    width: '48%',
    backgroundColor: '#18182d',
    borderRadius: 12,
    padding: 12,
  },
  reviewCardTitle: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  reviewMissing: {
    height: 92,
    borderRadius: 10,
    backgroundColor: '#27273f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewMissingText: { color: '#6b7280', fontSize: 13, fontWeight: '600' },
  thumb: {
    width: '100%',
    height: 92,
    borderRadius: 10,
  },
  reviewActions: { gap: 12 },
  secondaryBtnWide: {
    borderWidth: 1,
    borderColor: '#8b5cf6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  primaryBtnWide: { backgroundColor: '#8b5cf6', borderRadius: 12, padding: 16, alignItems: 'center' },
  reviewFootnote: { color: '#6b7280', fontSize: 12, lineHeight: 18, textAlign: 'center' },
});
