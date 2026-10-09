import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  buildAllocatableComposition,
  type BreakdownLine,
} from "../../lib/allocatableCashPresentation";

const SEGMENT_ON_DARK = {
  earmarked: "rgba(255,255,255,0.42)",
  pending: "rgba(232,196,154,0.95)",
  reserve: "rgba(160,200,235,0.95)",
  available: "#ffffff",
} as const;

const SEGMENT_ON_LIGHT = {
  earmarked: "rgba(12,35,72,0.35)",
  pending: "#C4A27A",
  reserve: "#7BA0C8",
  available: "#0C2348",
} as const;

export function AllocatableCashComposition({
  lines,
  onDark = false,
}: {
  lines: BreakdownLine[];
  onDark?: boolean;
}) {
  const composition = buildAllocatableComposition(lines);
  if (!composition.knownCents || !composition.segments.length) return null;
  const colors = onDark ? SEGMENT_ON_DARK : SEGMENT_ON_LIGHT;
  const used = composition.segments.reduce((sum, segment) => sum + segment.share, 0);
  const remainder = Math.max(0, 1 - used);

  return (
    <View style={styles.wrap}>
      <View style={[styles.track, onDark && styles.trackOnDark]}>
        {composition.segments.map((segment) => (
          <View
            key={segment.key}
            style={{
              width: `${segment.share * 100}%`,
              backgroundColor: colors[segment.key],
            }}
          />
        ))}
        {remainder > 0 ? <View style={{ width: `${remainder * 100}%` }} /> : null}
      </View>
      <View style={styles.legend}>
        {composition.segments.map((segment) => (
          <Text
            key={segment.key}
            style={[styles.legendItem, onDark && styles.legendOnDark]}
            numberOfLines={1}
          >
            {segment.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 4 },
  track: {
    height: 10,
    borderRadius: 999,
    overflow: "hidden",
    flexDirection: "row",
    backgroundColor: "rgba(12,35,72,0.08)",
  },
  trackOnDark: { backgroundColor: "rgba(255,255,255,0.14)" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  legendItem: { color: "#64748b", fontSize: 11, fontWeight: "700" },
  legendOnDark: { color: "rgba(255,255,255,0.78)" },
});
