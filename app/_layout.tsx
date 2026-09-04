// app/_layout.tsx
import React from "react";
import { Platform, StatusBar as NativeStatusBar } from "react-native";
import { Stack } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../src/providers/SessionProvider";
import { theme } from "../src/ui/theme";

export default function RootLayout() {
  React.useEffect(() => {
    if (Platform.OS !== "android") return;
    NativeStatusBar.setTranslucent(false);
    NativeStatusBar.setBackgroundColor(theme.colors.bg0);
    NativeStatusBar.setBarStyle("dark-content");
    NavigationBar.setBackgroundColorAsync(theme.colors.bg0).catch(() => {});
    NavigationBar.setButtonStyleAsync("dark").catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" backgroundColor={theme.colors.bg0} translucent={false} />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="auth/callback" />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
