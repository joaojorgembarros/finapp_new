import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { OB } from "../../ui/OnboardingKit";

export function ObservedResultPanel({
  eyebrow,
  caption,
  narrative,
  glance,
  result,
  negative,
  inflowLabel,
  inflow,
  outflowLabel,
  outflow,
  children,
}: {
  eyebrow: string;
  caption?: string;
  narrative?: string | null;
  glance?: string | null;
  result?: string;
  negative?: boolean;
  inflowLabel?: string;
  inflow?: string;
  outflowLabel?: string;
  outflow?: string;
  children?: React.ReactNode;
}) {
  return (
      <LinearGradient
        colors={[OB.primaryDeep, OB.primary, "#12315f"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <Ionicons name="star" size={86} color="rgba(255,255,255,0.07)" style={styles.star} />
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        {result ? (
          <Text
            style={[styles.result, negative && styles.resultNegative]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {result}
          </Text>
        ) : null}
        {narrative ? <Text style={styles.narrative}>{narrative}</Text> : null}
        {glance ? <Text style={styles.narrative}>{glance}</Text> : null}
        {inflow && outflow ? (
          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>{inflowLabel}</Text>
              <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {inflow}
              </Text>
            </View>
            <View style={styles.metricRule} />
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>{outflowLabel}</Text>
              <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {outflow}
              </Text>
            </View>
          </View>
        ) : null}
        {children}
      </LinearGradient>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 28,
    paddingVertical: 22,
    paddingHorizontal: 20,
    gap: 6,
    overflow: "hidden",
  },
  star: {
    position: "absolute",
    top: -18,
    right: -12,
  },
  eyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  caption: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "700",
  },
  result: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "900",
    marginTop: 8,
    paddingRight: 28,
  },
  resultNegative: { color: "#F4C7C7" },
  narrative: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
    maxWidth: 280,
  },
  metrics: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.16)",
  },
  metric: { flex: 1, gap: 2, minWidth: 0 },
  metricRule: {
    width: StyleSheet.hairlineWidth,
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  metricLabel: {
    color: OB.textOnDarkMid,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  metricValue: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
});
