// src/ui/ProfileAvatarMenu.tsx
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [initials, setInitials] = useState("");

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const u: any = data?.user;
        const name =
          u?.user_metadata?.full_name ||
          u?.user_metadata?.name ||
          u?.email ||
          "";
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

  const top = useMemo(() => insets.top + 58, [insets.top]);

  async function onLogout() {
    try {
      await supabase.auth.signOut();
    } catch {}
    setOpen(false);
    router.replace("/(auth)/login");
  }

  function onProfile() {
    setOpen(false);
    router.push("/(tabs)/profile");
  }

  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.btn} hitSlop={10}>
        <BlurView intensity={18} tint="dark" style={styles.inner}>
          <View style={styles.avatar}>
            {initials ? (
              <Text style={styles.avatarText}>{initials}</Text>
            ) : (
              <Ionicons name="person" size={16} color={theme.colors.primary} />
            )}
          </View>
        </BlurView>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View />
        </Pressable>

        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View style={[styles.popover, { top }]}>
            <BlurView intensity={22} tint="dark" style={styles.popoverInner}>
              <Pressable onPress={onProfile} style={styles.item}>
                <View style={styles.iconWrap}>
                  <Ionicons name="person-circle-outline" size={18} color={theme.colors.text} />
                </View>
                <Text style={styles.itemText}>Perfil</Text>
              </Pressable>

              <View style={styles.divider} />

              <Pressable onPress={onLogout} style={[styles.item, styles.dangerItem]}>
                <View style={[styles.iconWrap, styles.dangerIconWrap]}>
                  <Ionicons name="log-out-outline" size={18} color={theme.colors.bad} />
                </View>
                <Text style={[styles.itemText, { color: theme.colors.bad }]}>Sair</Text>
              </Pressable>
            </BlurView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  btn: { width: 44, height: 44, borderRadius: 16, overflow: "hidden" },
  inner: {
    flex: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  avatar: {
    width: 34,
    height: 34,
    borderRadius: 14,
    backgroundColor: "rgba(0,240,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,240,255,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: theme.colors.primary, fontWeight: "900" },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  },

  popover: {
    position: "absolute",
    right: 14,
    width: 210,
    borderRadius: 18,
    overflow: "hidden",
  },
  popoverInner: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    padding: 10,
  },

  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  itemText: { color: theme.colors.text, fontWeight: "900" },

  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },

  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.10)",
    marginVertical: 10,
  },

  dangerItem: {
    borderColor: "rgba(255,80,80,0.20)",
    backgroundColor: "rgba(255,80,80,0.05)",
  },
  dangerIconWrap: {
    borderColor: "rgba(255,80,80,0.28)",
    backgroundColor: "rgba(255,80,80,0.08)",
  },
});
