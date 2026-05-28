// src/ui/LeftRail.tsx
import React, { useMemo } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "./theme";
import { useDrawer } from "./drawer";
import { supabase } from "../lib/supabase";

type Item = {
  label: string;
  route: string;
  icon: any;
  danger?: boolean;
};

const RAIL_W = 64;
const PANEL_W = 240;

export function railWidth() {
  return RAIL_W;
}

// ✅ ADICIONADO: Gráficos
const ITEMS: Item[] = [
  { label: "Início", route: "/(tabs)/home", icon: "home-outline" },
  { label: "Metas", route: "/(tabs)/goals", icon: "trophy-outline" },
  { label: "Meu mês", route: "/(tabs)/planning", icon: "calendar-outline" },
  { label: "Fechamentos", route: "/(tabs)/closures", icon: "checkmark-done-outline" },
  { label: "Cartões", route: "/(tabs)/cards", icon: "card-outline" },
  { label: "Histórico", route: "/(tabs)/history", icon: "time-outline" },
  { label: "Gráficos", route: "/(tabs)/charts", icon: "bar-chart-outline" },
  { label: "Sair", route: "__logout__", icon: "log-out-outline", danger: true },
];

function stripGroups(route: string) {
  return route
    .replace("/(tabs)", "")
    .replace("/(auth)", "")
    .replace("/(onboarding)", "");
}

function isActivePath(pathname: string, route: string) {
  return pathname === stripGroups(route);
}

export default function LeftRail() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const drawer = useDrawer();

  const panelX = drawer.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-PANEL_W, 0],
  });

  const overlayOpacity = drawer.progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.45],
  });

  async function go(it: Item) {
    if (it.route === "__logout__") {
      try {
        await supabase.auth.signOut();
      } catch {}
      drawer.closeDrawer();
      router.replace("/(auth)/login");
      return;
    }
    router.push(it.route);
    drawer.closeDrawer();
  }

  const railPadTop = useMemo(() => insets.top + 8, [insets.top]);
  const railPadBottom = useMemo(() => insets.bottom + 8, [insets.bottom]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* overlay */}
      <Animated.View
        pointerEvents={drawer.open ? "auto" : "none"}
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: "#000", opacity: overlayOpacity, zIndex: 20, elevation: 20 },
        ]}
      >
        <Pressable style={{ flex: 1 }} onPress={drawer.closeDrawer} />
      </Animated.View>

      {/* rail fixa */}
      <View
        pointerEvents="auto"
        style={[
          styles.rail,
          { paddingTop: railPadTop, paddingBottom: railPadBottom },
        ]}
      >
        <BlurView intensity={16} tint="dark" style={styles.railInner}>
          <Pressable onPress={drawer.toggleDrawer} hitSlop={16} style={styles.hamburger}>
            <Ionicons name="menu" size={26} color={theme.colors.text} />
          </Pressable>

          <View style={styles.sep} />

          <View style={{ gap: 10 }}>
            {ITEMS.filter((x) => x.route !== "__logout__").map((it) => {
              const active = isActivePath(pathname, it.route);
              return (
                <Pressable
                  key={it.route}
                  onPress={() => go(it)}
                  style={[styles.iconBtn, active && styles.iconBtnActive]}
                >
                  <Ionicons
                    name={it.icon}
                    size={22}
                    color={active ? theme.colors.primary : "rgba(231,234,243,0.90)"}
                  />
                </Pressable>
              );
            })}
          </View>

          <View style={{ flex: 1 }} />

          <Pressable onPress={() => go(ITEMS[ITEMS.length - 1])} style={[styles.iconBtn, styles.logoutIcon]}>
            <Ionicons name="log-out-outline" size={22} color={theme.colors.bad} />
          </Pressable>
        </BlurView>
      </View>

      {/* painel */}
      <Animated.View
        pointerEvents={drawer.open ? "auto" : "none"}
        style={[
          styles.panel,
          {
            left: RAIL_W,
            width: PANEL_W,
            transform: [{ translateX: panelX }],
            paddingTop: insets.top + 6,
            paddingBottom: insets.bottom + 8,
            zIndex: 30,
            elevation: 30,
          },
        ]}
      >
        <BlurView intensity={26} tint="dark" style={styles.panelInner}>
          <View style={styles.panelHeader}>
            <Pressable onPress={drawer.toggleDrawer} hitSlop={16} style={styles.headerBtn}>
              <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
            </Pressable>

            <View pointerEvents="none" style={styles.headerCenter}>
              <Text style={styles.brand}>FinApp</Text>
              <Text style={styles.menuSmall}>Menu</Text>
            </View>

            <View style={styles.headerBtn} />
          </View>

          <View style={styles.divider} />
          <View style={{ height: 12 }} />

          <View style={{ gap: 8 }}>
            {ITEMS.map((it) => {
              const active = it.route !== "__logout__" && isActivePath(pathname, it.route);
              const danger = !!it.danger;

              return (
                <Pressable
                  key={it.route}
                  onPress={() => go(it)}
                  style={[styles.row, active && styles.rowActive, danger && styles.rowDanger]}
                >
                  <Text
                    style={[
                      styles.rowText,
                      {
                        color: danger
                          ? theme.colors.bad
                          : active
                          ? theme.colors.primary
                          : theme.colors.text,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {it.label}
                  </Text>

                  <View style={{ flex: 1 }} />

                  {it.route !== "__logout__" ? (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={active ? theme.colors.primary : "rgba(231,234,243,0.45)"}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <View style={{ flex: 1 }} />
          <Text style={styles.footer}>v0.1 • MVP</Text>
        </BlurView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: RAIL_W,
    zIndex: 25,
    elevation: 25,
  },
  railInner: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(11,17,34,0.55)",
    alignItems: "center",
    paddingTop: 6,
    paddingBottom: 6,
    paddingHorizontal: 10,
  },
  hamburger: { paddingVertical: 6, paddingHorizontal: 4 },
  sep: {
    height: 1,
    alignSelf: "stretch",
    backgroundColor: "rgba(255,255,255,0.10)",
    marginVertical: 12,
  },

  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  iconBtnActive: {
    borderColor: "rgba(0,240,255,0.35)",
    backgroundColor: "rgba(0,240,255,0.09)",
  },
  logoutIcon: {
    borderColor: "rgba(255,80,80,0.22)",
    backgroundColor: "rgba(255,80,80,0.05)",
  },

  panel: { position: "absolute", top: 0, bottom: 0 },
  panelInner: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.06)",
    backgroundColor: "rgba(11,17,34,0.90)",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
  },

  panelHeader: { height: 46, justifyContent: "center" },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.02)",
  },
  headerCenter: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  brand: { color: theme.colors.text, fontWeight: "900", fontSize: 16 },
  menuSmall: { marginTop: 2, color: "rgba(231,234,243,0.55)", fontWeight: "800", fontSize: 12 },

  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginTop: 10 },

  row: {
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.018)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  rowActive: {
    borderColor: "rgba(0,240,255,0.28)",
    backgroundColor: "rgba(0,240,255,0.06)",
  },
  rowDanger: {
    borderColor: "rgba(255,80,80,0.18)",
    backgroundColor: "rgba(255,80,80,0.04)",
  },
  rowText: { fontWeight: "900", fontSize: 13 },

  footer: {
    color: "rgba(231,234,243,0.42)",
    fontWeight: "800",
    textAlign: "center",
    paddingBottom: 6,
  },
});