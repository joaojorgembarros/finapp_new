// src/ui/drawer.tsx
import React, { createContext, useContext, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";
import { supabase } from "../lib/supabase";

type DrawerCtx = {
  open: boolean;
  progress: Animated.Value;
  drawerW: number;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
};

type IconName = React.ComponentProps<typeof Ionicons>["name"];

type DrawerItem = {
  label: string;
  route: string;
  icon: IconName;
  danger?: boolean;
};

const Ctx = createContext<DrawerCtx | null>(null);

export function useDrawer() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDrawer must be used inside DrawerProvider");
  return v;
}
export function useDrawerOptional() {
  return useContext(Ctx);
}

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const drawerW = useMemo(() => {
    const W = Dimensions.get("window").width;
    return Math.min(320, Math.round(W * 0.82));
  }, []);

  const [open, setOpen] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  function openDrawer() {
    if (open) return;
    setOpen(true);
    Animated.timing(progress, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }

  function closeDrawer() {
    Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setOpen(false);
    });
  }

  function toggleDrawer() {
    if (open) closeDrawer();
    else openDrawer();
  }

  const value = useMemo(
    () => ({ open, progress, drawerW, openDrawer, closeDrawer, toggleDrawer }),
    [open, progress, drawerW]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function stripGroups(route: string) {
  return route
    .replace("/(tabs)", "")
    .replace("/(auth)", "")
    .replace("/(onboarding)", "");
}

export function DrawerHost() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { open, progress, drawerW, closeDrawer } = useDrawer();

  if (!open) return null;

  const drawerX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-(drawerW + 30), 0],
  });

  const overlayOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.70],
  });

  // ✅ ADICIONADO: Gráficos
 const items: DrawerItem[] = [
  { label: "Início", route: "/(tabs)/home", icon: "home-outline" },
  { label: "Metas", route: "/(tabs)/goals", icon: "trophy-outline" },
  { label: "Meu mês", route: "/(tabs)/planning", icon: "calendar-outline" },
  { label: "Fechamentos", route: "/(tabs)/closures", icon: "checkmark-done-outline" },
  { label: "Cartões", route: "/(tabs)/cards", icon: "card-outline" },
  { label: "Histórico", route: "/(tabs)/history", icon: "time-outline" },

  // ✅ agora é Insights (só no menu lateral)
  { label: "Insights", route: "/(tabs)/insights", icon: "bar-chart-outline" },

  { label: "Sair", route: "__logout__", icon: "log-out-outline", danger: true },
];

  function isActive(route: string) {
    const r = stripGroups(route);
    return pathname === r;
  }

  async function onPress(it: DrawerItem) {
    if (it.route === "__logout__") {
      try {
        await supabase.auth.signOut();
      } catch {}
      closeDrawer();
      router.replace("/(auth)/login");
      return;
    }
    closeDrawer();
    requestAnimationFrame(() => router.push(it.route));
  }

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={closeDrawer}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#000", opacity: overlayOpacity }]}>
          <Pressable style={{ flex: 1 }} onPress={closeDrawer} />
        </Animated.View>

        <Animated.View
          style={[
            styles.drawer,
            {
              width: drawerW,
              transform: [{ translateX: drawerX }],
              paddingTop: insets.top + 10,
              paddingBottom: insets.bottom + 14,
            },
          ]}
        >
          <View style={styles.solidBg} />
          <BlurView intensity={18} tint="dark" style={styles.inner}>
            <View style={styles.header}>
              <Pressable onPress={closeDrawer} hitSlop={12} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={"rgba(231,234,243,0.92)"} />
              </Pressable>

              <View style={styles.headerCenter}>
                <Text style={styles.title}>FinApp</Text>
                <Text style={styles.version}>v0.1</Text>
              </View>

              <View style={styles.closeBtn} />
            </View>

            <View style={styles.hr} />

            <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 }}>
              {items.map((it, idx) => {
                const active = it.route !== "__logout__" && isActive(it.route);
                const danger = !!it.danger;

                const labelColor = danger
                  ? theme.colors.bad
                  : active
                  ? "rgba(0,240,255,0.95)"
                  : "rgba(231,234,243,0.92)";

                const iconColor = danger
                  ? theme.colors.bad
                  : active
                  ? "rgba(0,240,255,0.95)"
                  : "rgba(231,234,243,0.80)";

                return (
                  <View key={it.route}>
                    <Pressable onPress={() => onPress(it)} style={[styles.row, active && styles.rowActive]}>
                      <Ionicons name={it.icon} size={18} color={iconColor} style={{ width: 26 }} />
                      <Text style={[styles.rowText, { color: labelColor }]}>{it.label}</Text>
                      <View style={{ flex: 1 }} />
                      {!danger ? (
                        <Ionicons name="chevron-forward" size={18} color={"rgba(231,234,243,0.45)"} />
                      ) : null}
                    </Pressable>

                    {idx < items.length - 1 ? <View style={styles.sep} /> : null}
                  </View>
                );
              })}

              <View style={{ height: 18 }} />
              <Text style={styles.footer}>v0.1 • MVP</Text>
            </View>
          </BlurView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 9999,
    elevation: 9999,
    shadowColor: "#000",
    shadowOpacity: 1,
    shadowRadius: 26,
    shadowOffset: { width: 12, height: 0 },
  },
  solidBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,8,14,0.98)",
  },
  inner: {
    flex: 1,
    backgroundColor: "rgba(6,8,14,0.92)",
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.08)",
  },

  header: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: "rgba(231,234,243,0.96)", fontWeight: "900", fontSize: 18 },
  version: { marginTop: 2, color: "rgba(231,234,243,0.55)", fontWeight: "800", fontSize: 12 },

  hr: {
    height: 1,
    marginHorizontal: 18,
    backgroundColor: "rgba(255,255,255,0.10)",
  },

  row: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  rowActive: {
    backgroundColor: "rgba(0,240,255,0.22)",
  },
  rowText: {
    fontWeight: "900",
    fontSize: 15,
  },

  sep: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.10)",
    marginLeft: 32,
    marginTop: 6,
    marginBottom: 6,
  },

  footer: {
    color: "rgba(231,234,243,0.45)",
    fontWeight: "800",
    textAlign: "center",
  },
});