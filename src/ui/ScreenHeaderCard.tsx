import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
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
  style?: StyleProp<ViewStyle>;
};

export function ScreenHeaderCard({
  eyebrow,
  title,
  subtitle,
  onBack,
  backAccessibilityLabel,
  titleNumberOfLines,
  navigationVariant = "back",
  style,
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
    <View style={[styles.card, compact && styles.cardCompact, style]}>
      <Text style={styles.eyebrow} numberOfLines={1}>{eyebrow}</Text>

      <View style={[styles.headingBlock, compact && styles.headingBlockCompact]}>
        <View style={[styles.headingRow, compact && styles.headingRowCompact]}>
          {onBack ? (
            <View style={styles.navigationSlot}>
              {navigationAlign === "left" ? navigationButton : null}
            </View>
          ) : null}
          <View style={styles.headingCopy}>
            <Text
              style={[styles.title, compact && styles.titleCompact]}
              numberOfLines={titleNumberOfLines}
              adjustsFontSizeToFit={compact && titleNumberOfLines === 1}
              minimumFontScale={0.82}
              accessibilityRole="header"
            >
              {title}
            </Text>
          </View>
          {onBack ? (
            <View style={styles.navigationSlot}>
              {navigationAlign === "right" ? navigationButton : null}
            </View>
          ) : null}
        </View>
        {subtitle ? <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text> : null}
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
    paddingHorizontal: 12,
    gap: 8,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  headingBlock: {
    gap: 6,
  },
  headingBlockCompact: {
    gap: 5,
  },
  headingRowCompact: {
    gap: 4,
  },
  headingCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  navigationSlot: {
    width: 44,
    height: 44,
    flexShrink: 0,
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
    textAlign: "center",
  },
  title: {
    color: OB.textOnDark,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
    alignSelf: "stretch",
    textAlign: "center",
  },
  titleCompact: {
    fontSize: 20,
    lineHeight: 26,
  },
  subtitle: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "700",
    alignSelf: "stretch",
    textAlign: "center",
  },
  subtitleCompact: {
    fontSize: 12,
    lineHeight: 18,
  },
});
