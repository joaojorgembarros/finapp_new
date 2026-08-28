// app/_layout.tsx
import React from "react";
import {
  Modal,
  Platform,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, router } from "expo-router";
import { PendingRecoveryNavigator } from "../src/lib/pendingRecoveryController";
import * as NavigationBar from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FullWindowOverlay } from "react-native-screens";
import { getNextMountedProtectedUserId } from "../src/lib/appLockLifecycle";
import { SessionProvider, useSession } from "../src/providers/SessionProvider";
import { AppLockProvider, useAppLock } from "../src/providers/AppLockProvider";
import { AppLockScreen } from "../src/ui/AppLockScreen";
import { SplashHandoff } from "../src/ui/SplashHandoff";
import { theme } from "../src/ui/theme";
import * as SplashScreen from "expo-splash-screen";

const MINIMUM_BRAND_TIME_MS = 800;
const HANDOFF_FADE_DURATION_MS = 200;
const BRAND_PRESENTATION_STARTED_AT = Date.now();

SplashScreen.setOptions({ duration: 0, fade: false });
void SplashScreen.preventAutoHideAsync().catch(() => {});

function PrivacyShield() {
  return (
    <View
      accessible
      accessibilityLabel="Conteúdo protegido pelo Sonho+"
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={styles.privacyShield}
    >
      <StatusBar style="light" backgroundColor="#06152e" translucent={false} />
      <Text style={styles.privacyBrand}>Sonho+</Text>
      <Text style={styles.privacyMessage}>Conteúdo protegido</Text>
    </View>
  );
}

function SecuritySurfaceContent({
  locked,
  privacyCovered,
}: {
  locked: boolean;
  privacyCovered: boolean;
}) {
  return (
    <View
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={styles.securitySurface}
    >
      {locked ? (
        <View
          accessibilityElementsHidden={privacyCovered}
          importantForAccessibility={privacyCovered ? "no-hide-descendants" : "auto"}
          pointerEvents={privacyCovered ? "none" : "auto"}
          style={styles.lockSurface}
        >
          <AppLockScreen windowOverlayHost />
        </View>
      ) : null}
      {privacyCovered ? (
        <View style={StyleSheet.absoluteFill}>
          <PrivacyShield />
        </View>
      ) : null}
    </View>
  );
}

function AppSecuritySurface({
  locked,
  privacyCovered,
}: {
  locked: boolean;
  privacyCovered: boolean;
}) {
  if (Platform.OS === "ios") {
    return (
      <FullWindowOverlay unstable_accessibilityContainerViewIsModal>
        <SecuritySurfaceContent
          locked={locked}
          privacyCovered={privacyCovered}
        />
      </FullWindowOverlay>
    );
  }

  if (Platform.OS === "android") {
    return (
      <Modal
        visible
        animationType="none"
        hardwareAccelerated
        presentationStyle="fullScreen"
        statusBarTranslucent={false}
        navigationBarTranslucent={false}
        onRequestClose={() => {}}
      >
        <SecuritySurfaceContent locked={locked} privacyCovered={privacyCovered} />
      </Modal>
    );
  }

  return (
    <View style={styles.webSecuritySurface}>
      <SecuritySurfaceContent locked={locked} privacyCovered={privacyCovered} />
    </View>
  );
}

function SecureRootNavigator() {
  const { session, loading, pendingRecoveryPath, consumePendingRecovery } = useSession();
  const { readyForUser, locked, privacyCovered } = useAppLock();
  const authenticated = Boolean(session);
  const userId = session?.user.id ?? null;
  const [mountedProtectedUserId, setMountedProtectedUserId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setMountedProtectedUserId((currentUserId) => getNextMountedProtectedUserId({
      mountedUserId: currentUserId,
      userId,
      readyForUser,
      locked,
      privacyCovered,
    }));
  }, [locked, privacyCovered, readyForUser, userId]);


  const protectedTreeMounted = Boolean(
    userId && mountedProtectedUserId === userId,
  );
  const bootstrapReady = !loading && (
    !authenticated || readyForUser
  ) && (
    !authenticated || protectedTreeMounted || locked || privacyCovered
  );
  const [handoffVisible, setHandoffVisible] = React.useState(true);
  const [handoffActive, setHandoffActive] = React.useState(false);
  const [handoffFadeDurationMs, setHandoffFadeDurationMs] = React.useState(
    HANDOFF_FADE_DURATION_MS,
  );
  const [handoffReady, setHandoffReady] = React.useState(false);
  const handoffScheduledRef = React.useRef(false);
  const finishHandoff = React.useCallback(() => setHandoffVisible(false), []);
  const markHandoffReady = React.useCallback(() => setHandoffReady(true), []);

  React.useEffect(() => {
    if (!bootstrapReady || !handoffReady || handoffScheduledRef.current) return;
    handoffScheduledRef.current = true;

    const elapsedMs = Date.now() - BRAND_PRESENTATION_STARTED_AT;
    const remainingBrandTimeMs = Math.max(0, MINIMUM_BRAND_TIME_MS - elapsedMs);
    const fadeDurationMs = Math.min(
      HANDOFF_FADE_DURATION_MS,
      remainingBrandTimeMs,
    );
    const waitBeforeFadeMs = remainingBrandTimeMs - fadeDurationMs;

    setHandoffFadeDurationMs(fadeDurationMs);
    void SplashScreen.hideAsync().catch(() => {});

    if (waitBeforeFadeMs <= 0) {
      setHandoffActive(true);
      return;
    }

    const timeoutId = setTimeout(() => setHandoffActive(true), waitBeforeFadeMs);
    return () => clearTimeout(timeoutId);
  }, [bootstrapReady, handoffReady]);

  // Observe pending recovery and navigate only when it's safe: the protected
  // tree must be mounted and App Lock/privacy must not block rendering. The
  // SessionProvider records pendingRecoveryPath when a recovery link established
  // a session while the protected navigation tree was not yet available.
  const pendingRecoveryNavigatorRef = React.useRef<PendingRecoveryNavigator | null>(null);
  if (!pendingRecoveryNavigatorRef.current) pendingRecoveryNavigatorRef.current = new PendingRecoveryNavigator();

  React.useEffect(() => {
    const navigator = pendingRecoveryNavigatorRef.current!;
    if (!pendingRecoveryPath) return;
    if (loading) return;
    if (!session) return;
    if (!protectedTreeMounted) return;
    if (locked || privacyCovered) return; // respect App Lock / Privacy Shield

    // Capture the pending path at call time to avoid races with later changes
    const pathSnapshot = pendingRecoveryPath;

    void navigator.tryNavigate({
      pendingPath: pathSnapshot,
      loading,
      authenticated: authenticated,
      protectedTreeMounted,
      locked,
      privacyCovered,
      navigate: async (p: string) => await router.replace(p),
      consume: () => (consumePendingRecovery ? consumePendingRecovery() : null),
    });
  }, [pendingRecoveryPath, loading, session, protectedTreeMounted, locked, privacyCovered, consumePendingRecovery, authenticated]);

  let rootContent: React.ReactNode = null;

  if (
    !loading &&
    (!authenticated || readyForUser) &&
    (!authenticated || protectedTreeMounted)
  ) {
    rootContent = (
      <>
        <View
          accessibilityElementsHidden={
            handoffVisible || (authenticated && (locked || privacyCovered))
          }
          importantForAccessibility={
            handoffVisible || (authenticated && (locked || privacyCovered))
              ? "no-hide-descendants"
              : "auto"
          }
          pointerEvents={
            handoffVisible || (authenticated && (locked || privacyCovered))
              ? "none"
              : "auto"
          }
          style={[
            styles.navigatorHost,
            handoffVisible && styles.navigatorHostConcealed,
          ]}
        >
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="+not-found" />
            <Stack.Protected guard={!authenticated}>
              <Stack.Screen name="(auth)" />
            </Stack.Protected>
            <Stack.Protected guard={authenticated}>
              <Stack.Screen name="(app)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="reset-password" />
            </Stack.Protected>
          </Stack>
        </View>
        {authenticated && protectedTreeMounted && (locked || privacyCovered) ? (
          <AppSecuritySurface locked={locked} privacyCovered={privacyCovered} />
        ) : null}
      </>
    );
  } else if (
    authenticated &&
    !protectedTreeMounted &&
    (locked || privacyCovered)
  ) {
    rootContent = (
      <SecuritySurfaceContent locked={locked} privacyCovered={privacyCovered} />
    );
  }

  return (
    <View style={styles.appShell}>
      <View
        accessibilityElementsHidden={handoffVisible}
        importantForAccessibility={
          handoffVisible ? "no-hide-descendants" : "auto"
        }
        pointerEvents={handoffVisible ? "none" : "auto"}
        style={styles.contentHost}
      >
        {rootContent}
      </View>
      {handoffVisible ? (
        <SplashHandoff
          key="startup-handoff"
          active={handoffActive}
          fadeDurationMs={handoffFadeDurationMs}
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
        <AppLockProvider>
          <StatusBar style="dark" backgroundColor={theme.colors.bg0} translucent={false} />
          <SecureRootNavigator />
        </AppLockProvider>
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
  secureBoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: "#06152e",
  },
  secureBootText: {
    color: "rgba(255,255,255,0.93)",
    fontSize: 20,
    fontWeight: "900",
  },
  privacyShield: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#06152e",
  },
  privacyBrand: {
    color: "#FFFFFF",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "900",
  },
  privacyMessage: {
    color: "rgba(218,231,244,0.88)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  securitySurface: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "#06152e",
  },
  lockSurface: {
    flex: 1,
  },
  webSecuritySurface: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10_000,
  },
});
