import { View, Text, StyleSheet } from 'react-native';
import {
  SECTOR_COUNT,
  SECTOR_LABELS_TR,
  sectorCenterDeg,
} from '@/src/utils/sectorCoverage';

interface Props {
  size?: number;
  mask: boolean[];
  activeSector: number | null;
}

export function CoverageRing({ size = 168, mask, activeSector }: Props) {
  const dotR = 10;
  const ringR = size / 2 - dotR - 4;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {Array.from({ length: SECTOR_COUNT }, (_, i) => {
        const deg = sectorCenterDeg(i) - 90;
        const rad = (deg * Math.PI) / 180;
        const x = size / 2 + ringR * Math.cos(rad) - dotR;
        const y = size / 2 + ringR * Math.sin(rad) - dotR;
        const filled = mask[i];
        const active = activeSector === i;
        return (
          <View
            key={i}
            style={[
              styles.dot,
              {
                width: dotR * 2,
                height: dotR * 2,
                borderRadius: dotR,
                left: x,
                top: y,
                backgroundColor: filled ? '#34d399' : '#3f3f5a',
                borderWidth: active ? 3 : 0,
                borderColor: '#c4b5fd',
              },
            ]}
          />
        );
      })}
      <View style={styles.center}>
        <Text style={styles.centerTitle}>360°</Text>
        <Text style={styles.centerSub}>
          {mask.filter(Boolean).length}/{SECTOR_COUNT}
        </Text>
      </View>
      <View style={styles.legend}>
        {SECTOR_LABELS_TR.map((label, i) => (
          <Text
            key={label}
            style={[
              styles.legendText,
              mask[i] && styles.legendFilled,
              activeSector === i && styles.legendActive,
            ]}
            numberOfLines={1}
          >
            {mask[i] ? '✓' : '·'} {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
    marginVertical: 8,
  },
  dot: {
    position: 'absolute',
  },
  center: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  centerSub: { color: '#9ca3af', fontSize: 11, marginTop: 2 },
  legend: {
    position: 'absolute',
    left: -40,
    right: -40,
    bottom: -56,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
  },
  legendText: { color: '#6b7280', fontSize: 9 },
  legendFilled: { color: '#6ee7b7' },
  legendActive: { color: '#c4b5fd', fontWeight: '700' },
});
