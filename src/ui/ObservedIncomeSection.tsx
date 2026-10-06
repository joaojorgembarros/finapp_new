import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../lib/format";
import type { ObservedOtherInflows, ObservedRecurringIncome } from "../lib/financialPatternDetection";
import {
  incomeAccountLabel,
  incomeAcknowledgementKey,
  incomeCardAction,
  incomeEstimateChanged,
  type IncomeAcknowledgement,
} from "../lib/incomeAcknowledgementPlan";
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
  acknowledgements,
  acknowledgementsUnavailable,
  onUseIncome,
  onReviewIncome,
}: {
  recurring: ObservedRecurringIncome[];
  otherInflows: ObservedOtherInflows | null;
  acknowledgements: IncomeAcknowledgement[];
  acknowledgementsUnavailable: boolean;
  onUseIncome: (income: ObservedRecurringIncome) => void;
  onReviewIncome: (income: ObservedRecurringIncome) => void;
}) {
  const visibleIncome = selectVisibleRecurringIncome(recurring);
  const hiddenIncome = hiddenRecurringIncomeLabel(recurring.length - visibleIncome.length);
  const acknowledgementsByKey = new Map(acknowledgements.map((item) => [item.patternKey, item]));
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
              const acknowledgement = acknowledgementsByKey.get(incomeAcknowledgementKey(income)) ?? null;
              const action = incomeCardAction(acknowledgement, acknowledgementsUnavailable);
              const estimateChanged = incomeEstimateChanged({
                acknowledgement,
                estimatedMonthlyCents: income.estimatedMonthlyCents,
                behaviorType: income.behaviorType,
              });
              return (
                <View key={income.patternKey} style={[styles.row, index === 0 && styles.rowFirst]}>
                  <View style={styles.top}>
                    <Text style={styles.name} numberOfLines={1}>{observedIncomeTitle(income.normalizedMerchant)}</Text>
                    <Text style={styles.amount}>≈ {formatBRLFromCents(income.estimatedMonthlyCents)}/mês</Text>
                  </View>
                  <Text style={styles.meta}>{incomeAccountLabel(income.accountId)}</Text>
                  {day ? <Text style={styles.meta}>{day}</Text> : null}
                  {variation ? <Text style={styles.meta}>{variation}</Text> : null}
                  <Text style={styles.meta}>{observedIncomeDetectedLabel(income.monthsDetected)}</Text>
                  {estimateChanged ? <Text style={styles.meta}>Valor observado mudou</Text> : null}
                  {action === "review" ? <Text style={styles.meta}>Não incluída no planejamento</Text> : null}
                  {action === "use" ? (
                    <Pressable onPress={() => onUseIncome(income)} accessibilityRole="button" accessibilityLabel="Usar no planejamento">
                      <Text style={styles.action}>Usar no planejamento</Text>
                    </Pressable>
                  ) : null}
                  {action === "review" ? (
                    <Pressable onPress={() => onReviewIncome(income)} accessibilityRole="button" accessibilityLabel="Rever">
                      <Text style={styles.action}>Rever</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
          {hiddenIncome ? <Text style={styles.subtitle}>{hiddenIncome}</Text> : null}
          {acknowledgementsUnavailable ? (
            <Text style={styles.subtitle}>Não foi possível carregar o estado do planejamento.</Text>
          ) : null}
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
  action: { color: OB.primary, fontSize: 13, fontWeight: "800", marginTop: 4 },
});
