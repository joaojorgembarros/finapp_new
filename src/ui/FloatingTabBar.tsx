import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OB } from "./OnboardingKit";

type MenuIcon = keyof typeof Ionicons.glyphMap;

export type FloatingTabItem<T extends string = string> = {
  id: T;
  icon?: MenuIcon;
  image?: ImageSourcePropType;
  accessibilityLabel: string;
};

type FloatingTabBarProps<T extends string> = {
  items: readonly FloatingTabItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
};

const ITEM_SIZE = 48;
const HIGHLIGHT_SIZE = 44;

function TabIcon({
  icon,
  image,
  active,
}: {
  icon?: MenuIcon;
  image?: ImageSourcePropType;
  active: boolean;
}) {
  const tint = active ? OB.white : OB.support;
  if (image) {
    return (
      <Image
        source={image}
        style={[styles.iconImage, { tintColor: tint }]}
        resizeMode="contain"
      />
    );
  }
  return <Ionicons name={icon ?? "ellipse-outline"} size={24} color={tint} />;
}

export function FloatingTabBar<T extends string>({
  items,
  activeId,
  onSelect,
}: FloatingTabBarProps<T>) {
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom: Math.max(insets.bottom, 10) }]}
    >
      <View style={styles.pill}>
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <Pressable
              key={item.id}
              onPress={() => onSelect(item.id)}
              style={[styles.itemButton, active && styles.itemButtonActive]}
              accessibilityRole="button"
              accessibilityLabel={item.accessibilityLabel}
              accessibilityState={{ selected: active }}
            >
              <TabIcon icon={item.icon} image={item.image} active={active} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 20,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: OB.white,
    shadowColor: OB.shadow,
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  itemButton: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: ITEM_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  itemButtonActive: {
    width: HIGHLIGHT_SIZE,
    height: HIGHLIGHT_SIZE,
    borderRadius: HIGHLIGHT_SIZE / 2,
    backgroundColor: OB.primary,
  },
  iconImage: {
    width: 24,
    height: 24,
  },
});
