import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../lib/format";
import type { ObservedOtherInflows, ObservedRecurringIncome } from "../lib/financialPatternDetection";
import { OB } from "./OnboardingKit";
import {
  OBSERVED_OTHER_INFLOWS_NOTE,
  hiddenRecurringIncomeLabel,
  observedIncomeDayLabel,
  observedIncomeDetectedLabel,
  observedIncomeTitle,
  observedIncomeVariationLabel,
  observedOtherInflowsBasisLabel,
  selectVisibleRecurringIncome,
} from "./observedIncomeCopy";

export function ObservedIncomeSection({
  recurring,
  otherInflows,
}: {
  recurring: ObservedRecurringIncome[];
  otherInflows: ObservedOtherInflows | null;
}) {
  const visibleIncome = selectVisibleRecurringIncome(recurring);
  const hiddenIncome = hiddenRecurringIncomeLabel(recurring.length - visibleIncome.length);
  if (!visibleIncome.length && !otherInflows) return null;

  return (
    <View style={styles.section}>
      {visibleIncome.length ? (
        <View style={styles.block}>
          <Text style={styles.title}>Renda identificada</Text>
          <View style={styles.list}>
            {visibleIncome.map((income, index) => {
              const day = observedIncomeDayLabel(income.approximateDay);
              const variation = observedIncomeVariationLabel(income.behaviorType === "variable_recurring_income");
              return (
                <View key={income.patternKey} style={[styles.row, index === 0 && styles.rowFirst]}>
                  <View style={styles.top}>
                    <Text style={styles.name} numberOfLines={1}>{observedIncomeTitle(income.normalizedMerchant)}</Text>
                    <Text style={styles.amount}>≈ {formatBRLFromCents(income.estimatedMonthlyCents)}/mês</Text>
                  </View>
                  {day ? <Text style={styles.meta}>{day}</Text> : null}
                  {variation ? <Text style={styles.meta}>{variation}</Text> : null}
                  <Text style={styles.meta}>{observedIncomeDetectedLabel(income.monthsDetected)}</Text>
                </View>
              );
            })}
          </View>
          {hiddenIncome ? <Text style={styles.subtitle}>{hiddenIncome}</Text> : null}
        </View>
      ) : null}

      {otherInflows ? (
        <View style={styles.block}>
          <Text style={styles.title}>Outras entradas observadas</Text>
          <Text style={styles.subtitle}>{OBSERVED_OTHER_INFLOWS_NOTE}</Text>
          <View style={styles.list}>
            <View style={[styles.row, styles.rowFirst]}>
              <Text style={styles.amount}>≈ {formatBRLFromCents(otherInflows.estimatedMonthlyCents)}/mês</Text>
              <Text style={styles.meta}>
                {observedOtherInflowsBasisLabel(otherInflows.monthsUsed.map((month) => month.monthKey))}
              </Text>
              <Text style={styles.meta}>
                Neste mês: {formatBRLFromCents(otherInflows.currentMonthObservedCents)} até agora
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 8 },
  block: { gap: 8 },
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
