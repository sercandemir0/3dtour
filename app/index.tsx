import { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { useTourStore } from '@/src/stores/tourStore';
import type { Tour } from '@/src/types/tour';

const CAPTURE_MODE_LABELS: Record<string, string> = {
  panorama: '360° Panorama',
  gaussian_splat: '3D Splat',
  roomplan: 'RoomPlan',
};

const STATUS_COLORS: Record<string, string> = {
  draft: '#fbbf24',
  processing: '#60a5fa',
  published: '#34d399',
  archived: '#9ca3af',
};

function TourCard({ tour }: { tour: Tour }) {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/tour/${tour.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardCover}>
        <Text style={styles.cardCoverText}>
          {tour.title.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {tour.title}
        </Text>
        <View style={styles.cardMeta}>
          <View style={[styles.badge, { backgroundColor: STATUS_COLORS[tour.status] + '33' }]}>
            <Text style={[styles.badgeText, { color: STATUS_COLORS[tour.status] }]}>
              {tour.status}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#8b5cf633' }]}>
            <Text style={[styles.badgeText, { color: '#8b5cf6' }]}>
              {CAPTURE_MODE_LABELS[tour.capture_mode]}
            </Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function DashboardScreen() {
  const { tours, loading, fetchTours } = useTourStore();

  useEffect(() => {
    fetchTours();
  }, []);

  return (
    <View style={styles.container}>
      {loading && tours.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#8b5cf6" />
        </View>
      ) : tours.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🏠</Text>
          <Text style={styles.emptyTitle}>Henuz tur yok</Text>
          <Text style={styles.emptySubtitle}>
            Ilk sanal turunuzu olusturmak icin baslayalim!
          </Text>
        </View>
      ) : (
        <FlatList
          data={tours}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TourCard tour={item} />}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/tour/new')}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f23',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: '#1e1e3a',
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    marginBottom: 12,
  },
  cardCover: {
    width: 80,
    height: 80,
    backgroundColor: '#2d2d5e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardCoverText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#8b5cf6',
  },
  cardContent: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  cardMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#8b5cf6',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#8b5cf6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  fabText: {
    fontSize: 32,
    color: '#fff',
    fontWeight: '300',
    marginTop: -2,
  },
});
