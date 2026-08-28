import React, { useEffect, useRef } from "react";
import {
  Animated,
  Image,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, {
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

const SPLASH_WORDMARK = require("../../assets/splash-wordmark-italiana.png");
const SPLASH_BRAND_SYMBOL = require("../../assets/splash-brand-symbol.png");

// Lockup geometry, in multiples of the wordmark x-height, measured off the reference
// mockup rectified to a 390x844 canvas (x-height there = 51 px).
const WORDMARK_W = 4.25163;
const WORDMARK_H = 1.49346;
const WORDMARK_TOP = 0.08041;
const SYMBOL_LEFT = 4.44771;
// the official star is squarer than the mockup's, so it is sized between matching the
// reference star's width and its height rather than either one exactly
const SYMBOL_W = 1.72549;
const SYMBOL_H = SYMBOL_W / 0.951;
const SYMBOL_PRESENCE = 1.055;
const LOCKUP_W = SYMBOL_LEFT + SYMBOL_W;
const LOCKUP_H = SYMBOL_H;
// measured lockup on the 390x844 reference: 76.4% wide, centre Y 42.89%
const LOCKUP_WIDTH_RATIO = 0.76;
const LOCKUP_CENTRE_Y_RATIO = 0.4289;
const DESIGN_WIDTH = 390;
// measured word span: reference 211px / current 204px
const WORDMARK_SCALE_X = 211 / 204;
// measured ink centre was 13px left of the reference; shift the whole lockup
const LOCKUP_SHIFT_X = 13;
export function SplashHandoff({
  active,
  fadeDurationMs = 200,
  onComplete,
  onReady,
}: {
  active: boolean;
  fadeDurationMs?: number;
  onComplete?: () => void;
  onReady?: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const opacity = useRef(new Animated.Value(1)).current;
  const readiness = useRef({
    layout: false,
    symbol: false,
    wordmark: false,
    reported: false,
  });
  const lockupWidth = Math.min(
    Math.max(width * LOCKUP_WIDTH_RATIO, 250),
    360,
  );
  const xHeight = lockupWidth / LOCKUP_W;
  const lockupHeight = xHeight * LOCKUP_H;
  const targetLockupTranslateX = LOCKUP_SHIFT_X * (width / DESIGN_WIDTH);
  const targetLockupTranslateY = -Math.min(
    Math.max(height * (0.5 - LOCKUP_CENTRE_Y_RATIO), 48),
    78,
  );

  const reportReadyIfComplete = () => {
    const current = readiness.current;
    if (
      current.reported ||
      !current.layout ||
      !current.symbol ||
      !current.wordmark
    ) {
      return;
    }
    current.reported = true;
    onReady?.();
  };

  const markReady = (part: "layout" | "symbol" | "wordmark") => {
    readiness.current[part] = true;
    reportReadyIfComplete();
  };

  useEffect(() => {
    if (!active) return;
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: fadeDurationMs,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) onComplete?.();
    });
    return () => animation.stop();
  }, [active, fadeDurationMs, onComplete, opacity]);

  return (
    <Animated.View
      accessibilityLabel="Abrindo o Sonho+"
      collapsable={false}
      needsOffscreenAlphaCompositing
      pointerEvents="none"
      renderToHardwareTextureAndroid
      style={[styles.surface, { opacity }]}
      onLayout={() => markReady("layout")}
    >
      <View style={styles.artwork}>
        <Svg
          pointerEvents="none"
          preserveAspectRatio="xMidYMid slice"
          style={StyleSheet.absoluteFill}
          viewBox="0 0 390 844"
        >
          <Defs>
            <LinearGradient
              id="goldThread"
              gradientUnits="userSpaceOnUse"
              x1="-25"
              x2="420"
              y1="872"
              y2="362"
            >
              <Stop offset="0" stopColor="#E3BC74" stopOpacity="0.40" />
              <Stop offset="0.28" stopColor="#F4D290" stopOpacity="0.58" />
              <Stop offset="0.55" stopColor="#FFEAC0" stopOpacity="0.76" />
              <Stop offset="0.82" stopColor="#FBD99C" stopOpacity="0.62" />
              <Stop offset="1" stopColor="#F2CC8A" stopOpacity="0.48" />
            </LinearGradient>
            <RadialGradient
              id="sparkGlow"
              cx="301"
              cy="667"
              gradientUnits="userSpaceOnUse"
              r="42"
              gradientTransform="matrix(0.86 0 0 1 42.14 0)"
            >
              <Stop offset="0" stopColor="#FFE9C4" stopOpacity="0.40" />
              <Stop offset="0.30" stopColor="#F0D09A" stopOpacity="0.22" />
              <Stop offset="0.62" stopColor="#D4B37A" stopOpacity="0.08" />
              <Stop offset="1" stopColor="#D4B37A" stopOpacity="0" />
            </RadialGradient>
            <LinearGradient
              id="verticalRay"
              gradientUnits="userSpaceOnUse"
              x1="301"
              x2="301"
              y1="585"
              y2="749"
            >
              <Stop offset="0" stopColor="#FFEFD4" stopOpacity="0" />
              <Stop offset="0.16" stopColor="#FFEFD4" stopOpacity="0.08" />
              <Stop offset="0.36" stopColor="#FFEFD4" stopOpacity="0.36" />
              <Stop offset="0.5" stopColor="#FFEFD4" stopOpacity="0.82" />
              <Stop offset="0.64" stopColor="#FFEFD4" stopOpacity="0.36" />
              <Stop offset="0.84" stopColor="#FFEFD4" stopOpacity="0.08" />
              <Stop offset="1" stopColor="#FFEFD4" stopOpacity="0" />
            </LinearGradient>
            <LinearGradient
              id="horizontalRay"
              gradientUnits="userSpaceOnUse"
              x1="251"
              x2="351"
              y1="667"
              y2="667"
            >
              <Stop offset="0" stopColor="#FFEFD4" stopOpacity="0" />
              <Stop offset="0.28" stopColor="#FFEFD4" stopOpacity="0.09" />
              <Stop offset="0.5" stopColor="#FFEFD4" stopOpacity="0.50" />
              <Stop offset="0.72" stopColor="#FFEFD4" stopOpacity="0.09" />
              <Stop offset="1" stopColor="#FFEFD4" stopOpacity="0" />
            </LinearGradient>
            <RadialGradient
              id="starCore"
              cx="301"
              cy="667"
              gradientUnits="userSpaceOnUse"
              r="22"
              gradientTransform="matrix(0.86 0 0 1 42.14 0)"
            >
              <Stop offset="0" stopColor="#FFFCF4" stopOpacity="0.98" />
              <Stop offset="0.32" stopColor="#FFE9C4" stopOpacity="0.84" />
              <Stop offset="0.70" stopColor="#F0D09A" stopOpacity="0.40" />
              <Stop offset="1" stopColor="#EFC783" stopOpacity="0" />
            </RadialGradient>
          </Defs>

          <Rect width="390" height="844" fill="#06152e" />
          <Rect x="256" y="622" width="90" height="90" fill="url(#sparkGlow)" />

          <Path
            d="M-25 640C-18.3 637 3.3 628.3 15 622C26.7 615.7 35 607.7 45 602C55 596.3 65 591.7 75 588C85 584.3 95 582.3 105 580C115 577.7 125 576.2 135 574C145 571.8 155 569.7 165 567C175 564.3 185 561.7 195 558C205 554.3 215 550.2 225 545C235 539.8 245 533.7 255 527C265 520.3 275 513.2 285 505C295 496.8 305 487.7 315 478C325 468.3 332.5 460.8 345 447C357.5 433.2 377.5 409.2 390 395C402.5 380.8 415 367.5 420 362"
            fill="none"
            stroke="url(#goldThread)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.88"
            strokeWidth="0.55"
          />
          <Path
            d="M5 872C11.7 866.5 33.3 849.8 45 839C56.7 828.2 65 815.8 75 807C85 798.2 95 792.2 105 786C115 779.8 125 774.7 135 770C145 765.3 155 762 165 758C175 754 185 750.8 195 746C205 741.2 215 736.7 225 729C235 721.3 245 709.5 255 700C265 690.5 275 681.8 285 672C295 662.2 305 651.7 315 641C325 630.3 335 619.3 345 608C355 596.7 362.5 588.5 375 573C387.5 557.5 412.5 524.7 420 515"
            fill="none"
            stroke="url(#goldThread)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.88"
            strokeWidth="0.48"
          />

          <Path
            d="M301 585C301.11 622.38 301.24 650.12 302.30 667C301.24 683.88 301.11 711.62 301 749C300.89 711.62 300.76 683.88 299.70 667C300.76 650.12 300.89 622.38 301 585Z"
            fill="url(#verticalRay)"
          />
          <Path
            d="M253 667C271 666.90 288 666.75 301 665.80C314 666.75 331 666.90 349 667C331 667.10 314 667.25 301 668.20C288 667.25 271 667.10 253 667Z"
            fill="url(#horizontalRay)"
          />
          <Path
            d="M301 638C301.16 657 302.7 664.6 326 667C302.7 669.4 301.16 677 301 696C300.84 677 299.3 669.4 276 667C299.3 664.6 300.84 657 301 638Z"
            fill="url(#starCore)"
          />
        </Svg>
      </View>

      <View
        style={[
          styles.brand,
          {
            width: lockupWidth,
            height: lockupHeight,
            transform: [
              { translateX: targetLockupTranslateX },
              { translateY: targetLockupTranslateY },
            ],
          },
        ]}
      >
        <Image
          accessible={false}
          onLoad={() => markReady("wordmark")}
          resizeMode="contain"
          source={SPLASH_WORDMARK}
          style={{
            position: "absolute",
            left: 0,
            top: xHeight * WORDMARK_TOP,
            width: xHeight * WORDMARK_W,
            height: xHeight * WORDMARK_H,
            transform: [{ scaleX: WORDMARK_SCALE_X }],
          }}
        />
        <Image
          accessible={false}
          onLoad={() => markReady("symbol")}
          resizeMode="contain"
          source={SPLASH_BRAND_SYMBOL}
          style={{
            position: "absolute",
            left: xHeight * SYMBOL_LEFT,
            top: (xHeight * SYMBOL_H * (1 - SYMBOL_PRESENCE)) / 2,
            width: xHeight * SYMBOL_W * SYMBOL_PRESENCE,
            height: xHeight * SYMBOL_H * SYMBOL_PRESENCE,
            tintColor: "#FDECD6",
          }}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  surface: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#06152e",
  },
  artwork: {
    ...StyleSheet.absoluteFillObject,
  },
  brand: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
});
