// src/ui/drawer.tsx
import React, { createContext, useContext, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Platform, Pressable, StatusBar as RNStatusBar, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
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

type DrawerItem = {
  label: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  action?: "logout";
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
  const W = Dimensions.get("window").width;
  const drawerW = Math.min(320, Math.round(W * 0.82));
  const [open, setOpen] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  function openDrawer() {
    setOpen(true);
    Animated.spring(progress, { toValue: 1, damping: 24, stiffness: 220, useNativeDriver: true }).start();
  }

  function closeDrawer() {
    Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setOpen(false));
  }

  function toggleDrawer() {
    if (open) closeDrawer();
    else openDrawer();
  }

  const value = useMemo(() => ({ open, progress, drawerW, openDrawer, closeDrawer, toggleDrawer }), [open, progress, drawerW]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function DrawerHost() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { open, progress, drawerW, closeDrawer } = useDrawer();
  const topInset = Math.max(insets.top, Platform.OS === "android" ? RNStatusBar.currentHeight ?? 0 : 0);

  const drawerX = progress.interpolate({ inputRange: [0, 1], outputRange: [-drawerW, 0] });
  const overlayOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.5] });

  const items: DrawerItem[] = [
    { label: "Início", route: "/(tabs)/home", icon: "home-outline" },
    { label: "Orçamento", route: "/(tabs)/planning", icon: "pie-chart-outline" },
    { label: "Gráficos", route: "/(tabs)/insights", icon: "bar-chart-outline" },
    { label: "Importar Extrato", route: "/(tabs)/import-extract", icon: "cloud-upload-outline" },
    { label: "Planejamento", route: "/(tabs)/goals", icon: "trophy-outline" },
    { label: "Fechamentos", route: "/(tabs)/closures", icon: "checkmark-circle-outline" },
    { label: "Categorias", route: "/(tabs)/categories", icon: "pricetags-outline" },
    { label: "Perfil", route: "/(tabs)/profile", icon: "person-outline" },
  ];

  async function onPress(it: DrawerItem) {
    closeDrawer();
    if (it.action === "logout") {
      try {
        await supabase.auth.signOut();
      } catch {}
      setTimeout(() => router.replace("/(auth)/login"), 100);
      return;
    }
    setTimeout(() => router.push(it.route), 90);
  }

  function active(route: string) {
    return pathname === route;
  }

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[StyleSheet.absoluteFill, { zIndex: 40, elevation: 40, backgroundColor: "#000", opacity: overlayOpacity }]}
      >
        <Pressable style={{ flex: 1 }} onPress={closeDrawer} />
      </Animated.View>

      {open ? (
        <>
          <View pointerEvents="none" style={[styles.topShield, { height: topInset }]} />
          <View
            pointerEvents="none"
            style={[
              styles.bottomShield,
              {
                height: Math.max(insets.bottom, 24),
              },
            ]}
          />
        </>
      ) : null}

      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        style={[styles.drawer, { width: drawerW, top: topInset, transform: [{ translateX: drawerX }] }]}
      >
        <View style={styles.drawerInner}>
          <LinearGradient
            colors={theme.gradient.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <Pressable onPress={closeDrawer} style={styles.closeBtn} hitSlop={12}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>

            <View style={styles.avatar}>
              <Text style={styles.avatarText}>F</Text>
            </View>
            <Text style={styles.userName}>FinApp</Text>
            <Text style={styles.userEmail}>Seu controle financeiro</Text>
          </LinearGradient>

          <Animated.ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: insets.bottom + 18 }}
            showsVerticalScrollIndicator={false}
          >
            {items.map((it) => {
              const isActive = active(it.route);
              return (
                <Pressable key={it.route} onPress={() => onPress(it)} style={{ borderRadius: 18, overflow: "hidden" }}>
                  {isActive ? (
                    <LinearGradient
                      colors={theme.gradient.brand}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.item}
                    >
                      <Ionicons name={it.icon} size={20} color="#fff" />
                      <Text style={[styles.itemText, { color: "#fff" }]}>{it.label}</Text>
                    </LinearGradient>
                  ) : (
                    <View style={styles.item}>
                      <Ionicons name={it.icon} size={20} color={theme.colors.muted} />
                      <Text style={styles.itemText}>{it.label}</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </Animated.ScrollView>

          <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
            <Pressable onPress={() => onPress({ label: "Sair", route: "", icon: "log-out-outline", action: "logout" })} style={styles.logout}>
              <Ionicons name="log-out-outline" size={20} color={theme.colors.bad} />
              <Text style={styles.logoutText}>Sair</Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: "absolute",
    left: 0,
    bottom: 0,
    zIndex: 50,
    elevation: 50,
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 8, height: 0 },
  },
  drawerInner: {
    flex: 1,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  topShield: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    zIndex: 45,
    elevation: 45,
    backgroundColor: theme.colors.bg0,
  },
  bottomShield: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 45,
    elevation: 45,
    backgroundColor: "#fff",
  },
  hero: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "rgba(255,255,255,0.20)",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
  },
  avatarText: { color: "#fff", fontWeight: "900", fontSize: 26 },
  userName: { color: "#fff", fontWeight: "900", fontSize: 20, marginTop: 12 },
  userEmail: { color: "rgba(255,255,255,0.78)", fontWeight: "700", marginTop: 4 },
  item: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  itemText: { color: theme.colors.text, fontWeight: "800", fontSize: 15 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  logout: {
    minHeight: 52,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 16,
    backgroundColor: "rgba(254,226,226,0.72)",
  },
  logoutText: { color: theme.colors.bad, fontWeight: "800", fontSize: 15 },
});
