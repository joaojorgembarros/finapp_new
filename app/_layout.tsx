// app/_layout.tsx
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { Stack } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/providers/SessionProvider";
import { theme } from "../src/ui/theme";

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS !== "android") return;

    NavigationBar.setPositionAsync("relative");
    NavigationBar.setBackgroundColorAsync(theme.colors.bg2);
    NavigationBar.setButtonStyleAsync("dark");
    NavigationBar.setBorderColorAsync(theme.colors.bg2);
  }, []);

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" backgroundColor={theme.colors.bg0} translucent={false} />
        <Stack screenOptions={{ headerShown: false }} />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
