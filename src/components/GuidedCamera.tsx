import { useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Animated,
} from 'react-native';
import CameraView from 'expo-camera/build/CameraView';
import { useCameraPermissions } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';

interface Props {
  sceneName: string;
  nextSceneName?: string;
  onCapture: (uri: string) => void;
  onClose: () => void;
}

export function GuidedCamera({ sceneName, nextSceneName, onCapture, onClose }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [orientation, setOrientation] = useState({ beta: 0, gamma: 0 });
  const [isLevel, setIsLevel] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let sub: ReturnType<typeof DeviceMotion.addListener> | null = null;

    const startSensor = async () => {
      if (Platform.OS === 'web') return;
      try {
        const { granted } = await DeviceMotion.requestPermissionsAsync();
        if (!granted) return;
        DeviceMotion.setUpdateInterval(100);
        sub = DeviceMotion.addListener((data) => {
          if (data.rotation) {
            const beta = (data.rotation.beta ?? 0) * (180 / Math.PI);
            const gamma = (data.rotation.gamma ?? 0) * (180 / Math.PI);
            setOrientation({ beta, gamma });
            setIsLevel(Math.abs(beta) < 10 && Math.abs(gamma - 90) < 15);
          }
        });
      } catch {}
    };

    startSensor();
    return () => { sub?.remove(); };
  }, []);

  useEffect(() => {
    if (isLevel) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.1, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [isLevel]);

  const handleTakePicture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) {
        onCapture(photo.uri);
      }
    } catch (e) {
      console.warn('Camera capture failed', e);
    } finally {
      setCapturing(false);
    }
  }, [capturing, onCapture]);

  if (!permission) {
    return <View style={styles.container}><Text style={styles.permText}>Kamera izni kontrol ediliyor...</Text></View>;
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

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={styles.camera} facing="back">
        {/* Guidance overlay */}
        <View style={styles.overlay}>
          {/* Top info bar */}
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.topCloseBtn} onPress={onClose}>
              <Text style={styles.topCloseBtnText}>✕</Text>
            </TouchableOpacity>
            <View style={styles.topInfo}>
              <Text style={styles.topSceneName}>{sceneName}</Text>
              {nextSceneName && (
                <Text style={styles.topNextHint}>Sonraki: {nextSceneName}</Text>
              )}
            </View>
            <View style={{ width: 36 }} />
          </View>

          {/* Center guides */}
          <View style={styles.centerGuide}>
            <View style={[styles.horizonLine, isLevel && styles.horizonLineLevel]} />
            <View style={[styles.crosshairV, isLevel && styles.crosshairLevel]} />
          </View>

          {/* Orientation hint */}
          <View style={styles.hintContainer}>
            {!isLevel && Platform.OS !== 'web' ? (
              <View style={styles.hintBadge}>
                <Text style={styles.hintText}>
                  {Math.abs(orientation.gamma - 90) > 15
                    ? '📱 Cihazı yatay konuma getirin'
                    : '↔️ Cihazı düz tutun'}
                </Text>
              </View>
            ) : (
              <View style={[styles.hintBadge, styles.hintBadgeReady]}>
                <Text style={styles.hintTextReady}>Hazır — Fotoğraf çekin</Text>
              </View>
            )}
          </View>

          {/* Capture button */}
          <View style={styles.bottomBar}>
            <View style={{ width: 60 }} />
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                style={[styles.captureBtn, capturing && styles.captureBtnDisabled]}
                onPress={handleTakePicture}
                disabled={capturing}
                activeOpacity={0.7}
              >
                <View style={styles.captureBtnInner} />
              </TouchableOpacity>
            </Animated.View>
            <View style={{ width: 60 }} />
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  camera: { flex: 1, width: '100%' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  permText: { color: '#9ca3af', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  permButton: { backgroundColor: '#8b5cf6', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 14 },
  permButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  closeBtn: { marginTop: 12 },
  closeBtnText: { color: '#8b5cf6', fontSize: 15 },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 54 : 36,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  topCloseBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
  topCloseBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  topInfo: { flex: 1, alignItems: 'center' },
  topSceneName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  topNextHint: { color: '#9ca3af', fontSize: 12, marginTop: 2 },

  centerGuide: {
    position: 'absolute', top: '50%', left: 0, right: 0,
    alignItems: 'center', marginTop: -1,
  },
  horizonLine: {
    width: '70%', height: 2, backgroundColor: 'rgba(239,68,68,0.6)',
  },
  horizonLineLevel: { backgroundColor: 'rgba(52,211,153,0.8)' },
  crosshairV: {
    position: 'absolute', width: 2, height: 40, top: -20,
    backgroundColor: 'rgba(239,68,68,0.6)',
  },
  crosshairLevel: { backgroundColor: 'rgba(52,211,153,0.8)' },

  hintContainer: { alignItems: 'center', marginBottom: 8 },
  hintBadge: {
    backgroundColor: 'rgba(239,68,68,0.2)', borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.4)',
  },
  hintBadgeReady: {
    backgroundColor: 'rgba(52,211,153,0.2)',
    borderColor: 'rgba(52,211,153,0.4)',
  },
  hintText: { color: '#fca5a5', fontSize: 14, fontWeight: '500' },
  hintTextReady: { color: '#6ee7b7', fontSize: 14, fontWeight: '500' },

  bottomBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    paddingHorizontal: 40,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  captureBtn: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: '#fff',
    justifyContent: 'center', alignItems: 'center',
  },
  captureBtnDisabled: { opacity: 0.5 },
  captureBtnInner: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff',
  },
});
