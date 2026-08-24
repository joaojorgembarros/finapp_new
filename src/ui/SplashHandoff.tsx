import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { SonhoBrandLockup } from "./SonhoBrandLockup";

const HANDOFF_DURATION_MS = 190;

export function SplashHandoff({
  active,
  onComplete,
}: {
  active: boolean;
  onComplete?: () => void;
}) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) return;
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: HANDOFF_DURATION_MS,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) onComplete?.();
    });
    return () => animation.stop();
  }, [active, onComplete, opacity]);

  return (
    <Animated.View
      accessibilityLabel="Abrindo o Sonho+"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.surface, { opacity }]}
    >
      <View style={styles.halo} />
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill} viewBox="0 0 390 844">
        <Path
          d="M-55 625c108-86 156 51 260-18 95-63 88-148 245-188"
          fill="none"
          stroke="#F1DCC5"
          strokeOpacity="0.1"
          strokeWidth="1.2"
        />
        <Path
          d="M-65 690c108-86 170 41 278-37 91-66 93-145 247-196"
          fill="none"
          stroke="#D6B78F"
          strokeOpacity="0.055"
          strokeWidth="0.8"
        />
      </Svg>
      <SonhoBrandLockup />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  surface: {
    zIndex: 1000,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#06152e",
  },
  halo: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(23,52,91,0.18)",
  },
});
