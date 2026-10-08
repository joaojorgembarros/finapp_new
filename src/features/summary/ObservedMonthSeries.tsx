import React from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  OBSERVED_HISTORY_COPY,
  type ObservedHistoryMonthRow,
} from "../../lib/observedHistoryPresentation";
import { OB } from "../../ui/OnboardingKit";

export function ObservedMonthSeries({
  rows,
  gapNote,
}: {
  rows: ObservedHistoryMonthRow[];
  gapNote: string | null;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{OBSERVED_HISTORY_COPY.seriesTitle}</Text>
      {gapNote ? <Text style={styles.gapNote}>{gapNote}</Text> : null}
      <View style={styles.list}>
        {rows.map((row) => (
          <View key={row.key} style={styles.row}>
            <View style={styles.month}>
              <Text style={styles.monthLabel}>{row.label}</Text>
              {row.netLabel && row.note ? <Text style={styles.note}>{row.note}</Text> : null}
            </View>
            <Text
              style={[
                styles.amount,
                row.tone === "positive" && styles.positive,
                row.tone === "negative" && styles.negative,
                row.tone === "missing" && styles.missing,
              ]}
            >
              {row.netLabel ?? row.note}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    padding: 16,
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  title: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  gapNote: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  list: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  month: { flex: 1, gap: 2 },
  monthLabel: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  note: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
  },
  amount: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  positive: { color: "#168A59" },
  negative: { color: "#A33F3F" },
  missing: { color: OB.support, fontWeight: "800" },
});
