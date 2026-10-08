import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatBreakdownAmount, type BreakdownLine } from "../../lib/allocatableCashPresentation";
import { OB } from "../../ui/OnboardingKit";

export function AllocatableCashBreakdown({ lines }: { lines: BreakdownLine[] }) {
  if (!lines.length) return null;
  return (
    <View style={styles.list}>
      {lines.map((line) => (
        <View
          key={line.key}
          style={[styles.row, line.tone === "total" && styles.totalRow]}
          accessibilityLabel={`${line.label} ${formatBreakdownAmount(line)}`}
        >
          <Text style={[styles.label, line.tone === "total" && styles.totalLabel]}>{line.label}</Text>
          <Text style={[styles.amount, line.tone === "minus" && styles.minus, line.tone === "total" && styles.totalAmount]}>
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
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    paddingTop: 8,
    marginTop: 2,
  },
  label: { flex: 1, color: OB.support, fontSize: 13, fontWeight: "700" },
  totalLabel: { color: OB.primary, fontWeight: "900" },
  amount: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  minus: { color: "#8A5A2A" },
  totalAmount: { fontSize: 15, fontWeight: "900" },
});
