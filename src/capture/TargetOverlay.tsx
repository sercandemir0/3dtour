/**
 * TargetOverlay — AR-style target reticle on the camera preview.
 *
 * Edge arrows, degree readout, and alignment progress (grey → yellow → green).
 */
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import type { CaptureTarget } from './CaptureGrid';
import { angleDiff, isTargetAligned, sphericalDistance } from './CaptureGrid';
import type { DirectionHint } from './CaptureEngine';

interface Props {
  target: CaptureTarget | null;
  currentYaw: number;
  currentPitch: number;
  aligned: boolean;
  stable: boolean;
  hint: DirectionHint;
  capturedCount: number;
  totalTargets: number;
}

const { width: SW, height: SH } = Dimensions.get('window');
const RETICLE_R = 22;
const MOVE_SCALE = 3.5;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function computeAlignPct(target: CaptureTarget, yaw: number, pitch: number): number {
  if (isTargetAligned(target, yaw, pitch)) return 100;
  if (target.ring === 'zenith' || target.ring === 'nadir') {
    const d = sphericalDistance(target.yawDeg, target.pitchDeg, yaw, pitch);
    return Math.max(0, Math.min(100, (1 - d / target.toleranceDeg) * 100));
  }
  const yawErr = angleDiff(target.yawDeg, yaw);
  const pitchErr = Math.abs(target.pitchDeg - pitch);
  const yawP = 1 - Math.min(1, yawErr / target.toleranceDeg);
  const pitchP = 1 - Math.min(1, pitchErr / target.pitchToleranceDeg);
  return Math.max(0, Math.min(100, ((yawP + pitchP) / 2) * 100));
}

export function TargetOverlay({
  target,
  currentYaw,
  currentPitch,
  aligned,
  stable,
  hint,
  capturedCount,
  totalTargets,
}: Props) {
  if (!target) return null;

  let dYaw = target.yawDeg - currentYaw;
  if (dYaw > 180) dYaw -= 360;
  if (dYaw < -180) dYaw += 360;
  const dPitch = target.pitchDeg - currentPitch;

  const cx = SW / 2 + clamp(dYaw * MOVE_SCALE, -SW / 2 + 30, SW / 2 - 30);
  const cy = SH / 2 - clamp(dPitch * MOVE_SCALE, -SH / 2 + 60, SH / 2 - 60);

  const alignPct = Math.round(computeAlignPct(target, currentYaw, currentPitch));

  const colour = aligned
    ? stable
      ? '#34d399'
      : '#facc15'
    : '#6b7280';

  const ringLabel =
    target.ring === 'horizon'
      ? 'Ufuk'
      : target.ring === 'upper'
        ? 'Üst'
        : target.ring === 'lower'
          ? 'Alt'
          : target.ring === 'zenith'
            ? 'Tavan'
            : 'Zemin';

  const showLeft = hint.yawDir === 'left';
  const showRight = hint.yawDir === 'right';
  const showUp = hint.pitchDir === 'up';
  const showDown = hint.pitchDir === 'down';

  const mainLabel = aligned
    ? stable
      ? 'Çekim hazır'
      : 'Hizalandı — sabit tutun (~1 sn)'
    : hint.label;

  const subDegrees =
    !aligned && (Math.abs(hint.yawDeltaDeg) > 2 || Math.abs(hint.pitchDeltaDeg) > 2)
      ? `Δ yaw ${hint.yawDeltaDeg > 0 ? '+' : ''}${Math.round(hint.yawDeltaDeg)}° · Δ pitch ${hint.pitchDeltaDeg > 0 ? '+' : ''}${Math.round(hint.pitchDeltaDeg)}°`
      : null;

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.crossH} />
      <View style={styles.crossV} />

      {showLeft ? (
        <Text style={[styles.edgeArrow, styles.arrowLeft]}>‹</Text>
      ) : null}
      {showRight ? (
        <Text style={[styles.edgeArrow, styles.arrowRight]}>›</Text>
      ) : null}
      {showUp ? (
        <Text style={[styles.edgeArrow, styles.arrowUp]}>⌃</Text>
      ) : null}
      {showDown ? (
        <Text style={[styles.edgeArrow, styles.arrowDown]}>⌄</Text>
      ) : null}

      <View
        style={[
          styles.target,
          {
            left: cx - RETICLE_R,
            top: cy - RETICLE_R,
            borderColor: colour,
            backgroundColor: aligned && stable ? colour + '33' : 'transparent',
          },
        ]}
      />

      <View style={styles.progressWrap}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${alignPct}%` as const, backgroundColor: colour }]} />
        </View>
        <Text style={[styles.progressLabel, { color: colour }]}>Hizalama {alignPct}%</Text>
      </View>

      <View style={styles.hintBox}>
        <Text style={[styles.hintText, { color: colour }]}>{mainLabel}</Text>
        {subDegrees ? <Text style={styles.subDegText}>{subDegrees}</Text> : null}
      </View>

      <View style={styles.ringLabel}>
        <Text style={styles.ringText}>
          {ringLabel} • {capturedCount}/{totalTargets}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  crossH: {
    position: 'absolute',
    top: SH / 2 - 1,
    left: SW / 2 - 16,
    width: 32,
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  crossV: {
    position: 'absolute',
    top: SH / 2 - 16,
    left: SW / 2 - 1,
    width: 2,
    height: 32,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  edgeArrow: {
    position: 'absolute',
    color: 'rgba(255,255,255,0.92)',
    fontSize: 56,
    fontWeight: '200',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  arrowLeft: { left: 8, top: SH / 2 - 36 },
  arrowRight: { right: 8, top: SH / 2 - 36 },
  arrowUp: { top: 120, left: 0, right: 0, textAlign: 'center' },
  arrowDown: { bottom: 200, left: 0, right: 0, textAlign: 'center' },
  target: {
    position: 'absolute',
    width: RETICLE_R * 2,
    height: RETICLE_R * 2,
    borderRadius: RETICLE_R,
    borderWidth: 3,
  },
  progressWrap: {
    position: 'absolute',
    top: SH / 2 + 120,
    left: 40,
    right: 40,
    alignItems: 'center',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  progressLabel: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '700',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  hintBox: {
    position: 'absolute',
    bottom: 160,
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  subDegText: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.75)',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  ringLabel: {
    position: 'absolute',
    top: 100,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  ringText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    fontWeight: '600',
  },
});
