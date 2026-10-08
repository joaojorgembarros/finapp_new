import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  OBSERVED_HISTORY_RANGE_OPTIONS,
} from "../../lib/observedHistoryPresentation";
import type { ObservedHistoryRange } from "../../lib/financialObservedHistory";
import { OB } from "../../ui/OnboardingKit";

export function ObservedHistoryRangeSelector({
  range,
  onChange,
}: {
  range: ObservedHistoryRange;
  onChange: (range: ObservedHistoryRange) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {OBSERVED_HISTORY_RANGE_OPTIONS.map((option) => {
        const selected = option.id === range;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[styles.label, selected && styles.labelSelected]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
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
  row: {
    flexDirection: "row",
    gap: 6,
  },
  chip: {
    flex: 1,
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  chipSelected: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
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
