// src/ui/SideMenu.tsx
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";
import { useDrawerOptional } from "./drawer";

export default function SideMenu() {
  const drawer = useDrawerOptional();
  if (!drawer) return null;

  return (
    <Pressable onPress={drawer.toggleDrawer} hitSlop={14} style={styles.btn}>
      <Ionicons name="menu" size={26} color={theme.colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: 6,
    paddingHorizontal: 6,
  },
});