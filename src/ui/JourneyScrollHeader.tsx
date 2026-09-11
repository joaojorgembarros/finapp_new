import React from "react";
import {
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { OB } from "./OnboardingKit";

export const JOURNEY_HEADER_HEIGHT = 56;

function initialsFrom(nameOrEmail: string) {
  const parts = nameOrEmail.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "U").toUpperCase();
}

type JourneyScrollHeaderProps = {
  avatarUrl?: string | null;
  displayName: string;
  active: boolean;
  onPress: () => void;
  scrollY: Animated.Value;
};

export function JourneyScrollHeader({
  avatarUrl,
  displayName,
  active,
  onPress,
  scrollY,
}: JourneyScrollHeaderProps) {
  const translateY = scrollY.interpolate({
    inputRange: [0, JOURNEY_HEADER_HEIGHT],
    outputRange: [0, -JOURNEY_HEADER_HEIGHT],
    extrapolate: "clamp",
  });

  const opacity = scrollY.interpolate({
    inputRange: [0, JOURNEY_HEADER_HEIGHT * 0.65],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          height: JOURNEY_HEADER_HEIGHT,
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Abrir menu"
        accessibilityState={{ selected: active }}
        style={({ pressed }) => [
          styles.avatar,
          pressed && styles.avatarPressed,
        ]}
      >
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={styles.avatarImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitials}>
              {initialsFrom(displayName)}
            </Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    justifyContent: "center",
    paddingHorizontal: 16,
    zIndex: 20,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2.5,
    borderColor: OB.white,
    overflow: "hidden",
    backgroundColor: OB.primary,
    shadowColor: OB.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  avatarPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
  },
  avatarImage: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  avatarInitials: {
    color: OB.white,
    fontSize: 16,
    fontWeight: "900",
  },
});
