// src/ui/Screen.tsx
import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StatusBar as RNStatusBar, StyleSheet, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "./theme";

export default function Screen({
  children,
  scroll = true,
  style,
  contentTopOffset = 0,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  contentTopOffset?: number;
}) {
  const insets = useSafeAreaInsets();
  const topInset = Math.max(insets.top, Platform.OS === "android" ? RNStatusBar.currentHeight ?? 0 : 0);
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 32 : 0);

  const contentStyle = [
    styles.content,
    {
      paddingTop: topInset + 16 + contentTopOffset,
      paddingBottom: bottomInset + 96,
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
      <View pointerEvents="none" style={[styles.topGuard, { height: topInset + 2 }]} />
      <View pointerEvents="none" style={[styles.bottomGuard, { height: bottomInset }]} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
        style={styles.keyboard}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={contentStyle}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {children}
          </ScrollView>
        ) : (
          <View style={contentStyle}>{children}</View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg0 },
  keyboard: { flex: 1 },
  topGuard: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 10,
    backgroundColor: theme.colors.bg0,
  },
  bottomGuard: {
    position: "absolute",
    bottom: 0,
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
