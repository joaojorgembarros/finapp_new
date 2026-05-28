// src/ui/AppHeader.tsx
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "./theme";
import { useDrawerOptional } from "./drawer";

// se você tiver esse componente no seu projeto, ele vai aparecer automaticamente.
// se não tiver, o header usa um avatar simples.
let ProfileAvatarMenu: any = null;
try {
  // @ts-ignore
  ProfileAvatarMenu = require("./ProfileAvatarMenu").default;
} catch {}

export default function AppHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const drawer = useDrawerOptional();

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 10 }]}>
      <BlurView intensity={16} tint="dark" style={styles.bar}>
        {/* left */}
        <View style={styles.side}>
          {drawer ? (
            <Pressable onPress={drawer.toggleDrawer} hitSlop={14} style={styles.iconBtn}>
              <Ionicons name="menu" size={22} color={"rgba(231,234,243,0.92)"} />
            </Pressable>
          ) : (
            <View style={styles.iconBtn} />
          )}
        </View>

        {/* center */}
        <View style={styles.center}>
          <Text numberOfLines={1} style={styles.title}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} style={styles.subtitle}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {/* right */}
        <View style={[styles.side, { alignItems: "flex-end" }]}>
          {right ?? (ProfileAvatarMenu ? <ProfileAvatarMenu /> : <View style={styles.fallbackAvatar} />)}
        </View>
      </BlurView>

      <View style={styles.hr} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
  },
  bar: {
    height: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(6,8,14,0.70)",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  side: {
    width: 56,
    justifyContent: "center",
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  title: {
    color: "rgba(231,234,243,0.96)",
    fontWeight: "900",
    fontSize: 16,
  },
  subtitle: {
    marginTop: 2,
    color: "rgba(231,234,243,0.55)",
    fontWeight: "800",
    fontSize: 12,
  },
  hr: {
    height: 1,
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.08)",
    marginHorizontal: 2,
  },
  fallbackAvatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(0,240,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(0,240,255,0.20)",
  },
});