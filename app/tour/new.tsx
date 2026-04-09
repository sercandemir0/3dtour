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
    subtitle: 'Video cekerek panoramik sanal tur olusturun. Her cihazda calisir.',
  },
  {
    key: 'gaussian_splat',
    icon: '🔮',
    title: '3D Serbest Gezinti',
    subtitle: 'Fotograflardan gercekci 3D sahne olusturun. En immersive deneyim.',
  },
  {
    key: 'roomplan',
    icon: '📐',
    title: '3D Kat Plani',
    subtitle: 'LiDAR ile oda tarayin. Dollhouse gorunumu. Sadece iPhone Pro.',
  },
];

export default function NewTourScreen() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMode, setSelectedMode] = useState<CaptureMode>('panorama');
  const [creating, setCreating] = useState(false);
  const { createTour } = useTourStore();

  const handleCreate = async () => {
    if (!title.trim()) {
      Alert.alert('Hata', 'Tur basliginii giriniz');
      return;
    }

    setCreating(true);
    try {
      const tour = await createTour(title.trim(), selectedMode, description.trim() || undefined);
      router.replace(`/tour/${tour.id}`);
    } catch (e: any) {
      Alert.alert('Hata', e.message ?? 'Tur olusturulamadi');
    } finally {
      setCreating(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.sectionTitle}>Cekim Modu</Text>

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
        placeholder="Tur Basligi"
        placeholderTextColor="#6b7280"
        value={title}
        onChangeText={setTitle}
      />

      <TextInput
        style={[styles.input, styles.textArea]}
        placeholder="Aciklama (opsiyonel)"
        placeholderTextColor="#6b7280"
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={3}
      />

      <TouchableOpacity
        style={[styles.createButton, creating && styles.createButtonDisabled]}
        onPress={handleCreate}
        disabled={creating}
        activeOpacity={0.8}
      >
        <Text style={styles.createButtonText}>
          {creating ? 'Olusturuluyor...' : 'Tur Olustur'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
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
  modeCardActive: {
    borderColor: '#8b5cf6',
    backgroundColor: '#1e1e3a',
  },
  modeIcon: {
    fontSize: 32,
    marginRight: 14,
  },
  modeContent: {
    flex: 1,
  },
  modeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  modeSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#4b5563',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 10,
  },
  radioActive: {
    borderColor: '#8b5cf6',
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#8b5cf6',
  },
  input: {
    backgroundColor: '#1e1e3a',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    marginBottom: 12,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  createButton: {
    backgroundColor: '#8b5cf6',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    marginTop: 12,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#fff',
  },
});
