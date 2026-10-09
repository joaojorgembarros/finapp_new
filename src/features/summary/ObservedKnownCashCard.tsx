import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import type { KnownCashCardPresentation } from "../../lib/knownCashPresentation";
import { DisclosureSection } from "../../ui/DisclosureSection";
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
      <View style={styles.row}>
        <Text style={styles.title}>{presentation.title}</Text>
        <ActivityIndicator color={OB.support} size="small" />
      </View>
    );
  }

  if (presentation.kind === "error") {
    return (
      <View style={styles.stack}>
        <Text style={styles.title}>{presentation.title}</Text>
        <Text style={styles.detail}>{presentation.message}</Text>
        <Pressable onPress={onRetry} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryText}>{presentation.retryLabel}</Text>
        </Pressable>
      </View>
    );
  }

  const summary = presentation.kind === "ready"
    ? formatBRLFromCents(presentation.amountCents)
    : "Indisponível";

  return (
    <DisclosureSection title={presentation.kind === "ready" ? presentation.title : "Saldo conhecido"} summary={summary} layout="inline">
      {presentation.kind === "unavailable" ? (
        <Text style={styles.detail}>{presentation.detail}</Text>
      ) : (
        <>
          <Text style={styles.caption}>{presentation.caption}</Text>
          {presentation.notes.map((note) => (
            <Text key={note} style={styles.detail}>{note}</Text>
          ))}
        </>
      )}
    </DisclosureSection>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    borderRadius: 18,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#EEF3F8",
  },
  stack: {
    borderRadius: 18,
    padding: 14,
    gap: 6,
    backgroundColor: "#EEF3F8",
  },
  title: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  caption: { color: OB.primary, fontSize: 13, fontWeight: "800" },
  detail: { color: OB.support, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  retry: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  retryText: { color: OB.primary, fontSize: 13, fontWeight: "800" },
});
