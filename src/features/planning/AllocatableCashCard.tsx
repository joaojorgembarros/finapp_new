import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { AllocatableCashView } from "../../lib/allocatableCashPresentation";
import { formatBRLFromCents } from "../../lib/format";
import { OB } from "../../ui/OnboardingKit";
import { AllocatableCashBreakdown } from "./AllocatableCashBreakdown";

export function AllocatableCashCard({
  presentation,
  notice,
  onRetry,
  onImport,
  onDistribute,
}: {
  presentation: AllocatableCashView;
  notice?: string | null;
  onRetry: () => void;
  onImport: () => void;
  onDistribute: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{presentation.title}</Text>
      {notice ? (
        <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text>
      ) : null}
      {presentation.kind === "loading" ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={OB.primary} accessibilityLabel={presentation.message} />
          <Text style={styles.body}>{presentation.message}</Text>
        </View>
      ) : null}
      {presentation.kind === "error" ? (
        <>
          <Text style={styles.body}>{presentation.message}</Text>
          <Pressable
            onPress={onRetry}
            style={styles.secondaryButton}
            accessibilityRole="button"
            accessibilityLabel={presentation.retryLabel}
          >
            <Text style={styles.secondaryText}>{presentation.retryLabel}</Text>
          </Pressable>
        </>
      ) : null}
      {presentation.kind === "blocked" ? (
        <>
          <Text style={styles.body}>{presentation.message}</Text>
          {presentation.detail ? <Text style={styles.detail}>{presentation.detail}</Text> : null}
          {presentation.extraReasons.map((reason) => (
            <Text key={reason} style={styles.detail}>{reason}</Text>
          ))}
          {presentation.asOf ? <Text style={styles.asOf}>{presentation.asOf}</Text> : null}
          {presentation.ctaLabel ? (
            <Pressable
              onPress={onImport}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel={presentation.ctaLabel}
            >
              <Text style={styles.secondaryText}>{presentation.ctaLabel}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {presentation.kind === "none" ? (
        <>
          <Text style={styles.body}>{presentation.message}</Text>
          {presentation.asOf ? <Text style={styles.asOf}>{presentation.asOf}</Text> : null}
          <AllocatableCashBreakdown lines={presentation.breakdown} />
        </>
      ) : null}
      {presentation.kind === "ready" ? (
        <>
          <Text style={styles.amount} accessibilityLabel={`${presentation.title} ${formatBRLFromCents(presentation.amountCents)}`}>
            {formatBRLFromCents(presentation.amountCents)}
          </Text>
          <Text style={styles.body}>{presentation.message}</Text>
          {presentation.asOf ? <Text style={styles.asOf}>{presentation.asOf}</Text> : null}
          <AllocatableCashBreakdown lines={presentation.breakdown} />
          <Pressable
            onPress={onDistribute}
            style={styles.primaryButton}
            accessibilityRole="button"
            accessibilityLabel={presentation.ctaLabel}
          >
            <Text style={styles.primaryText}>{presentation.ctaLabel}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  eyebrow: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  amount: { color: OB.primary, fontSize: 32, fontWeight: "900" },
  body: { color: OB.primary, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  detail: { color: OB.support, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  asOf: { color: OB.support, fontSize: 12, fontWeight: "700" },
  notice: { color: "#1F6B45", fontSize: 14, fontWeight: "800", lineHeight: 20 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
    marginTop: 4,
  },
  primaryText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: OB.primary,
  },
  secondaryText: { color: OB.primary, fontSize: 14, fontWeight: "900" },
});
