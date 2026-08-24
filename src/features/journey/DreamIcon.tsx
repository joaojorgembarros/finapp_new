import React from "react";
import { Image, StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";
import { OB } from "../../ui/OnboardingKit";
import { DreamIconKind, resolveDreamIconKind } from "./dreamIconCatalog";

type DreamIconProps = {
  title: string;
  size?: number;
  completed?: boolean;
  imageUri?: string | null;
  style?: StyleProp<ViewStyle>;
};

function DreamGlyph({ kind }: { kind: DreamIconKind }) {
  switch (kind) {
    case "emergency":
      return (
        <>
          <Path d="M12 2.8 19 5.5v5.3c0 4.4-2.8 8-7 10.4-4.2-2.4-7-6-7-10.4V5.5l7-2.7Z" />
          <Path d="M12 7.7v6.6M8.7 11h6.6" />
        </>
      );
    case "home":
      return (
        <>
          <Path d="m3.5 10.4 8.5-6.8 8.5 6.8" />
          <Path d="M5.5 9.4v10.2h13V9.4M9.7 19.6v-5.3h4.6v5.3" />
          <Path d="M16.2 5.7V3.9h2.3v3.7" />
        </>
      );
    case "travel":
      return (
        <>
          <Path d="m3.2 13.1 7.3-2.8 4.4-6.2c.6-.9 1.8-1.3 2.8-.8.9.5 1.2 1.7.7 2.6l-3.2 5.3 5.6 2.2-1.2 2.1-6.9-.6-3.8 5.2-1.5-.7 1.9-6.2-4.8 1.7-1.3-1.8Z" />
        </>
      );
    case "car":
      return (
        <>
          <Path d="m5.2 10.2 1.7-4h10.2l1.7 4 1.4 1.4v5.2H3.8v-5.2l1.4-1.4Z" />
          <Path d="M5.2 10.2h13.6M7.1 13.3h.1M16.8 13.3h.1" />
          <Path d="M5.7 16.8v2M18.3 16.8v2" />
        </>
      );
    case "motorcycle":
      return (
        <>
          <Circle cx="5.4" cy="16.4" r="3.1" />
          <Circle cx="18.6" cy="16.4" r="3.1" />
          <Path d="m5.4 16.4 4.1-6.3 3.1 6.3H8.7l4.8-5.2h3.6M14.8 7.7h3.1l1.1 2.4" />
        </>
      );
    case "wedding":
      return (
        <>
          <Circle cx="9.2" cy="13.7" r="5.1" />
          <Circle cx="14.8" cy="13.7" r="5.1" />
          <Path d="m12 3.1 2.5 2.6L12 8.3 9.5 5.7 12 3.1Z" />
        </>
      );
    case "education":
      return (
        <>
          <Path d="m3 8.8 9-4.6 9 4.6-9 4.7-9-4.7Z" />
          <Path d="M6.6 10.8v4.4c3.4 2.4 7.4 2.4 10.8 0v-4.4M21 8.8v6.5" />
          <Circle cx="21" cy="17.2" r=".8" />
        </>
      );
    case "business":
      return (
        <>
          <Rect x="3.2" y="7.5" width="17.6" height="11.8" rx="2.4" />
          <Path d="M8.5 7.5V5.8c0-.7.6-1.2 1.2-1.2h4.6c.7 0 1.2.5 1.2 1.2v1.7M3.2 11.4c4.8 2.8 12.8 2.8 17.6 0M10.2 13.3h3.6" />
        </>
      );
    case "health":
      return (
        <>
          <Path d="M20.4 8.7c0 5.1-5.1 8.8-8.4 11-3.3-2.2-8.4-5.9-8.4-11 0-2.6 1.8-4.4 4.3-4.4 1.7 0 3.2.9 4.1 2.4.9-1.5 2.4-2.4 4.1-2.4 2.5 0 4.3 1.8 4.3 4.4Z" />
          <Path d="M7.4 12h2.4l1.3-2.6 2.1 5 1.2-2.4h2.3" />
        </>
      );
    case "retirement":
      return (
        <>
          <Path d="M4 16.7h16M6.2 20h11.6" />
          <Path d="M7.6 16.7a4.4 4.4 0 1 1 8.8 0" />
          <Path d="M12 3v2M5.6 5.7 7 7.1M18.4 5.7 17 7.1M3 11h2M19 11h2" />
        </>
      );
    case "debt":
      return (
        <>
          <Rect x="3.2" y="4.2" width="17.6" height="15.6" rx="2.8" />
          <Path d="M3.2 8.8h17.6M7.2 14.1l2.1 2.1 4.5-4.5M16.2 14.5h1.7" />
        </>
      );
    case "investment":
      return (
        <>
          <Path d="M4 19.5V4.5M4 19.5h16" />
          <Path d="m6.8 15.8 4-4.2 3.1 2.2 5.2-6.2" />
          <Path d="M15.7 7.6h3.4V11" />
        </>
      );
    case "family":
      return (
        <>
          <Circle cx="8.3" cy="8.2" r="2.8" />
          <Circle cx="16.6" cy="9" r="2.3" />
          <Path d="M3.7 19.5v-2.1c0-3 1.9-4.9 4.6-4.9s4.6 1.9 4.6 4.9v2.1M13 14.2c.8-.9 1.9-1.4 3.3-1.4 2.4 0 4 1.7 4 4.3v2.4" />
        </>
      );
    case "relocation":
      return (
        <>
          <Path d="M17.7 9.1c0 4.1-5.7 9.2-5.7 9.2S6.3 13.2 6.3 9.1a5.7 5.7 0 1 1 11.4 0Z" />
          <Circle cx="12" cy="9.1" r="2" />
          <Path d="M5 20.2c3.4 1 10.6 1 14 0" />
        </>
      );
    case "freedom":
      return (
        <>
          <Circle cx="9" cy="10" r="5" />
          <Path d="M12.5 6.5 20 3.8v4h-2.2v2.3h-2.3v2.3h-2.1M5.5 13.5 3.2 15.8M8 15l-2.6 2.6" />
        </>
      );
    default:
      return (
        <>
          <Path d="M12 2.8c.5 5.4 1.8 6.7 7.2 7.2-5.4.5-6.7 1.8-7.2 7.2-.5-5.4-1.8-6.7-7.2-7.2 5.4-.5 6.7-1.8 7.2-7.2Z" />
          <Path d="M19 15.8c.2 2.1.7 2.6 2.8 2.8-2.1.2-2.6.7-2.8 2.8-.2-2.1-.7-2.6-2.8-2.8 2.1-.2 2.6-.7 2.8-2.8Z" />
        </>
      );
  }
}

function GlyphSvg({ kind, size, color, strokeWidth = 1.7 }: { kind: DreamIconKind; size: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
        <DreamGlyph kind={kind} />
      </G>
    </Svg>
  );
}

export function DreamIcon({ title, size = 46, completed = false, imageUri, style }: DreamIconProps) {
  const kind = resolveDreamIconKind(title);
  const radius = Math.round(size * 0.28);
  const glyphSize = Math.round(size * 0.54);
  const color = "#F4E4D0";

  return (
    <View
      accessible={false}
      pointerEvents="none"
      style={[
        styles.shadow,
        { width: size, height: size, borderRadius: radius },
        completed && styles.shadowCompleted,
        style,
      ]}
    >
      <LinearGradient
        colors={completed ? ["#173654", "#0B213F"] : ["#122B56", "#091A36"]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[
          styles.frame,
          { width: size, height: size, borderRadius: radius },
          completed && styles.frameCompleted,
        ]}
      >
        {imageUri ? (
          <>
            <Image source={{ uri: imageUri }} style={styles.photo} resizeMode="cover" />
            <LinearGradient
              colors={["transparent", "rgba(6,21,46,0.42)"]}
              start={{ x: 0.35, y: 0.2 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.photoGlyph}>
              <GlyphSvg kind={kind} size={11} color="#FFFFFF" strokeWidth={1.9} />
            </View>
          </>
        ) : (
          <>
            <View style={styles.iconSparkle}>
              <Svg width={8} height={8} viewBox="0 0 8 8">
                <Path d="M4 .2c.2 2.2.8 3 3.2 3.8C4.8 4.8 4.2 5.6 4 7.8 3.8 5.6 3.2 4.8.8 4 3.2 3.2 3.8 2.4 4 .2Z" fill="#F1DCC5" />
              </Svg>
            </View>
            <GlyphSvg kind={kind} size={glyphSize} color={color} />
          </>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: OB.primaryDeep,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  shadowCompleted: {
    shadowColor: "#CBA77D",
    shadowOpacity: 0.16,
  },
  frame: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(241,220,197,0.14)",
  },
  frameCompleted: {
    borderColor: "rgba(241,220,197,0.48)",
  },
  iconSparkle: {
    position: "absolute",
    top: 4,
    right: 5,
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  photoGlyph: {
    position: "absolute",
    right: 4,
    bottom: 4,
    width: 17,
    height: 17,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(6,21,46,0.74)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.36)",
  },
});
