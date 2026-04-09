import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

interface Props {
  completed: number;
  total: number;
  onPressIncomplete?: () => void;
  /** Örn. "2 odada 360° kapsam eksik" */
  coverageHint?: string | null;
}

export function TourProgress({ completed, total, onPressIncomplete, coverageHint }: Props) {
  const pct = total > 0 ? (completed / total) * 100 : 0;
  const allDone = completed === total && total > 0;

  return (
    <View style={styles.wrapper}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {allDone ? 'Tüm odalar tamamlandı' : `${completed} / ${total} oda çekildi`}
        </Text>
        {!allDone && total > 0 && (
          <TouchableOpacity onPress={onPressIncomplete} hitSlop={8}>
            <Text style={styles.link}>Eksikleri gör</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.barBg}>
        <View
          style={[
            styles.barFill,
            { width: `${pct}%` as any },
            allDone && styles.barFillComplete,
          ]}
        />
      </View>
      {coverageHint ? <Text style={styles.coverageHint}>{coverageHint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { marginBottom: 16 },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: { color: '#9ca3af', fontSize: 13, fontWeight: '500' },
  link: { color: '#8b5cf6', fontSize: 13, fontWeight: '600' },
  barBg: {
    height: 6,
    backgroundColor: '#1e1e3a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#8b5cf6',
    borderRadius: 3,
  },
  barFillComplete: {
    backgroundColor: '#34d399',
  },
  coverageHint: {
    color: '#fbbf24',
    fontSize: 12,
    marginTop: 8,
    lineHeight: 16,
  },
});
