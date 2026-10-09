import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ObservedHistoryRange } from "../../lib/financialObservedHistory";
import { OBSERVED_HISTORY_RANGE_OPTIONS } from "../../lib/observedHistoryPresentation";
import { OB } from "../../ui/OnboardingKit";

export function ObservedHistoryRangeSelector({
  range,
  onChange,
}: {
  range: ObservedHistoryRange;
  onChange: (range: ObservedHistoryRange) => void;
}) {
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {OBSERVED_HISTORY_RANGE_OPTIONS.map((option) => {
        const selected = option.id === range;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={({ pressed }) => [
              styles.segment,
              selected && styles.segmentSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[styles.label, selected && styles.labelSelected]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 999,
    backgroundColor: "rgba(12,35,72,0.06)",
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentSelected: {
    backgroundColor: OB.primary,
  },
  label: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
  },
  labelSelected: {
    color: "#fff",
    fontWeight: "900",
  },
  pressed: { opacity: 0.82 },
});
