import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { disclosureInitiallyOpen } from "./disclosureState";
import { OB } from "./OnboardingKit";

export function DisclosureSection({
  title,
  summary,
  children,
  collapsed = true,
  layout = "stack",
}: {
  title: string;
  summary?: string | null;
  children: React.ReactNode;
  /** When false, children stay visible and the header is not shown. Guided uses this. */
  collapsed?: boolean;
  layout?: "stack" | "inline";
}) {
  const [open, setOpen] = useState(() => disclosureInitiallyOpen(false));
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: open ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [open, rotation]);

  if (!collapsed) return <View style={styles.open}>{children}</View>;

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "90deg"],
  });
  const label = summary ? `${title}. ${summary}` : title;

  return (
    <View style={styles.section}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.header, layout === "inline" && styles.headerInline, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
      >
        <View style={[styles.copy, layout === "inline" && styles.copyInline]}>
          <Text style={[styles.title, layout === "inline" && styles.titleInline]} numberOfLines={2}>{title}</Text>
          {summary && (layout === "inline" || !open) ? (
            <Text style={[styles.summary, layout === "inline" && styles.summaryInline]} numberOfLines={1}>
              {summary}
            </Text>
          ) : null}
        </View>
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
          <Ionicons name="chevron-forward" size={18} color={OB.support} />
        </Animated.View>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  open: { gap: 12 },
  section: { gap: 8 },
  header: {
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#F4F7FB",
  },
  headerInline: { minHeight: 52 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  copyInline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { color: OB.primary, fontSize: 15, fontWeight: "900" },
  titleInline: { flexShrink: 1, fontSize: 13, fontWeight: "800" },
  summary: { color: OB.support, fontSize: 12, fontWeight: "700" },
  summaryInline: { flexShrink: 1, color: OB.primary, fontSize: 16, fontWeight: "900", textAlign: "right" },
  body: { gap: 12, paddingHorizontal: 2, paddingBottom: 4 },
  pressed: { opacity: 0.82 },
});
