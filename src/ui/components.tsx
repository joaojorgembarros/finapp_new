// src/ui/components.tsx
import React from "react";
import { Pressable, Text, TextInput, View, ViewStyle, TextStyle, TextInputProps } from "react-native";
import { BlurView } from "expo-blur";
import { theme } from "./theme";

export function Card({ children, style, intensity = 24 }: { children: React.ReactNode; style?: ViewStyle; intensity?: number }) {
  return (
    <BlurView
      intensity={intensity}
      tint="dark"
      style={[
        {
          borderRadius: theme.radii.r20,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card2,
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
  const bg = variant === "primary" ? theme.colors.primary : variant === "danger" ? theme.colors.bad : "transparent";
  const color = variant === "primary" ? "#001018" : theme.colors.text;
  const border = variant === "ghost" ? theme.colors.border : "transparent";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: theme.radii.r16,
          backgroundColor: disabled ? "rgba(255,255,255,0.08)" : bg,
          borderWidth: variant === "ghost" ? 1 : 0,
          borderColor: border,
          opacity: pressed ? 0.85 : 1,
          alignItems: "center",
        },
        style,
      ]}
    >
      <Text style={{ color: disabled ? theme.colors.muted : color, fontWeight: "900" }}>{title}</Text>
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
  keyboardType?: TextInputProps["keyboardType"]; // ✅ agora aceita decimal-pad
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
          backgroundColor: "rgba(255,255,255,0.05)",
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
  return <Text style={[theme.text.h1, { color: theme.colors.text }]}>{children}</Text>;
}
export function H2({ children }: { children: React.ReactNode }) {
  return <Text style={[theme.text.h2, { color: theme.colors.text }]}>{children}</Text>;
}
export function P({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: TextStyle }) {
  return (
    <Text style={[{ color: muted ? theme.colors.muted : theme.colors.text, fontWeight: "700", lineHeight: 20 }, style]}>
      {children}
    </Text>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>{children}</View>;
}

export function Pill({ text, tone = "muted" }: { text: string; tone?: "muted" | "good" | "warn" | "bad" }) {
  const c = tone === "good" ? theme.colors.good : tone === "warn" ? theme.colors.warn : tone === "bad" ? theme.colors.bad : theme.colors.muted;
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: "rgba(255,255,255,0.04)",
      }}
    >
      <Text style={{ color: c, fontWeight: "900", fontSize: 12 }}>{text}</Text>
    </View>
  );
}
