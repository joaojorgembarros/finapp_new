// src/ui/components.tsx
import React from "react";
import { Pressable, Text, TextInput, TextInputProps, TextStyle, View, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";
import SideMenu from "./SideMenu";

export function Card({
  children,
  style,
  intensity = 18,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
}) {
  return (
    <BlurView
      intensity={intensity}
      tint="light"
      style={[
        {
          borderRadius: theme.radii.r20,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
          ...theme.shadow,
        },
        style,
      ]}
    >
      <View style={{ padding: theme.spacing.s16, gap: 10 }}>{children}</View>
    </BlurView>
  );
}

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const isGhost = variant === "ghost";
  const isDanger = variant === "danger";
  const textColor = isGhost ? theme.colors.text : "#fff";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          borderRadius: theme.radii.r16,
          overflow: "hidden",
          opacity: disabled ? 0.55 : pressed ? 0.88 : 1,
          borderWidth: isGhost ? 1 : 0,
          borderColor: theme.colors.border,
          backgroundColor: isGhost ? "rgba(255,255,255,0.74)" : "transparent",
        },
        !isGhost && theme.shadow,
        style,
      ]}
    >
      {isGhost ? (
        <View style={{ paddingVertical: 12, paddingHorizontal: 14, alignItems: "center" }}>
          <Text style={{ color: textColor, fontWeight: "900" }}>{title}</Text>
        </View>
      ) : (
        <LinearGradient
          colors={isDanger ? ["#ef4444", "#dc2626"] : theme.gradient.brand}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ paddingVertical: 12, paddingHorizontal: 14, alignItems: "center" }}
        >
          <Text style={{ color: textColor, fontWeight: "900" }}>{title}</Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

export function Input({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
  style,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: TextInputProps["keyboardType"];
  secureTextEntry?: boolean;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[
        {
          borderRadius: theme.radii.r16,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: "rgba(255,255,255,0.72)",
          paddingHorizontal: 12,
          paddingVertical: 10,
        },
        style,
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.muted2}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        style={{ color: theme.colors.text, fontWeight: "800" }}
      />
    </View>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: theme.colors.muted, fontWeight: "900" }}>{children}</Text>;
}

export function H1({ children }: { children: React.ReactNode }) {
  return <Text style={[theme.text.h1, { color: theme.colors.text, letterSpacing: 0 }]}>{children}</Text>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={[theme.text.h2, { color: theme.colors.text }]}>{children}</Text>;
}

export function P({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: TextStyle }) {
  return (
    <Text style={[theme.text.body, { color: muted ? theme.colors.muted : theme.colors.text }, style]}>
      {children}
    </Text>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>{children}</View>;
}

export function Pill({ text, tone = "muted" }: { text: string; tone?: "muted" | "good" | "warn" | "bad" }) {
  const c =
    tone === "good"
      ? theme.colors.good
      : tone === "warn"
        ? theme.colors.warn
        : tone === "bad"
          ? theme.colors.bad
          : theme.colors.primary;
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: "rgba(255,255,255,0.72)",
      }}
    >
      <Text style={{ color: c, fontWeight: "900", fontSize: 12 }}>{text}</Text>
    </View>
  );
}

export function AppHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <View style={{ minHeight: 62, justifyContent: "center" }}>
      <View style={{ position: "absolute", left: -16, top: 4 }}>
        <SideMenu />
      </View>
      {right ? <View style={{ position: "absolute", right: 0, top: 4 }}>{right}</View> : null}
      <View style={{ paddingHorizontal: 56, alignItems: "center" }}>
        <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 26, textAlign: "center" }}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: theme.colors.muted,
              fontWeight: "700",
              marginTop: 3,
              textAlign: "center",
              lineHeight: 18,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function GradientCard({
  icon,
  eyebrow,
  value,
  children,
  colors = theme.gradient.brand,
  style,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  eyebrow: string;
  value: string;
  children?: React.ReactNode;
  colors?: readonly [string, string, ...string[]];
  style?: ViewStyle;
}) {
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        {
          borderRadius: theme.radii.r28,
          padding: 20,
          overflow: "hidden",
          ...theme.shadow,
        },
        style,
      ]}
    >
      <Row style={{ gap: 8 }}>
        {icon ? <Ionicons name={icon} size={20} color="rgba(255,255,255,0.88)" /> : null}
        <Text style={{ color: "rgba(255,255,255,0.90)", fontWeight: "900" }}>{eyebrow}</Text>
      </Row>
      <Text style={{ color: "#fff", fontWeight: "900", fontSize: 36, marginTop: 12 }}>{value}</Text>
      {children ? <View style={{ marginTop: 18 }}>{children}</View> : null}
    </LinearGradient>
  );
}

export function SoftIcon({
  name,
  tone = "primary",
}: {
  name: keyof typeof Ionicons.glyphMap;
  tone?: "primary" | "good" | "bad" | "pink" | "warn";
}) {
  const color =
    tone === "good" ? theme.colors.good : tone === "bad" ? theme.colors.bad : tone === "pink" ? theme.colors.pink : tone === "warn" ? theme.colors.warn : theme.colors.primary;
  const bg =
    tone === "good" ? theme.colors.goodSoft : tone === "bad" ? theme.colors.badSoft : tone === "pink" ? "#fce7f3" : tone === "warn" ? "#fef3c7" : theme.colors.primarySoft;

  return (
    <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={name} size={22} color={color} />
    </View>
  );
}

export function ProgressLine({ value, color = theme.colors.primary }: { value: number; color?: string }) {
  const width = `${Math.max(0, Math.min(1, value)) * 100}%` as any;
  return (
    <View style={{ height: 9, borderRadius: 999, backgroundColor: "#e2e8f0", overflow: "hidden" }}>
      <View style={{ width, height: "100%", borderRadius: 999, backgroundColor: color }} />
    </View>
  );
}
