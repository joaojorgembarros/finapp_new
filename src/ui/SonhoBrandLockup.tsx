import React from "react";
import { StyleProp, StyleSheet, Text, View, ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

export function SonhoBrandLockup({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View accessible accessibilityLabel="Sonho mais" style={[styles.lockup, style]}>
      <Text style={styles.wordmark}>sonho</Text>
      <View accessible={false} style={styles.star}>
        <Svg width={36} height={42} viewBox="0 0 36 42">
          <Path
            d="M18 1c1.7 13.7 5 18.1 17 20-12 1.9-15.3 6.3-17 20-1.7-13.7-5-18.1-17-20C13 19.1 16.3 14.7 18 1Z"
            fill="#F1DCC5"
          />
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 42,
  },
  wordmark: {
    color: "#F1DCC5",
    fontFamily: "serif",
    fontSize: 35,
    fontWeight: "400",
    letterSpacing: -1.25,
    lineHeight: 42,
  },
  star: {
    width: 36,
    height: 42,
    marginLeft: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
