import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import {
  OBSERVED_SUMMARY_COPY,
  formatObservedPercent,
  formatObservedSignedCents,
  type ObservedAmountDelta,
  type ObservedComparisonPresentation,
} from "../../lib/observedSummaryPresentation";
import { OB } from "../../ui/OnboardingKit";

function ComparisonRow({
  label,
  delta,
}: {
  label: string;
  delta: ObservedAmountDelta;
}) {
  const percent = formatObservedPercent(delta.percent);
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowValues}>
        <Text style={styles.rowAmount}>{formatBRLFromCents(delta.currentCents)}</Text>
        <Text style={styles.rowDelta}>
          {formatObservedSignedCents(delta.deltaCents)}
          {percent ? ` · ${percent}` : ""}
        </Text>
      </View>
    </View>
  );
}

export function ObservedComparisonCard({
  presentation,
}: {
  presentation: ObservedComparisonPresentation;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{presentation.title}</Text>
      <Text style={styles.caption}>{presentation.caption}</Text>
      {presentation.kind === "insufficient" ? (
        <Text style={styles.empty}>{presentation.message}</Text>
      ) : (
        <View style={styles.rows}>
          <ComparisonRow label={OBSERVED_SUMMARY_COPY.heroInflow} delta={presentation.inflow} />
          <ComparisonRow label={OBSERVED_SUMMARY_COPY.heroOutflow} delta={presentation.outflow} />
          <ComparisonRow label={OBSERVED_SUMMARY_COPY.heroResult} delta={presentation.net} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    padding: 16,
    gap: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  title: { color: OB.primary, fontSize: 16, fontWeight: "900" },
  caption: { color: OB.support, fontSize: 12, fontWeight: "700" },
  empty: {
    color: OB.support,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 4,
  },
  rows: { gap: 10, marginTop: 6 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  rowLabel: { color: OB.support, fontSize: 13, fontWeight: "800" },
  rowValues: { alignItems: "flex-end", gap: 2 },
  rowAmount: { color: OB.primary, fontSize: 15, fontWeight: "900" },
  rowDelta: { color: OB.support, fontSize: 12, fontWeight: "700" },
});
