// app/_layout.tsx
import React from "react";
import { Platform, StatusBar as NativeStatusBar, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../src/providers/SessionProvider";
import { SplashHandoff } from "../src/ui/SplashHandoff";
import { theme } from "../src/ui/theme";
import * as SplashScreen from "expo-splash-screen";

const MINIMUM_BRAND_TIME_MS = 800;
const HANDOFF_FADE_DURATION_MS = 200;

SplashScreen.setOptions({ duration: 0, fade: false });
void SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator() {
  const { loading } = useSession();
  const bootstrapReady = !loading;
  const [handoffVisible, setHandoffVisible] = React.useState(true);
  const [handoffActive, setHandoffActive] = React.useState(false);
  const [handoffReady, setHandoffReady] = React.useState(false);
  const handoffScheduledRef = React.useRef(false);
  const finishHandoff = React.useCallback(() => setHandoffVisible(false), []);
  const markHandoffReady = React.useCallback(() => setHandoffReady(true), []);

  React.useEffect(() => {
    if (!bootstrapReady || !handoffReady || handoffScheduledRef.current) return;
    handoffScheduledRef.current = true;

    const waitBeforeFadeMs = MINIMUM_BRAND_TIME_MS - HANDOFF_FADE_DURATION_MS;
    void SplashScreen.hideAsync().catch(() => {});

    const timeoutId = setTimeout(() => setHandoffActive(true), waitBeforeFadeMs);
    return () => clearTimeout(timeoutId);
  }, [bootstrapReady, handoffReady]);

  return (
    <View style={styles.appShell}>
      <View
        accessibilityElementsHidden={handoffVisible}
        importantForAccessibility={handoffVisible ? "no-hide-descendants" : "auto"}
        pointerEvents={handoffVisible ? "none" : "auto"}
        style={styles.contentHost}
      >
        <View
          pointerEvents={handoffVisible ? "none" : "auto"}
          style={[styles.navigatorHost, handoffVisible && styles.navigatorHostConcealed]}
        >
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="+not-found" />
            <Stack.Screen name="auth/callback" />
          </Stack>
        </View>
      </View>
      {handoffVisible ? (
        <SplashHandoff
          key="startup-handoff"
          active={handoffActive}
          fadeDurationMs={HANDOFF_FADE_DURATION_MS}
          onComplete={finishHandoff}
          onReady={markHandoffReady}
        />
      ) : null}
    </View>
  );
}

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
        <RootNavigator />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appShell: {
    flex: 1,
    backgroundColor: "#06152e",
  },
  contentHost: {
    flex: 1,
  },
  navigatorHost: {
    flex: 1,
  },
  navigatorHostConcealed: {
    opacity: 0,
  },
});
