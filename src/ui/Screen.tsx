// src/ui/Screen.tsx
import React, { useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, StatusBar as RNStatusBar, StyleSheet, View, ViewStyle } from "react-native";
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
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const topInset = Math.max(insets.top, Platform.OS === "android" ? RNStatusBar.currentHeight ?? 0 : 0);
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 48 : 0);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const contentStyle = [
    styles.content,
    {
      paddingTop: topInset + 28,
      paddingBottom: bottomInset + 118,
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
      {Platform.OS === "android" && !keyboardVisible ? (
        <View pointerEvents="none" style={[styles.navGuard, { height: bottomInset }]} />
      ) : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        enabled={Platform.OS === "ios"}
        keyboardVerticalOffset={0}
        style={styles.keyboard}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={contentStyle}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
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
  navGuard: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    elevation: 20,
    backgroundColor: theme.colors.bg2,
  },
  content: {
    paddingHorizontal: 16,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
    gap: 14,
  },
});
