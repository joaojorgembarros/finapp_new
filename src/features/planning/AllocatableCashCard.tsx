import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { ALLOCATABLE_CASH_COPY, type AllocatableCashView } from "../../lib/allocatableCashPresentation";
import { formatBRLFromCents } from "../../lib/format";
import { OB } from "../../ui/OnboardingKit";
import { SoftEntrance } from "../../ui/SoftEntrance";

const GUIDE_ICON = {
  statement: "document-text-outline",
  review: "flag-outline",
  caution: "information-circle-outline",
} as const;

export function AllocatableCashCard({
  presentation,
  notice,
  onRetry,
  onImport,
  onReview,
  onDistribute,
  onSaveForDream,
  saveForDreamLabel,
}: {
  presentation: AllocatableCashView;
  notice?: string | null;
  onRetry: () => void;
  onImport: () => void;
  onReview: () => void;
  onDistribute: () => void;
  onSaveForDream?: (() => void) | null;
  saveForDreamLabel?: string;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  if (presentation.kind === "ready") {
    return (
      <SoftEntrance>
        <LinearGradient
          colors={[OB.primaryDeep, OB.primary, "#12315f"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Ionicons name="star" size={78} color="rgba(255,255,255,0.07)" style={styles.star} />
          {notice ? (
            <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text>
          ) : null}
          <Text style={styles.eyebrow}>{presentation.title}</Text>
          <Text
            style={styles.amount}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
            accessibilityLabel={`${presentation.title} ${formatBRLFromCents(presentation.amountCents)}`}
          >
            {formatBRLFromCents(presentation.amountCents)}
          </Text>
          <Text style={styles.heroBody}>{ALLOCATABLE_CASH_COPY.readyGlance}</Text>
          <Pressable
            onPress={onDistribute}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={presentation.ctaLabel}
          >
            <Text style={styles.primaryText}>{presentation.ctaLabel}</Text>
          </Pressable>
          {onSaveForDream && saveForDreamLabel ? (
            <Pressable
              onPress={onSaveForDream}
              style={({ pressed }) => [styles.heroSecondary, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={saveForDreamLabel}
            >
              <Text style={styles.heroSecondaryText}>{saveForDreamLabel}</Text>
            </Pressable>
          ) : null}
        </LinearGradient>
      </SoftEntrance>
    );
  }

  return (
    <View style={[styles.card, presentation.kind === "blocked" && styles.guideCard]}>
      {notice ? (
        <Text style={styles.noticeDark} accessibilityLiveRegion="polite">{notice}</Text>
      ) : null}
      <Text style={styles.cardEyebrow}>{presentation.title}</Text>
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
          <View style={styles.guideHeading}>
            <Ionicons name={GUIDE_ICON[presentation.guide]} size={18} color={OB.primary} />
            <Text style={styles.guideTitle}>{presentation.heading}</Text>
          </View>
          <Text style={styles.body}>{presentation.glance}</Text>
          {presentation.ctaLabel ? (
            <Pressable
              onPress={presentation.ctaAction === "review" ? onReview : onImport}
              style={styles.secondaryButton}
              accessibilityRole="button"
              accessibilityLabel={presentation.ctaLabel}
            >
              <Text style={styles.secondaryText}>{presentation.ctaLabel}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setDetailsOpen((current) => !current)}
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsOpen }}
          >
            <Text style={styles.detailsToggle}>{detailsOpen ? "Ocultar detalhes" : "Ver detalhes"}</Text>
          </Pressable>
          {detailsOpen ? (
            <>
              <Text style={styles.detail}>{presentation.message}</Text>
              {presentation.detail ? <Text style={styles.detail}>{presentation.detail}</Text> : null}
              {presentation.extraReasons.map((reason) => (
                <Text key={reason} style={styles.detail}>{reason}</Text>
              ))}
              {presentation.asOf ? <Text style={styles.asOf}>{presentation.asOf}</Text> : null}
              {presentation.reviewCtaLabel ? (
                <Pressable
                  onPress={onReview}
                  style={styles.secondaryButton}
                  accessibilityRole="button"
                  accessibilityLabel={presentation.reviewCtaLabel}
                >
                  <Text style={styles.secondaryText}>{presentation.reviewCtaLabel}</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {presentation.kind === "none" ? (
        <>
          <Text style={styles.noneAmount}>
            {formatBRLFromCents(presentation.breakdown.find((line) => line.key === "available")?.cents ?? 0)}
          </Text>
          <Text style={styles.body}>{presentation.message}</Text>
        </>
      ) : null}
      {onSaveForDream && saveForDreamLabel ? (
        <Pressable
          onPress={onSaveForDream}
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel={saveForDreamLabel}
        >
          <Text style={styles.secondaryText}>{saveForDreamLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 28,
    padding: 20,
    gap: 8,
    overflow: "hidden",
  },
  star: { position: "absolute", top: -16, right: -10 },
  eyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  amount: { color: "#fff", fontSize: 36, fontWeight: "900", paddingRight: 28 },
  heroBody: { color: "rgba(255,255,255,0.9)", fontSize: 14, fontWeight: "700", lineHeight: 20, maxWidth: 320 },
  heroMeta: { color: OB.textOnDarkMid, fontSize: 12, fontWeight: "700" },
  notice: { color: "#D7F5E4", fontSize: 14, fontWeight: "800", lineHeight: 20 },
  primaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    marginTop: 6,
  },
  primaryText: { color: OB.primary, fontSize: 14, fontWeight: "900" },
  heroSecondary: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  heroSecondaryText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  detailsToggle: { color: OB.primary, fontSize: 13, fontWeight: "800", minHeight: 32 },
  card: {
    borderRadius: 24,
    padding: 16,
    gap: 10,
    backgroundColor: "#F4F7FB",
  },
  guideCard: { backgroundColor: "#F6F3EC" },
  cardEyebrow: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  guideHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  guideTitle: { flex: 1, color: OB.primary, fontSize: 18, fontWeight: "900" },
  noneAmount: { color: OB.primary, fontSize: 32, fontWeight: "900" },
  body: { color: OB.primary, fontSize: 14, fontWeight: "700", lineHeight: 20 },
  detail: { color: OB.support, fontSize: 13, fontWeight: "700", lineHeight: 18 },
  asOf: { color: OB.support, fontSize: 12, fontWeight: "700" },
  noticeDark: { color: "#1F6B45", fontSize: 14, fontWeight: "800", lineHeight: 20 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  secondaryText: { color: "#fff", fontSize: 14, fontWeight: "900" },
  pressed: { opacity: 0.86 },
});
