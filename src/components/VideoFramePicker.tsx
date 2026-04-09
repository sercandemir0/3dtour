import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Modal,
} from 'react-native';
import { extractFrames, ExtractedFrame } from '@/src/utils/videoFrameExtractor';

interface Props {
  videoUri: string;
  visible: boolean;
  onSelectFrame: (frameUri: string) => void;
  onCancel: () => void;
}

export function VideoFramePicker({ videoUri, visible, onSelectFrame, onCancel }: Props) {
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !videoUri) return;
    setLoading(true);
    setFrames([]);
    setSelected(null);

    extractFrames(videoUri, 8)
      .then((f) => {
        setFrames(f);
        if (f.length > 0) setSelected(f[0].uri);
      })
      .finally(() => setLoading(false));
  }, [visible, videoUri]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Video Karesi Seçin</Text>
          <Text style={styles.subtitle}>
            Videodan çıkarılan karelerden bu oda için en uygun olanı seçin.
          </Text>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#8b5cf6" />
              <Text style={styles.loadingText}>Kareler çıkarılıyor...</Text>
            </View>
          ) : frames.length === 0 ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.loadingText}>Kare çıkarılamadı. Farklı bir video deneyin.</Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.frameScroll}>
              {frames.map((frame) => (
                <TouchableOpacity
                  key={frame.timeMs}
                  style={[styles.frameCard, selected === frame.uri && styles.frameCardSelected]}
                  onPress={() => setSelected(frame.uri)}
                  activeOpacity={0.7}
                >
                  <Image source={{ uri: frame.uri }} style={styles.frameImage} resizeMode="cover" />
                  <Text style={styles.frameTime}>
                    {Math.round(frame.timeMs / 1000)}s
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
              <Text style={styles.cancelBtnText}>İptal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, !selected && styles.confirmBtnDisabled]}
              onPress={() => selected && onSelectFrame(selected)}
              disabled={!selected}
              activeOpacity={0.8}
            >
              <Text style={styles.confirmBtnText}>Bu Kareyi Kullan</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12,
    maxHeight: '70%',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#4b5563',
    alignSelf: 'center', marginBottom: 16,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#9ca3af', fontSize: 13, marginBottom: 16, lineHeight: 18 },
  loadingContainer: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  loadingText: { color: '#9ca3af', fontSize: 14 },
  frameScroll: { marginBottom: 20 },
  frameCard: {
    width: 140, height: 100, borderRadius: 10, overflow: 'hidden',
    marginRight: 10, borderWidth: 3, borderColor: 'transparent',
  },
  frameCardSelected: { borderColor: '#8b5cf6' },
  frameImage: { width: '100%', height: '100%' },
  frameTime: {
    position: 'absolute', bottom: 4, right: 6,
    color: '#fff', fontSize: 11, fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4,
  },
  actions: { flexDirection: 'row', gap: 10 },
  cancelBtn: { flex: 1, padding: 16, alignItems: 'center', borderRadius: 12, backgroundColor: '#2d2d5e' },
  cancelBtnText: { color: '#9ca3af', fontSize: 16 },
  confirmBtn: { flex: 2, padding: 16, alignItems: 'center', borderRadius: 12, backgroundColor: '#8b5cf6' },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
