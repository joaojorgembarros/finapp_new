import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import {
  OBSERVED_SUMMARY_COPY,
  splitObservedCategoryPreview,
  type ObservedCategoryRow,
} from "../../lib/observedSummaryPresentation";
import { OB } from "../../ui/OnboardingKit";

export function ObservedCategoryBreakdown({
  rows,
  onOrganizeCategories,
}: {
  rows: ObservedCategoryRow[];
  onOrganizeCategories?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const split = splitObservedCategoryPreview(rows);
  const shown = showAll ? rows : split.visible;
  const hasUncategorized = shown.some((row) => row.uncategorized);
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{OBSERVED_SUMMARY_COPY.categoriesTitle}</Text>
      {shown.length ? (
        <View style={styles.list}>
          {shown.map((row) => {
            const width = Math.max(0, Math.min(100, row.percentageOfOutflows));
            return (
              <View key={row.key} style={styles.row}>
                <View style={styles.top}>
                  <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
                  <Text style={styles.amount}>{formatBRLFromCents(row.amountCents)}</Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.fill, { width: `${width}%` }]} />
                </View>
                <Text style={styles.percent}>{`${Math.round(row.percentageOfOutflows)}% das saídas`}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={styles.empty}>{OBSERVED_SUMMARY_COPY.categoriesEmpty}</Text>
      )}
      {split.hidden.length ? (
        <Pressable
          onPress={() => setShowAll((current) => !current)}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityState={{ expanded: showAll }}
        >
          <Text style={styles.linkText}>{showAll ? "Mostrar menos" : "Ver todas as categorias"}</Text>
        </Pressable>
      ) : null}
      {hasUncategorized && onOrganizeCategories ? (
        <Pressable
          onPress={onOrganizeCategories}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Text style={styles.linkText}>{OBSERVED_SUMMARY_COPY.organizeCategories}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, paddingHorizontal: 2 },
  eyebrow: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  list: { gap: 14 },
  row: { gap: 6 },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  name: { flex: 1, color: OB.primary, fontSize: 14, fontWeight: "800" },
  amount: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  track: {
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(12,35,72,0.08)",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: OB.primaryAlt,
  },
  percent: { color: OB.support, fontSize: 12, fontWeight: "700" },
  empty: { color: OB.support, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  link: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  linkText: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.82 },
});
