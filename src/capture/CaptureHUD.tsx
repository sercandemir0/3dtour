/**
 * CaptureHUD — bottom controls for the capture screen.
 *
 * Shows progress dots, manual shutter button, review button,
 * quality issue banner, and the manual-shutter toggle.
 */
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Switch,
} from 'react-native';

interface Props {
  capturedCount: number;
  totalTargets: number;
  requiredDone: boolean;
  aligned: boolean;
  stable: boolean;
  capturing: boolean;
  manualShutter: boolean;
  issueText: string | null;
  onShutter: () => void;
  onReview: () => void;
  onToggleManual: () => void;
  onClose: () => void;
}

export function CaptureHUD({
  capturedCount,
  totalTargets,
  requiredDone,
  aligned,
  stable,
  capturing,
  manualShutter,
  issueText,
  onShutter,
  onReview,
  onToggleManual,
  onClose,
}: Props) {
  // On web there's no gyro — allow shooting whenever manual shutter is on,
  // or when aligned (gyro-guided on native).
  const canShoot = (aligned || manualShutter) && !capturing;

  return (
    <View style={styles.wrap}>
      {/* Issue banner */}
      {issueText ? (
        <View style={styles.issueBanner}>
          <Text style={styles.issueText}>{issueText}</Text>
        </View>
      ) : null}

      {/* Progress bar */}
      <View style={styles.progressRow}>
        {Array.from({ length: Math.min(totalTargets, 30) }, (_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < capturedCount ? styles.dotDone : styles.dotPending,
            ]}
          />
        ))}
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.reviewBtn, capturedCount === 0 && styles.btnDisabled]}
          onPress={onReview}
          disabled={capturedCount === 0}
        >
          <Text style={styles.reviewText}>Özet</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.shutterBtn, !canShoot && styles.shutterDisabled]}
          onPress={onShutter}
          disabled={!canShoot}
        >
          <View style={styles.shutterInner} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Manual toggle */}
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Manuel deklanşör</Text>
        <Switch
          value={manualShutter}
          onValueChange={onToggleManual}
          trackColor={{ false: '#4b5563', true: '#6d28d9' }}
          thumbColor={manualShutter ? '#e9d5ff' : '#9ca3af'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  issueBanner: {
    backgroundColor: '#78350f',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  issueText: { color: '#fef3c7', fontSize: 13, textAlign: 'center' },
  progressRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
    marginBottom: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotDone: { backgroundColor: '#34d399' },
  dotPending: { backgroundColor: '#3f3f5a' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  reviewBtn: { padding: 12 },
  reviewText: { color: '#c4b5fd', fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.35 },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shutterDisabled: { opacity: 0.35 },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  toggleLabel: { color: '#9ca3af', fontSize: 12 },
});
