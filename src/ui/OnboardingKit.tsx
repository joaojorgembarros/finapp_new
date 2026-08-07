import React from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

export const OB = {
  primary: "#0C2348",
  primaryDeep: "#06152e",
  primaryAlt: "#163870",
  support: "#7BA0C8",
  supportSoft: "rgba(123,160,200,0.26)",
  offWhite: "#F6F7F9",
  white: "#FFFFFF",
  textOnDark: "rgba(255,255,255,0.93)",
  textOnDarkMid: "rgba(160,200,235,0.72)",
  shadow: "rgba(12,35,72,0.34)",
} as const;

export function OnboardingBackground({ compact = false }: { compact?: boolean }) {
  return (
    <Svg pointerEvents="none" viewBox={compact ? "0 0 390 320" : "0 0 390 844"} preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgLinearGradient id="obSky" x1="0" y1="0" x2="390" y2="844" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#06152e" />
          <Stop offset="45%" stopColor="#0c2348" />
          <Stop offset="100%" stopColor="#0f3060" />
        </SvgLinearGradient>
        <RadialGradient id="obTop" cx="78%" cy="12%" rx="48%" ry="42%">
          <Stop offset="0%" stopColor="#7BA0C8" stopOpacity="0.27" />
          <Stop offset="100%" stopColor="#0c2348" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="obBottom" cx="14%" cy="92%" rx="50%" ry="45%">
          <Stop offset="0%" stopColor="#7BA0C8" stopOpacity="0.17" />
          <Stop offset="100%" stopColor="#06152e" stopOpacity="0" />
        </RadialGradient>
        <SvgLinearGradient id="obWave" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#7BA0C8" stopOpacity="0.13" />
          <Stop offset="100%" stopColor="#0c2348" stopOpacity="0.03" />
        </SvgLinearGradient>
      </Defs>
      <Rect width="390" height="844" fill="url(#obSky)" />
      <Rect width="390" height="844" fill="url(#obTop)" />
      <Rect width="390" height="844" fill="url(#obBottom)" />
      <Path d="M-20 470 L50 330 L112 385 L178 265 L242 330 L304 215 L358 292 L410 250 L410 844 L-20 844Z" fill="#0d2a52" opacity="0.55" />
      <Path d="M-20 535 L38 414 L104 450 L156 340 L214 392 L272 302 L336 362 L410 318 L410 844 L-20 844Z" fill="#0f3160" opacity="0.48" />
      <Ellipse cx="350" cy="92" rx="220" ry="184" fill="url(#obWave)" opacity="0.8" />
      <Ellipse cx="45" cy="690" rx="238" ry="205" fill="url(#obWave)" opacity="0.68" />
      {[32, 78, 145, 195, 255, 310, 365, 55, 175, 290, 342].map((x, i) => (
        <Circle key={x} cx={x} cy={[45, 22, 55, 18, 42, 28, 58, 88, 78, 95, 72][i]} r={i % 3 === 0 ? 1.4 : 0.9} fill="#ffffff" opacity={0.28 + (i % 4) * 0.08} />
      ))}
    </Svg>
  );
}

export function OnboardingShell({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.shell, light && styles.shellLight]}>
      {children}
    </SafeAreaView>
  );
}

export function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
      accessibilityRole="button"
      accessibilityLabel="Voltar"
    >
      <Ionicons name={Platform.OS === "ios" ? "chevron-back" : "arrow-back"} size={20} color={OB.textOnDark} />
    </Pressable>
  );
}

export function OnboardingStepBadge({
  current,
  total,
}: {
  current: number;
  total: number;
}) {
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.max(1, Math.min(current, safeTotal));

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Etapa ${safeCurrent} de ${safeTotal}`}
      style={styles.stepBadge}
    >
      {Array.from({ length: safeTotal }, (_, index) => {
        const active = index < safeCurrent;
        return <View key={index} style={active ? styles.stepDotActive : styles.stepDot} />;
      })}
      <Text style={styles.stepText}>ETAPA {safeCurrent} DE {safeTotal}</Text>
    </View>
  );
}

export function ScreenIntro({
  eyebrow,
  title,
  subtitle,
  onBack,
  currentStep,
  totalSteps,
  compact = false,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  onBack?: () => void;
  currentStep?: number;
  totalSteps?: number;
  compact?: boolean;
}) {
  const showStep = typeof currentStep === "number" && typeof totalSteps === "number";

  return (
    <View style={[styles.intro, compact && styles.introCompact]}>
      {onBack || showStep ? (
        <View style={[styles.introTopRow, compact && styles.introTopRowCompact]}>
          {onBack ? <BackButton onPress={onBack} /> : <View />}
          {showStep ? <OnboardingStepBadge current={currentStep} total={totalSteps} /> : null}
        </View>
      ) : null}
      <Text style={[styles.eyebrow, compact && styles.eyebrowCompact]}>{eyebrow}</Text>
      <Text style={[styles.title, compact && styles.titleCompact]}>{title}</Text>
      <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.primaryTouch, disabled && styles.disabled, style]}>
      <LinearGradient colors={disabled ? ["rgba(123,160,200,0.32)", "rgba(123,160,200,0.32)"] : ["#06152e", OB.primary, "#163870"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryButton}>
        <Text style={[styles.primaryText, disabled && styles.disabledText]}>{title}</Text>
      </LinearGradient>
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.secondaryButton}>
      <Text style={styles.secondaryText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: OB.primaryDeep,
  },
  shellLight: {
    backgroundColor: OB.offWhite,
  },
  intro: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 20,
  },
  introCompact: {
    paddingTop: 8,
    paddingBottom: 14,
  },
  introTopRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  introTopRowCompact: {
    marginBottom: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonPressed: {
    opacity: 0.72,
  },
  stepBadge: {
    maxWidth: "75%",
    flexShrink: 1,
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  stepDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  stepDotActive: {
    width: 13,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  stepText: {
    flexShrink: 1,
    color: OB.textOnDarkMid,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginLeft: 3,
  },
  eyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  eyebrowCompact: {
    fontSize: 10,
    marginBottom: 6,
  },
  title: {
    color: OB.textOnDark,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "900",
    marginBottom: 8,
  },
  titleCompact: {
    fontSize: 23,
    lineHeight: 28,
    marginBottom: 6,
  },
  subtitle: {
    color: OB.textOnDarkMid,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
  },
  subtitleCompact: {
    fontSize: 12,
    lineHeight: 18,
  },
  primaryTouch: {
    borderRadius: 16,
    shadowColor: OB.primary,
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    color: OB.white,
    fontSize: 16,
    fontWeight: "900",
  },
  disabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  disabledText: {
    color: OB.support,
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  secondaryText: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
  },
});
