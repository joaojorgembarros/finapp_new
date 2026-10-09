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
  emphasis,
}: {
  label: string;
  delta: ObservedAmountDelta;
  emphasis?: boolean;
}) {
  const percent = formatObservedPercent(delta.percent);
  return (
    <View style={[styles.row, emphasis && styles.emphasis]}>
      <Text style={[styles.rowLabel, emphasis && styles.emphasisLabel]}>{label}</Text>
      <View style={styles.rowValues}>
        <Text style={[styles.rowAmount, emphasis && styles.emphasisAmount]}>
          {formatBRLFromCents(delta.currentCents)}
        </Text>
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
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{presentation.title}</Text>
      <Text style={styles.caption}>{presentation.caption}</Text>
      {presentation.kind === "insufficient" ? (
        <Text style={styles.empty}>{presentation.message}</Text>
      ) : (
        <View style={styles.rows}>
          <ComparisonRow label={OBSERVED_SUMMARY_COPY.heroResult} delta={presentation.net} emphasis />
          <ComparisonRow label={OBSERVED_SUMMARY_COPY.heroInflow} delta={presentation.inflow} />
          <ComparisonRow label={OBSERVED_SUMMARY_COPY.heroOutflow} delta={presentation.outflow} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6, paddingHorizontal: 2 },
  eyebrow: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  caption: { color: OB.support, fontSize: 12, fontWeight: "700" },
  empty: { color: OB.support, fontSize: 14, fontWeight: "700", lineHeight: 20, marginTop: 4 },
  rows: { gap: 10, marginTop: 6 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  emphasis: {
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(12,35,72,0.08)",
  },
  rowLabel: { color: OB.support, fontSize: 13, fontWeight: "800" },
  emphasisLabel: { color: OB.primary },
  rowValues: { alignItems: "flex-end", gap: 2, flexShrink: 1 },
  rowAmount: { color: OB.primary, fontSize: 14, fontWeight: "800" },
  emphasisAmount: { fontSize: 18, fontWeight: "900" },
  rowDelta: { color: OB.support, fontSize: 12, fontWeight: "700" },
});
