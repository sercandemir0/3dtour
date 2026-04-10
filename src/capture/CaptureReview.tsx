/**
 * CaptureReview — review screen shown after all required targets are captured.
 *
 * Shows a grid of captured frames, highlights warnings/failures, lets
 * the user go back to capture missing targets, or finalize.
 */
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import type { CaptureFrame } from './CaptureEngine';
import type { CaptureTarget } from './CaptureGrid';

interface Props {
  frames: CaptureFrame[];
  targets: CaptureTarget[];
  completedIds: Set<number>;
  canFinish: boolean;
  sceneName: string;
  nextSceneName?: string;
  onFinish: () => void;
  onContinue: () => void;
  onClose: () => void;
}

export function CaptureReview({
  frames,
  targets,
  completedIds,
  canFinish,
  sceneName,
  nextSceneName,
  onFinish,
  onContinue,
  onClose,
}: Props) {
  const missing = targets.filter((t) => t.required && !completedIds.has(t.id));
  const warnings = frames.filter((f) => f.validation === 'warning');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Text style={styles.closeBtn}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Özet — {sceneName}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Stats */}
        <Text style={styles.stats}>
          {frames.length} / {targets.length} kare çekildi
          {missing.length > 0 ? ` • ${missing.length} zorunlu eksik` : ''}
          {warnings.length > 0 ? ` • ${warnings.length} uyarılı` : ''}
        </Text>

        {/* Frame grid */}
        <View style={styles.grid}>
          {frames.map((f) => (
            <View key={f.id} style={styles.frameCard}>
              <Image source={{ uri: f.uri }} style={styles.frameImg} resizeMode="cover" />
              {f.validation === 'warning' && (
                <View style={styles.warnBadge}>
                  <Text style={styles.warnText}>⚠</Text>
                </View>
              )}
              <Text style={styles.frameLabel}>
                #{f.id + 1}
              </Text>
            </View>
          ))}
        </View>

        {missing.length > 0 && (
          <Text style={styles.missingHint}>
            Zorunlu hedeflerden {missing.length} tanesi eksik — devam ederek tamamlayabilirsiniz.
          </Text>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {missing.length > 0 || frames.length < targets.length ? (
            <TouchableOpacity style={styles.secondaryBtn} onPress={onContinue}>
              <Text style={styles.secondaryText}>
                {missing.length > 0 ? 'Eksikleri çek' : 'Opsiyonel kareleri çek'}
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, !canFinish && styles.primaryDisabled]}
            onPress={onFinish}
            disabled={!canFinish}
          >
            <Text style={styles.primaryText}>
              {nextSceneName ? 'Kaydet ve sonraki odaya geç' : 'Kaydet ve bitir'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 54 : 40,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  closeBtn: { color: '#fff', fontSize: 22 },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  scroll: { padding: 20, paddingBottom: 48 },
  stats: { color: '#fbbf24', fontSize: 14, textAlign: 'center', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  frameCard: {
    width: '30%' as any,
    aspectRatio: 4 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1e1e3a',
  },
  frameImg: { width: '100%', height: '100%' },
  warnBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#78350f',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  warnText: { fontSize: 12 },
  frameLabel: {
    position: 'absolute',
    bottom: 2,
    left: 4,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontWeight: '600',
  },
  missingHint: { color: '#ef4444', fontSize: 13, textAlign: 'center', marginBottom: 16 },
  actions: { gap: 12 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#8b5cf6',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  secondaryText: { color: '#c4b5fd', fontSize: 15, fontWeight: '600' },
  primaryBtn: { backgroundColor: '#8b5cf6', borderRadius: 12, padding: 16, alignItems: 'center' },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
