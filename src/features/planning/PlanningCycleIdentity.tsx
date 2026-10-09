import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { FinancialCycle } from "../../lib/financialPlanning";
import { cycleTimeProgress, formatCycleSpan } from "../../lib/planningPresentation";
import { OB } from "../../ui/OnboardingKit";

export function PlanningCycleIdentity({
  cycle,
  referenceDate,
}: {
  cycle: FinancialCycle;
  referenceDate: string;
}) {
  const span = formatCycleSpan(cycle.start, cycle.end);
  const progress = cycleTimeProgress({
    start: cycle.start,
    end: cycle.end,
    referenceDate,
  });
  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>Seu ciclo</Text>
      <Text style={styles.span}>{span ?? cycle.label}</Text>
      {span && span !== cycle.label ? <Text style={styles.label}>{cycle.label}</Text> : null}
      {progress ? (
        <View style={styles.progressBlock}>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(progress.ratio * 1000) / 10}%` }]} />
          </View>
          <Text style={styles.caption}>{progress.caption}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  eyebrow: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  span: { color: OB.primary, fontSize: 22, fontWeight: "900" },
  label: { color: OB.support, fontSize: 13, fontWeight: "700" },
  progressBlock: { gap: 6, marginTop: 6 },
  track: {
    height: 6,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(12,35,72,0.08)",
  },
  fill: { height: "100%", borderRadius: 999, backgroundColor: OB.primaryAlt },
  caption: { color: OB.support, fontSize: 11, fontWeight: "700" },
});
