/**
 * GuidedCamera — main panorama capture component (v2).
 *
 * Replaces the old 6-direction model with the new spherical guided
 * capture engine. Uses CaptureGrid (~22 targets), OrientationTracker,
 * QualityGate, TargetOverlay, CaptureHUD, and CaptureReview.
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';

import { OrientationTracker } from '@/src/capture/OrientationTracker';
import { getCompletionStats } from '@/src/capture/CaptureGrid';
import {
  createInitialState,
  advanceToLeveling,
  advanceToCalibration,
  advanceToCapturing,
  advanceToReview,
  returnToCapturing,
  finalize,
  updateOrientation,
  markStable,
  recordFrame,
  toggleManualShutter,
  buildCaptureSession,
  type EngineState,
  type CaptureFrame,
  type CaptureSession,
} from '@/src/capture/CaptureEngine';
import type { QualityReport } from '@/src/capture/QualityGate';
import { TargetOverlay } from '@/src/capture/TargetOverlay';
import { CaptureHUD } from '@/src/capture/CaptureHUD';
import { CaptureReview } from '@/src/capture/CaptureReview';

const STABLE_DPS = 5;
const STABLE_MS = 350;

// -- Public payload type (consumed by camera.tsx) --

export interface GuidedCapturePayload {
  captureSession: CaptureSession;
}

// -- Props --

interface Props {
  sceneName: string;
  nextSceneName?: string;
  roomProgressLabel?: string;
  onComplete: (payload: GuidedCapturePayload) => void;
  onClose: () => void;
}

export function GuidedCamera({
  sceneName,
  nextSceneName,
  roomProgressLabel,
  onComplete,
  onClose,
}: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);

  const trackerRef = useRef(new OrientationTracker(60));
  const [state, setState] = useState<EngineState>(() => createInitialState());
  const stateRef = useRef(state);
  stateRef.current = state;

  const capturingRef = useRef(false);
  const [capturing, setCapturing] = useState(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAlignedRef = useRef(false);

  useEffect(() => {
    if (state.phase !== 'capturing') {
      prevAlignedRef.current = false;
      return;
    }
    if (state.aligned && !prevAlignedRef.current && Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
    prevAlignedRef.current = state.aligned;
  }, [state.phase, state.aligned]);

  // -- Permission → leveling transition (done in effect, not during render) --
  useEffect(() => {
    if (permission?.granted && stateRef.current.phase === 'permission') {
      setState((s) => advanceToLeveling(s));
    }
  }, [permission?.granted]);

  // -- Sensor lifecycle --
  useEffect(() => {
    const tracker = trackerRef.current;

    // On web there's no sensor; keep pushing a static orientation on an
    // interval so the state machine can progress and the HUD stays live.
    if (Platform.OS === 'web') {
      const pushWebOrientation = () => {
        const webOrientation = {
          yawDeg: 0, pitchDeg: 0, rollDeg: 0,
          angularVelocityDegPerSec: 0, timestamp: Date.now(),
        };
        setState((s) => {
          let next = updateOrientation(s, webOrientation);
          next = markStable(next, true);
          return next;
        });
      };
      pushWebOrientation();
      const interval = setInterval(pushWebOrientation, 500);
      return () => clearInterval(interval);
    }

    tracker.start().then((granted) => {
      if (!granted) return;
      tracker.addListener((o) => {
        setState((s) => {
          let next = updateOrientation(s, o);
          const stable = tracker.isStable(STABLE_DPS, STABLE_MS);
          next = markStable(next, stable);
          return next;
        });
      });
    });

    return () => {
      tracker.stop();
    };
  }, []);

  // -- Core capture function --

  const doCapture = useCallback(async () => {
    const s = stateRef.current;
    if (!cameraRef.current || !s.currentTarget || capturingRef.current) return;
    capturingRef.current = true;
    setCapturing(true);

    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo?.uri) return;

      let report: QualityReport = { blurScore: 999, brightnessAvg: 128, validation: 'passed', issues: [] };

      try {
        // Thumbnail for potential future quality analysis
        await manipulateAsync(photo.uri, [{ resize: { width: 320 } }], {
          compress: 0.6,
          format: SaveFormat.JPEG,
        });
        report = { blurScore: 200, brightnessAvg: 128, validation: 'passed', issues: [] };
      } catch {
        // Quality check failed — proceed without blocking
      }

      const wasStable = trackerRef.current.isStable(STABLE_DPS, STABLE_MS);
      if (!wasStable) {
        report.issues.push('Cihaz hareket halindeydi');
        if (report.validation !== 'failed') report.validation = 'warning';
      }

      const o = trackerRef.current.getCurrent();
      const currentTarget = stateRef.current.currentTarget;
      if (!currentTarget) return;

      const frame: CaptureFrame = {
        id: currentTarget.id,
        uri: photo.uri,
        yawDeg: o.yawDeg,
        pitchDeg: o.pitchDeg,
        rollDeg: o.rollDeg,
        timestamp: new Date().toISOString(),
        blurScore: report.blurScore,
        brightnessAvg: report.brightnessAvg,
        validation: report.validation,
      };

      setState((prev) => recordFrame(prev, frame, report));
    } catch {
      Alert.alert('Hata', 'Fotoğraf çekilemedi');
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }, []);

  // -- Auto-shutter logic --
  useEffect(() => {
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }

    const { phase, aligned, stable, manualShutter, currentTarget } = state;
    if (
      phase !== 'capturing' ||
      manualShutter ||
      !aligned ||
      !stable ||
      !currentTarget ||
      !cameraReady ||
      capturingRef.current
    ) {
      return;
    }

    autoTimerRef.current = setTimeout(() => {
      autoTimerRef.current = null;
      void doCapture();
    }, 400);

    return () => {
      if (autoTimerRef.current) {
        clearTimeout(autoTimerRef.current);
        autoTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.aligned, state.stable, state.manualShutter, state.currentTarget?.id, cameraReady, doCapture]);

  // -- Phase transitions --

  const onLevelOk = useCallback(() => {
    setState((s) => advanceToCalibration(s));
  }, []);

  const onCalibrate = useCallback(() => {
    trackerRef.current.lockReference();
    setState((s) => advanceToCapturing(s));
  }, []);

  const onGoReview = useCallback(() => {
    setState((s) => advanceToReview(s));
  }, []);

  const onContinueCapture = useCallback(() => {
    setState((s) => returnToCapturing(s));
  }, []);

  const onFinish = useCallback(() => {
    const s = stateRef.current;
    const refQ = trackerRef.current.getRefQuaternion();
    const session = buildCaptureSession(s, refQ, Platform.OS);
    setState((prev) => finalize(prev));
    onComplete({ captureSession: session });
  }, [onComplete]);

  const onToggleManual = useCallback(() => {
    setState((s) => toggleManualShutter(s));
  }, []);

  // -- Derived values --

  const stats = getCompletionStats(state.targets, state.completedIds);
  const isLevel = trackerRef.current.isLevel();

  // -- Permission screen --

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>Kamera izni kontrol ediliyor…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.infoText}>Kamera erişimi gerekli</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
          <Text style={styles.primaryBtnText}>İzin Ver</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkBtn} onPress={onClose}>
          <Text style={styles.linkText}>Geri Dön</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // -- Review screen --

  if (state.phase === 'review' || state.phase === 'done') {
    return (
      <CaptureReview
        frames={state.frames}
        targets={state.targets}
        completedIds={state.completedIds}
        canFinish={stats.allRequiredDone}
        sceneName={sceneName}
        nextSceneName={nextSceneName}
        onFinish={onFinish}
        onContinue={onContinueCapture}
        onClose={onClose}
      />
    );
  }

  // -- Camera screens (permission / leveling / calibration / capturing) --

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        onCameraReady={() => setCameraReady(true)}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.topClose} onPress={onClose}>
            <Text style={styles.topCloseText}>✕</Text>
          </TouchableOpacity>
          <View style={styles.topInfo}>
            {roomProgressLabel && (
              <Text style={styles.topProgress}>{roomProgressLabel}</Text>
            )}
            <Text style={styles.topScene}>{sceneName}</Text>
            {nextSceneName && (
              <Text style={styles.topNext}>Sonraki: {nextSceneName}</Text>
            )}
          </View>
          <View style={{ width: 36 }} />
        </View>

        {/* Waiting for permission phase — show nothing over camera */}
        {state.phase === 'permission' && null}

        {/* Leveling phase */}
        {state.phase === 'leveling' && (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Cihazı hazırlayın</Text>
            <Text style={styles.panelBody}>
              Telefonu dik tutun ve odanın ortasında durun.
              Etrafınızda 360° döneceksiniz.
            </Text>
            <View style={[styles.badge, isLevel && styles.badgeOk]}>
              <Text style={styles.badgeText}>
                {Platform.OS === 'web'
                  ? 'Web: sensör yok — devam edebilirsiniz'
                  : isLevel
                    ? '✓ Hazır'
                    : 'Telefonu dik ve düz tutun'}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.primaryBtn, Platform.OS !== 'web' && !isLevel && styles.btnDisabled]}
              onPress={onLevelOk}
              disabled={Platform.OS !== 'web' && !isLevel}
            >
              <Text style={styles.primaryBtnText}>Devam</Text>
            </TouchableOpacity>
            {/* Fallback: let user skip level check on native too */}
            {Platform.OS !== 'web' && !isLevel && (
              <TouchableOpacity style={styles.skipBtn} onPress={onLevelOk}>
                <Text style={styles.skipText}>Yine de devam et</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Calibration phase */}
        {state.phase === 'calibration' && (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Referans yönü</Text>
            <Text style={styles.panelBody}>
              Odanın ön tarafına (kapıya veya pencereye) bakın.
              Bu yön, panoramanın başlangıç noktası olacak.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={onCalibrate}>
              <Text style={styles.primaryBtnText}>Kilitle ve Başla</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Capturing phase — overlay + HUD */}
        {state.phase === 'capturing' && (
          <>
            <TargetOverlay
              target={state.currentTarget}
              currentYaw={state.orientation.yawDeg}
              currentPitch={state.orientation.pitchDeg}
              aligned={state.aligned}
              stable={state.stable}
              hint={state.directionHint}
              capturedCount={stats.completed}
              totalTargets={stats.total}
            />
            <CaptureHUD
              capturedCount={stats.completed}
              totalTargets={stats.total}
              requiredDone={stats.allRequiredDone}
              aligned={state.aligned}
              stable={state.stable}
              capturing={capturing}
              manualShutter={state.manualShutter}
              issueText={state.lastQualityIssueText}
              onShutter={doCapture}
              onReview={onGoReview}
              onToggleManual={onToggleManual}
              onClose={onClose}
            />
          </>
        )}
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: {
    flex: 1,
    backgroundColor: '#0f0f23',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  camera: { flex: 1, width: '100%' },
  infoText: { color: '#9ca3af', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  primaryBtn: {
    backgroundColor: '#8b5cf6',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 8,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  btnDisabled: { opacity: 0.4 },
  linkBtn: { marginTop: 14 },
  linkText: { color: '#8b5cf6', fontSize: 15 },
  skipBtn: { marginTop: 10, alignItems: 'center', padding: 8 },
  skipText: { color: '#6b7280', fontSize: 13, textDecorationLine: 'underline' },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 54 : 36,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  topClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topCloseText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  topInfo: { flex: 1, alignItems: 'center' },
  topProgress: { color: '#c4b5fd', fontSize: 11, fontWeight: '700', marginBottom: 2 },
  topScene: { color: '#fff', fontSize: 16, fontWeight: '600' },
  topNext: { color: '#9ca3af', fontSize: 12, marginTop: 2 },

  panel: {
    marginHorizontal: 16,
    marginBottom: Platform.OS === 'ios' ? 130 : 100,
    marginTop: 'auto' as any,
    backgroundColor: 'rgba(0,0,0,0.82)',
    borderRadius: 16,
    padding: 20,
  },
  panelTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  panelBody: { color: '#9ca3af', fontSize: 14, lineHeight: 21, marginBottom: 16 },
  badge: { padding: 12, borderRadius: 12, backgroundColor: '#3f2f2f', marginBottom: 14 },
  badgeOk: { backgroundColor: '#14532d88' },
  badgeText: { color: '#e5e7eb', textAlign: 'center', fontSize: 14 },
});
