import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatBreakdownAmount, type BreakdownLine } from "../../lib/allocatableCashPresentation";
import { OB } from "../../ui/OnboardingKit";

export function AllocatableCashBreakdown({
  lines,
  onDark = false,
}: {
  lines: BreakdownLine[];
  onDark?: boolean;
}) {
  if (!lines.length) return null;
  return (
    <View style={styles.list}>
      {lines.map((line) => (
        <View
          key={line.key}
          style={[styles.row, line.tone === "total" && styles.totalRow, line.tone === "total" && onDark && styles.totalRowOnDark]}
          accessibilityLabel={`${line.label} ${formatBreakdownAmount(line)}`}
        >
          <Text style={[styles.label, onDark && styles.onDark, line.tone === "total" && styles.totalLabel, line.tone === "total" && onDark && styles.onDark]}>
            {line.label}
          </Text>
          <Text style={[
            styles.amount,
            onDark && styles.onDark,
            line.tone === "minus" && styles.minus,
            line.tone === "minus" && onDark && styles.minusOnDark,
            line.tone === "total" && styles.totalAmount,
          ]}>
            {formatBreakdownAmount(line)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  totalRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OB.supportSoft,
    paddingTop: 8,
    marginTop: 2,
  },
  totalRowOnDark: { borderTopColor: "rgba(255,255,255,0.18)" },
  onDark: { color: "#fff" },
  minusOnDark: { color: "rgba(255,220,190,0.92)" },
  label: { flex: 1, color: OB.support, fontSize: 13, fontWeight: "700" },
  totalLabel: { color: OB.primary, fontWeight: "900" },
  amount: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  minus: { color: "#8A5A2A" },
  totalAmount: { fontSize: 15, fontWeight: "900" },
});
