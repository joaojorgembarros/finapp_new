import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import {
  OBSERVED_SUMMARY_COPY,
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
  const hasUncategorized = rows.some((row) => row.uncategorized);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{OBSERVED_SUMMARY_COPY.categoriesTitle}</Text>
      {rows.length ? (
        <View style={styles.list}>
          {rows.map((row) => (
            <View key={row.key} style={styles.row}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
                <Text style={styles.percent}>{`${Math.round(row.percentageOfOutflows)}% das saídas`}</Text>
              </View>
              <Text style={styles.amount}>{formatBRLFromCents(row.amountCents)}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>{OBSERVED_SUMMARY_COPY.categoriesEmpty}</Text>
      )}
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
  card: {
    borderRadius: 22,
    padding: 16,
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  title: { color: OB.primary, fontSize: 16, fontWeight: "900" },
  list: { gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  name: { color: OB.primary, fontSize: 14, fontWeight: "800" },
  percent: { color: OB.support, fontSize: 12, fontWeight: "700", marginTop: 2 },
  amount: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  empty: { color: OB.support, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  link: {
    alignSelf: "flex-start",
    minHeight: 36,
    justifyContent: "center",
  },
  linkText: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  pressed: { opacity: 0.82 },
});
