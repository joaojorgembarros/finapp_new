import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  MOVEMENT_FLOW_FILTERS,
  movementMonthLabel,
  shouldShowAccountFilter,
  type MovementFlowFilter,
} from "../../lib/movementHistoryPresentation";
import { OB } from "../../ui/OnboardingKit";

export function MovementFilters({
  flow,
  month,
  account,
  months,
  accounts,
  onFlowChange,
  onMonthChange,
  onAccountChange,
}: {
  flow: MovementFlowFilter;
  month: string;
  account: string;
  months: string[];
  accounts: { id: string; name: string }[];
  onFlowChange: (flow: MovementFlowFilter) => void;
  onMonthChange: (month: string) => void;
  onAccountChange: (account: string) => void;
}) {
  const showAccount = shouldShowAccountFilter(accounts.map((item) => item.id));

  return (
    <View style={styles.stack}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {MOVEMENT_FLOW_FILTERS.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => onFlowChange(item.id)}
            style={[styles.chip, flow === item.id && styles.chipActive]}
          >
            <Text style={[styles.chipText, flow === item.id && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Pressable onPress={() => onMonthChange("all")} style={[styles.smallChip, month === "all" && styles.smallChipActive]}>
          <Text style={[styles.smallChipText, month === "all" && styles.smallChipTextActive]}>Todos os períodos</Text>
        </Pressable>
        {months.map((item) => (
          <Pressable key={item} onPress={() => onMonthChange(item)} style={[styles.smallChip, month === item && styles.smallChipActive]}>
            <Text style={[styles.smallChipText, month === item && styles.smallChipTextActive]}>{movementMonthLabel(item)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {showAccount ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Pressable onPress={() => onAccountChange("all")} style={[styles.smallChip, account === "all" && styles.smallChipActive]}>
            <Text style={[styles.smallChipText, account === "all" && styles.smallChipTextActive]}>Todas as contas</Text>
          </Pressable>
          {accounts.map((item) => (
            <Pressable key={item.id} onPress={() => onAccountChange(item.id)} style={[styles.smallChip, account === item.id && styles.smallChipActive]}>
              <Text style={[styles.smallChipText, account === item.id && styles.smallChipTextActive]}>{item.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  row: { gap: 8, paddingRight: 4 },
  chip: {
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  chipActive: { backgroundColor: OB.primary, borderColor: OB.primary },
  chipText: { color: OB.support, fontSize: 12, fontWeight: "800" },
  chipTextActive: { color: "#fff" },
  smallChip: {
    minHeight: 32,
    borderRadius: 10,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  smallChipActive: { backgroundColor: "rgba(6,25,54,0.10)", borderColor: "rgba(6,25,54,0.30)" },
  smallChipText: { color: OB.support, fontSize: 11, fontWeight: "800" },
  smallChipTextActive: { color: OB.primary, fontWeight: "900" },
});
