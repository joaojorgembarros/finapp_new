import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import type { KnownCashCardPresentation } from "../../lib/knownCashPresentation";
import { OB } from "../../ui/OnboardingKit";

export function ObservedKnownCashCard({
  presentation,
  onRetry,
}: {
  presentation: KnownCashCardPresentation;
  onRetry: () => void;
}) {
  if (presentation.kind === "loading") {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{presentation.title}</Text>
        <View style={styles.loadingRow}>
          <ActivityIndicator color={OB.support} size="small" />
          <Text style={styles.detail}>{presentation.message}</Text>
        </View>
      </View>
    );
  }

  if (presentation.kind === "error") {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{presentation.title}</Text>
        <Text style={styles.detail}>{presentation.message}</Text>
        <Pressable onPress={onRetry} style={styles.retry}>
          <Text style={styles.retryText}>{presentation.retryLabel}</Text>
        </Pressable>
      </View>
    );
  }

  if (presentation.kind === "unavailable") {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{presentation.title}</Text>
        <Text style={styles.detail}>{presentation.detail}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{presentation.title}</Text>
      <Text style={[styles.amount, presentation.amountCents < 0 && styles.negative]}>
        {formatBRLFromCents(presentation.amountCents)}
      </Text>
      <Text style={styles.caption}>{presentation.caption}</Text>
      {presentation.notes.map((note) => (
        <Text key={note} style={styles.note}>{note}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 4,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  title: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  amount: {
    color: OB.primary,
    fontSize: 22,
    fontWeight: "900",
  },
  negative: { color: "#A33F3F" },
  caption: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  detail: {
    color: OB.support,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  note: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  retry: {
    alignSelf: "flex-start",
    minHeight: 36,
    justifyContent: "center",
  },
  retryText: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "800",
  },
});
