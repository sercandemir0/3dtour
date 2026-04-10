/**
 * TargetOverlay — AR-style target reticle rendered on top of the camera preview.
 *
 * Shows a crosshair at screen centre and a floating target dot that moves
 * according to the angular difference between the current orientation and
 * the active capture target. Colour transitions grey → yellow → green as
 * alignment improves. Direction arrows guide the user.
 */
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import type { CaptureTarget } from './CaptureGrid';
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

  const colour = aligned
    ? stable
      ? '#34d399'
      : '#facc15'
    : '#6b7280';

  const ringLabel = target.ring === 'horizon'
    ? 'Ufuk'
    : target.ring === 'upper'
      ? 'Üst'
      : target.ring === 'lower'
        ? 'Alt'
        : target.ring === 'zenith'
          ? 'Tavan'
          : 'Zemin';

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Centre crosshair */}
      <View style={styles.crossH} />
      <View style={styles.crossV} />

      {/* Target dot */}
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

      {/* Direction hint */}
      <View style={styles.hintBox}>
        <Text style={[styles.hintText, { color: colour }]}>{hint.label}</Text>
      </View>

      {/* Ring + progress label */}
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
  target: {
    position: 'absolute',
    width: RETICLE_R * 2,
    height: RETICLE_R * 2,
    borderRadius: RETICLE_R,
    borderWidth: 3,
  },
  hintBox: {
    position: 'absolute',
    bottom: 160,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hintText: {
    fontSize: 17,
    fontWeight: '700',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
