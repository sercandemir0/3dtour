import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { useTourStore } from '@/src/stores/tourStore';
import type { CaptureMode } from '@/src/types/tour';

const MODES: { key: CaptureMode; icon: string; title: string; subtitle: string }[] = [
  {
    key: 'panorama',
    icon: '🌐',
    title: '360° Panorama Tur',
    subtitle: 'Panoramik fotoğraflarla sanal tur oluşturun. Her cihazda çalışır.',
  },
  {
    key: 'gaussian_splat',
    icon: '🔮',
    title: '3D Serbest Gezinti',
    subtitle: 'Fotoğraflardan gerçekçi 3D sahne oluşturun. En immersive deneyim.',
  },
  {
    key: 'roomplan',
    icon: '📐',
    title: '3D Kat Planı',
    subtitle: 'LiDAR ile oda tarayın. Dollhouse görünümü. Sadece iPhone Pro.',
  },
];

const SUGGESTED_ROOMS = [
  'Salon', 'Yatak Odası', 'Mutfak', 'Banyo', 'Koridor',
  'Balkon', 'Çocuk Odası', 'Çalışma Odası', 'Giriş',
];

export default function NewTourScreen() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMode, setSelectedMode] = useState<CaptureMode>('panorama');
  const [rooms, setRooms] = useState<string[]>([]);
  const [roomInput, setRoomInput] = useState('');
  const [creating, setCreating] = useState(false);
  const { createTourWithRooms } = useTourStore();

  const addRoom = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (rooms.includes(trimmed)) return;
    setRooms((prev) => [...prev, trimmed]);
    setRoomInput('');
  };

  const removeRoom = (idx: number) => {
    setRooms((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Hata', 'Tur başlığını giriniz');
      return;
    }
    if (rooms.length === 0) {
      Alert.alert('Hata', 'En az bir oda ekleyin');
      return;
    }

    setCreating(true);
    try {
      const tour = await createTourWithRooms(
        title.trim(),
        selectedMode,
        rooms,
        description.trim() || undefined,
      );
      router.replace(`/tour/${tour.id}`);
    } catch (e: any) {
      Alert.alert('Hata', e.message ?? 'Tur oluşturulamadı');
    } finally {
      setCreating(false);
    }
  };

  const unusedSuggestions = SUGGESTED_ROOMS.filter((r) => !rooms.includes(r));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Çekim Modu</Text>

      {MODES.map((mode) => (
        <TouchableOpacity
          key={mode.key}
          style={[
            styles.modeCard,
            selectedMode === mode.key && styles.modeCardActive,
          ]}
          onPress={() => setSelectedMode(mode.key)}
          activeOpacity={0.7}
        >
          <Text style={styles.modeIcon}>{mode.icon}</Text>
          <View style={styles.modeContent}>
            <Text style={styles.modeTitle}>{mode.title}</Text>
            <Text style={styles.modeSubtitle}>{mode.subtitle}</Text>
          </View>
          <View style={[styles.radio, selectedMode === mode.key && styles.radioActive]}>
            {selectedMode === mode.key && <View style={styles.radioDot} />}
          </View>
        </TouchableOpacity>
      ))}

      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Tur Bilgileri</Text>

      <TextInput
        style={styles.input}
        placeholder="Tur Başlığı"
        placeholderTextColor="#6b7280"
        value={title}
        onChangeText={setTitle}
      />

      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Açıklama (opsiyonel)"
        placeholderTextColor="#6b7280"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
      />

      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Odalar</Text>
      <Text style={styles.sectionHint}>
        Turda yer alacak odaları belirleyin. Sonra her oda için fotoğraf/video çekeceksiniz.
      </Text>

      {rooms.length > 0 && (
        <View style={styles.roomChips}>
          {rooms.map((room, idx) => (
            <View key={`${room}-${idx}`} style={styles.roomChip}>
              <Text style={styles.roomChipText}>{room}</Text>
              <TouchableOpacity onPress={() => removeRoom(idx)} hitSlop={8}>
                <Text style={styles.roomChipRemove}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <View style={styles.roomInputRow}>
        <TextInput
          style={[styles.input, { flex: 1, marginBottom: 0 }]}
          placeholder="Oda adı yazın..."
          placeholderTextColor="#6b7280"
          value={roomInput}
          onChangeText={setRoomInput}
          onSubmitEditing={() => addRoom(roomInput)}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={styles.addRoomButton}
          onPress={() => addRoom(roomInput)}
          activeOpacity={0.7}
        >
          <Text style={styles.addRoomButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      {unusedSuggestions.length > 0 && (
        <View style={styles.suggestions}>
          <Text style={styles.suggestionsLabel}>Hızlı ekle:</Text>
          <View style={styles.suggestionChips}>
            {unusedSuggestions.map((name) => (
              <TouchableOpacity
                key={name}
                style={styles.suggestionChip}
                onPress={() => addRoom(name)}
                activeOpacity={0.7}
              >
                <Text style={styles.suggestionChipText}>+ {name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <TouchableOpacity
        style={[styles.createButton, creating && styles.createButtonDisabled]}
        onPress={handleCreate}
        disabled={creating}
        activeOpacity={0.8}
      >
        <Text style={styles.createButtonText}>
          {creating
            ? 'Oluşturuluyor...'
            : `Tur Oluştur (${rooms.length} oda)`}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f23' },
  content: { padding: 20, paddingBottom: 40 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  sectionHint: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 14,
    lineHeight: 18,
  },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e3a',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  modeCardActive: { borderColor: '#8b5cf6' },
  modeIcon: { fontSize: 32, marginRight: 14 },
  modeContent: { flex: 1 },
  modeTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  modeSubtitle: { fontSize: 13, color: '#9ca3af', lineHeight: 18 },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: '#4b5563',
    justifyContent: 'center', alignItems: 'center', marginLeft: 10,
  },
  radioActive: { borderColor: '#8b5cf6' },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#8b5cf6' },
  input: {
    backgroundColor: '#1e1e3a', borderRadius: 12,
    padding: 16, fontSize: 16, color: '#fff', marginBottom: 12,
  },
  textArea: { height: 80, textAlignVertical: 'top' },
  roomChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  roomChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#8b5cf622', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: '#8b5cf644',
  },
  roomChipText: { color: '#c4b5fd', fontSize: 14, fontWeight: '500' },
  roomChipRemove: { color: '#8b5cf6', fontSize: 14, fontWeight: '700' },
  roomInputRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  addRoomButton: {
    width: 52, backgroundColor: '#8b5cf6', borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },
  addRoomButtonText: { color: '#fff', fontSize: 24, fontWeight: '300' },
  suggestions: { marginBottom: 16 },
  suggestionsLabel: { color: '#6b7280', fontSize: 12, marginBottom: 8 },
  suggestionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  suggestionChip: {
    backgroundColor: '#1e1e3a', borderRadius: 16,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: '#2d2d5e',
  },
  suggestionChipText: { color: '#9ca3af', fontSize: 13 },
  createButton: {
    backgroundColor: '#8b5cf6', borderRadius: 14,
    padding: 18, alignItems: 'center', marginTop: 12,
  },
  createButtonDisabled: { opacity: 0.6 },
  createButtonText: { fontSize: 17, fontWeight: '700', color: '#fff' },
});
