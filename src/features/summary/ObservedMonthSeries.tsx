import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import {
  OBSERVED_HISTORY_COPY,
  buildObservedHistoryTrend,
  type ObservedHistoryMonthRow,
} from "../../lib/observedHistoryPresentation";
import { OB } from "../../ui/OnboardingKit";

const BAR_HEIGHT = 44;

export function ObservedMonthSeries({
  rows,
  gapNote,
}: {
  rows: ObservedHistoryMonthRow[];
  gapNote: string | null;
}) {
  const [open, setOpen] = useState(false);
  const trend = buildObservedHistoryTrend(rows);
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{OBSERVED_HISTORY_COPY.seriesTitle}</Text>
      <View style={styles.chart} accessibilityElementsHidden>
        {trend.map((bar) => (
          <View key={bar.key} style={styles.barSlot}>
            <View
              style={[
                styles.bar,
                bar.tone === "positive" && styles.barPositive,
                bar.tone === "negative" && styles.barNegative,
                bar.tone === "neutral" && styles.barNeutral,
                bar.tone === "missing" && styles.barMissing,
                { height: bar.share > 0 ? Math.max(6, BAR_HEIGHT * bar.share) : 3 },
              ]}
            />
          </View>
        ))}
      </View>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.linkText}>{open ? "Ocultar histórico" : "Ver histórico"}</Text>
      </Pressable>
      {open ? <View style={styles.list}>
        {gapNote ? <Text style={styles.gapNote}>{gapNote}</Text> : null}
        {rows.map((row, index) => (
          <View key={row.key} style={[styles.month, index > 0 && styles.monthRule]}>
            <Text style={styles.short}>{row.shortLabel}</Text>
            <View style={styles.monthBody}>
              <Text
                style={[
                  styles.amount,
                  row.tone === "positive" && styles.positive,
                  row.tone === "negative" && styles.negative,
                  row.tone === "missing" && styles.missing,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {row.netLabel ?? row.note}
              </Text>
              {row.tone === "missing" ? null : (
                <Text style={styles.flow} numberOfLines={1}>
                  {`Entrou ${formatBRLFromCents(row.inflowCents)} · Saiu ${formatBRLFromCents(row.outflowCents)}`}
                </Text>
              )}
              {row.netLabel && row.note ? <Text style={styles.note}>{row.note}</Text> : null}
            </View>
          </View>
        ))}
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, paddingHorizontal: 2 },
  eyebrow: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  gapNote: { color: OB.support, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  link: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  linkText: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.82 },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    height: BAR_HEIGHT,
    marginTop: 4,
  },
  barSlot: { flex: 1, justifyContent: "flex-end" },
  bar: { borderRadius: 999, width: "100%" },
  barPositive: { backgroundColor: "#168A59" },
  barNegative: { backgroundColor: "#C48989" },
  barNeutral: { backgroundColor: OB.support },
  barMissing: { backgroundColor: "rgba(123,160,200,0.45)" },
  list: { marginTop: 4 },
  month: { gap: 2, paddingVertical: 12 },
  monthRule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(12,35,72,0.08)",
  },
  short: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  monthBody: { gap: 2 },
  amount: { color: OB.primary, fontSize: 22, fontWeight: "900" },
  positive: { color: "#168A59" },
  negative: { color: "#A33F3F" },
  missing: { color: OB.support, fontSize: 16, fontWeight: "800" },
  flow: { color: OB.support, fontSize: 12, fontWeight: "700" },
  note: { color: OB.support, fontSize: 12, fontWeight: "700" },
});
