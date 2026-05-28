// src/ui/Screen.tsx
import React from "react";
import { Platform, ScrollView, StatusBar as RNStatusBar, StyleSheet, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "./theme";

export default function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === "android" ? RNStatusBar.currentHeight ?? 0 : 0);

  const contentStyle = [
    styles.content,
    {
      paddingTop: topInset + 16,
      paddingBottom: insets.bottom + 96,
    },
    style,
  ];

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={theme.gradient.page}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={[styles.topGuard, { height: topInset }]} />

      {scroll ? (
        <ScrollView
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
  topGuard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 10,
    backgroundColor: theme.colors.bg0,
  },
  content: {
    paddingHorizontal: 16,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    gap: 14,
  },
});
