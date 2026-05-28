// src/ui/ProfileAvatarMenu.tsx
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { theme } from "./theme";
import { supabase } from "../lib/supabase";

function initialsFrom(nameOrEmail: string) {
  const s = (nameOrEmail || "").trim();
  if (!s) return "";
  if (s.includes("@")) {
    const n = s.split("@")[0] || "";
    return (n.slice(0, 2) || "U").toUpperCase();
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return (parts[0].slice(0, 2) || "U").toUpperCase();
  const a = parts[0]?.[0] ?? "U";
  const b = parts[parts.length - 1]?.[0] ?? "";
  return `${a}${b}`.toUpperCase();
}

export default function ProfileAvatarMenu() {
  const [initials, setInitials] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u: any = data?.user;
        const name = u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email || "";
        const ini = initialsFrom(name);
        if (alive) setInitials(ini || "U");
      } catch {
        if (alive) setInitials("U");
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <Pressable onPress={() => router.push("/(tabs)/profile")} style={styles.btn} hitSlop={10}>
      <LinearGradient colors={theme.gradient.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.ring}>
        <BlurView intensity={24} tint="light" style={styles.inner}>
          <LinearGradient
            colors={["rgba(255,255,255,0.98)", "rgba(239,246,255,0.94)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.avatar}
          >
            {initials ? (
              <Text style={styles.avatarText}>{initials}</Text>
            ) : (
              <Ionicons name="person" size={18} color={theme.colors.primary} />
            )}
          </LinearGradient>
          <View style={styles.statusDot} />
        </BlurView>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 48, height: 48, borderRadius: 24, overflow: "visible" },
  ring: {
    flex: 1,
    borderRadius: 24,
    padding: 2,
    ...theme.shadow,
  },
  inner: {
    flex: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: theme.colors.primary, fontWeight: "900", fontSize: 15 },
  statusDot: {
    position: "absolute",
    right: 1,
    bottom: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: theme.colors.good,
  },
});
