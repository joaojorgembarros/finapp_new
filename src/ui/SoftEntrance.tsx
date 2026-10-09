import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, ViewStyle } from "react-native";
import { PRESENTATION_MOTION } from "./presentationMotion";

export function SoftEntrance({
  activeKey,
  children,
  style,
}: {
  activeKey?: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(PRESENTATION_MOTION.translateY)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(PRESENTATION_MOTION.translateY);
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: PRESENTATION_MOTION.durationMs,
        useNativeDriver: PRESENTATION_MOTION.useNativeDriver,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: PRESENTATION_MOTION.durationMs,
        useNativeDriver: PRESENTATION_MOTION.useNativeDriver,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [activeKey, opacity, translateY]);

  return (
    <Animated.View style={[styles.fill, style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { gap: 12 },
});
