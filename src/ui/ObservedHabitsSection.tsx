import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../lib/format";
import type { ObservedFinancialHabitView } from "../lib/financialPatternSuggestions";
import { OB } from "./OnboardingKit";
import { observedHabitBasisLabel, observedHabitOutlierLabel } from "./observedHabitCopy";

export function ObservedHabitsSection({ habits }: { habits: ObservedFinancialHabitView[] }) {
  if (!habits.length) return null;

  return (
    <View style={styles.section} accessibilityRole="summary">
      <Text style={styles.title}>Hábitos observados</Text>
      <Text style={styles.subtitle}>Observação do histórico. Não entra no planejamento.</Text>
      <View style={styles.list}>
        {habits.map((habit, index) => {
          const basis = observedHabitBasisLabel(habit.monthsUsed.map((month) => month.monthKey));
          const atypical = observedHabitOutlierLabel(Boolean(habit.outlierMonthDiscarded));
          return (
            <View key={habit.categoryId} style={[styles.row, index === 0 && styles.rowFirst]}>
              <View style={styles.top}>
                <Text style={styles.name} numberOfLines={1}>
                  {habit.categoryName || "Categoria"}
                </Text>
                <Text style={styles.amount}>≈ {formatBRLFromCents(habit.estimatedMonthlyCents)}/mês</Text>
              </View>
              <Text style={styles.meta}>{basis}</Text>
              <Text style={styles.meta}>
                Neste mês: {formatBRLFromCents(habit.currentMonthSpentCents)} até agora
              </Text>
              {atypical ? <Text style={styles.meta}>{atypical}</Text> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8, marginTop: 8 },
  title: { color: OB.primary, fontSize: 18, fontWeight: "900" },
  subtitle: { color: OB.support, fontSize: 10, fontWeight: "700", lineHeight: 15 },
  list: {
    borderRadius: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
    overflow: "hidden",
  },
  row: {
    gap: 2,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: OB.supportSoft,
  },
  rowFirst: { borderTopWidth: 0 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  name: { flex: 1, color: OB.primary, fontSize: 14, fontWeight: "800" },
  amount: { color: OB.primary, fontSize: 13, fontWeight: "900" },
  meta: { color: OB.support, fontSize: 11, fontWeight: "700", lineHeight: 15 },
});
