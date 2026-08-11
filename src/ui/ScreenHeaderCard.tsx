import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { OB } from "./OnboardingKit";

type ScreenHeaderCardProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backAccessibilityLabel?: string;
  titleNumberOfLines?: number;
  navigationVariant?: "back" | "close";
};

export function ScreenHeaderCard({
  eyebrow,
  title,
  subtitle,
  onBack,
  backAccessibilityLabel,
  titleNumberOfLines,
  navigationVariant = "back",
}: ScreenHeaderCardProps) {
  const { width } = useWindowDimensions();
  const compact = width < 360;
  const isClose = navigationVariant === "close";
  const navigationIcon = isClose
    ? "close"
    : Platform.OS === "ios" ? "chevron-back" : "arrow-back";
  const navigationAlign = isClose ? "right" : "left";
  const navigationAccessibilityLabel = backAccessibilityLabel ?? (isClose ? "Fechar" : "Voltar");
  const navigationButton = onBack ? (
    <Pressable
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel={navigationAccessibilityLabel}
      style={({ pressed }) => [
        styles.navigationButton,
        isClose ? styles.closeButton : styles.backButton,
        pressed && styles.navigationButtonPressed,
      ]}
    >
      <Ionicons name={navigationIcon} size={navigationIcon === "close" ? 22 : 20} color="#fff" />
    </Pressable>
  ) : null;

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <Text style={styles.eyebrow} numberOfLines={1}>{eyebrow}</Text>

      <View style={[styles.headingRow, compact && styles.headingRowCompact]}>
        {navigationAlign === "left" ? navigationButton : null}
        <View style={styles.headingCopy}>
          <Text
            style={[styles.title, compact && styles.titleCompact]}
            numberOfLines={titleNumberOfLines}
            accessibilityRole="header"
          >
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {navigationAlign === "right" ? navigationButton : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
    overflow: "hidden",
    backgroundColor: OB.primary,
  },
  cardCompact: {
    paddingHorizontal: 16,
    gap: 10,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  headingRowCompact: {
    gap: 10,
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
  },
  navigationButton: {
    width: 44,
    height: 44,
    alignItems: "center",
  },
  backButton: {
    justifyContent: "flex-start",
    paddingTop: 5,
  },
  closeButton: {
    borderRadius: 14,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.17)",
  },
  navigationButtonPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  eyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    color: OB.textOnDark,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
  },
  titleCompact: {
    fontSize: 22,
    lineHeight: 28,
  },
  subtitle: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    marginTop: 6,
  },
});
