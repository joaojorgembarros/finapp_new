// src/ui/SideMenu.tsx
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";
import { useDrawerOptional } from "./drawer";

export default function SideMenu() {
  const drawer = useDrawerOptional();
  if (!drawer) return null;

  return (
    <Pressable onPress={drawer.toggleDrawer} style={styles.btn} hitSlop={10}>
      <View style={styles.inner}>
        <Ionicons name="menu" size={20} color={theme.colors.text} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 52,
    height: 44,
    overflow: "hidden",
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  inner: {
    flex: 1,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderLeftWidth: 0,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.86)",
  },
});
