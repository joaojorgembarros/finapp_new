// src/ui/Screen.tsx
import React, { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { theme } from "./theme";
import { useDrawerOptional } from "./drawer";

type Props = {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;

  /** ✅ Header padrão */
  title?: string;
  subtitle?: string;
  hideHeader?: boolean;

  /** opcional: botão extra à direita (ex: refresh) */
  rightIcon?: React.ComponentProps<typeof Ionicons>["name"];
  onRightPress?: () => void;
};

export default function Screen({
  children,
  scroll = true,
  style,
  title,
  subtitle,
  hideHeader,
  rightIcon,
  onRightPress,
}: Props) {
  const insets = useSafeAreaInsets();
  const drawer = useDrawerOptional();

  const HEADER_H = 54;

  const contentStyle = useMemo(
    () => [
      styles.content,
      {
        paddingTop: hideHeader ? insets.top + 14 : 14,
        paddingBottom: insets.bottom + 18,
        paddingLeft: 16,
        paddingRight: 16,
      },
      style,
    ],
    [insets.top, insets.bottom, style, hideHeader]
  );

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[theme.colors.bg0, theme.colors.bg1]}
        style={StyleSheet.absoluteFill}
      />

      {!hideHeader ? (
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + 8,
              height: insets.top + HEADER_H,
            },
          ]}
        >
          {/* esquerda: hamburger */}
          <Pressable
            onPress={() => drawer?.toggleDrawer?.()}
            hitSlop={14}
            style={styles.headerBtn}
          >
            <Ionicons name="menu" size={24} color={theme.colors.text} />
          </Pressable>

          {/* centro: título */}
          <View style={styles.headerCenter} pointerEvents="none">
            <Text style={styles.headerTitle} numberOfLines={1}>
              {title ?? ""}
            </Text>
            {subtitle ? (
              <Text style={styles.headerSub} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          {/* direita: botão extra OU avatar */}
          {rightIcon ? (
            <Pressable
              onPress={onRightPress}
              hitSlop={14}
              style={styles.headerBtn}
            >
              <Ionicons name={rightIcon} size={20} color={theme.colors.text} />
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push("/(tabs)/profile")}
              hitSlop={14}
              style={[styles.headerBtn, styles.avatarBtn]}
            >
              <Ionicons name="person" size={18} color={theme.colors.text} />
            </Pressable>
          )}
        </View>
      ) : null}

      {scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={contentStyle}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={contentStyle}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg0 },
  content: { flexGrow: 1 },

  header: {
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  headerBtn: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarBtn: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  headerCenter: {
    position: "absolute",
    left: 64,
    right: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: theme.colors.text,
    fontWeight: "900",
    fontSize: 16,
  },
  headerSub: {
    marginTop: 2,
    color: theme.colors.muted,
    fontWeight: "800",
    fontSize: 12,
  },
});