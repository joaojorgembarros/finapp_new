import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import Svg, {
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

const SPLASH_LOCKUP = require("../../assets/splash-lockup.png");
const NATIVE_LOCKUP_WIDTH = 200;
const RICHNESS_REVEAL_DURATION_MS = 180;

export function SplashHandoff({
  active,
  fadeDurationMs = 200,
  onComplete,
}: {
  active: boolean;
  fadeDurationMs?: number;
  onComplete?: () => void;
}) {
  const { height, width } = useWindowDimensions();
  const opacity = useRef(new Animated.Value(1)).current;
  const richness = useRef(new Animated.Value(0)).current;
  const targetLockupWidth = Math.min(Math.max(width * 0.66, 236), 276);
  const targetLockupScale = targetLockupWidth / NATIVE_LOCKUP_WIDTH;
  const targetLockupTranslateY = -Math.min(
    Math.max(height * 0.085, 58),
    78,
  );

  useEffect(() => {
    const animation = Animated.timing(richness, {
      toValue: 1,
      duration: RICHNESS_REVEAL_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [richness]);

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
    >
      <Animated.View style={[styles.artwork, { opacity: richness }]}>
        <Svg
          pointerEvents="none"
          preserveAspectRatio="xMidYMid slice"
          style={StyleSheet.absoluteFill}
          viewBox="0 0 390 844"
        >
          <Defs>
            <LinearGradient
              id="nightDepth"
              gradientUnits="userSpaceOnUse"
              x1="22"
              x2="372"
              y1="0"
              y2="844"
            >
              <Stop offset="0" stopColor="#041127" />
              <Stop offset="0.48" stopColor="#0A2148" />
              <Stop offset="1" stopColor="#071937" />
            </LinearGradient>
            <RadialGradient
              id="topDepth"
              cx="310"
              cy="122"
              gradientUnits="userSpaceOnUse"
              rx="260"
              ry="330"
            >
              <Stop offset="0" stopColor="#294879" stopOpacity="0.34" />
              <Stop offset="0.52" stopColor="#17345F" stopOpacity="0.14" />
              <Stop offset="1" stopColor="#06152E" stopOpacity="0" />
            </RadialGradient>
            <RadialGradient
              id="brandGlow"
              cx="195"
              cy="350"
              gradientUnits="userSpaceOnUse"
              rx="176"
              ry="132"
            >
              <Stop offset="0" stopColor="#315181" stopOpacity="0.13" />
              <Stop offset="0.58" stopColor="#17365F" stopOpacity="0.04" />
              <Stop offset="1" stopColor="#06152E" stopOpacity="0" />
            </RadialGradient>
            <RadialGradient
              id="lowerDepth"
              cx="308"
              cy="680"
              gradientUnits="userSpaceOnUse"
              rx="238"
              ry="270"
            >
              <Stop offset="0" stopColor="#173768" stopOpacity="0.26" />
              <Stop offset="1" stopColor="#06152E" stopOpacity="0" />
            </RadialGradient>
            <LinearGradient
              id="goldThread"
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="430"
              y1="730"
              y2="380"
            >
              <Stop offset="0" stopColor="#B88A50" stopOpacity="0.16" />
              <Stop offset="0.48" stopColor="#E3C293" stopOpacity="0.72" />
              <Stop offset="1" stopColor="#C5965B" stopOpacity="0.28" />
            </LinearGradient>
          </Defs>

          <Rect width="390" height="844" fill="url(#nightDepth)" />
          <Ellipse cx="310" cy="122" rx="260" ry="330" fill="url(#topDepth)" />
          <Ellipse cx="195" cy="350" rx="176" ry="132" fill="url(#brandGlow)" />
          <Ellipse cx="308" cy="680" rx="238" ry="270" fill="url(#lowerDepth)" />

          <Path
            d="M-54 677C38 590 112 632 190 574C272 514 301 444 434 366"
            fill="none"
            stroke="url(#goldThread)"
            strokeLinecap="round"
            strokeOpacity="0.54"
            strokeWidth="0.72"
          />
          <Path
            d="M-58 836C31 724 102 765 181 697C255 633 283 557 435 477"
            fill="none"
            stroke="url(#goldThread)"
            strokeLinecap="round"
            strokeOpacity="0.46"
            strokeWidth="0.66"
          />
          <Path
            d="M-62 945C35 816 103 845 183 776C259 710 322 676 441 693"
            fill="none"
            stroke="url(#goldThread)"
            strokeLinecap="round"
            strokeOpacity="0.32"
            strokeWidth="0.58"
          />

          <G>
            <Path
              d="M292 614C294.4 635.6 300.4 641.6 322 644C300.4 646.4 294.4 652.4 292 674C289.6 652.4 283.6 646.4 262 644C283.6 641.6 289.6 635.6 292 614Z"
              fill="#E8C58F"
              opacity="0.045"
            />
            <Path
              d="M292 624C293.7 637.7 298.3 642.3 312 644C298.3 645.7 293.7 650.3 292 664C290.3 650.3 285.7 645.7 272 644C285.7 642.3 290.3 637.7 292 624Z"
              fill="#F2D8AC"
              opacity="0.14"
            />
            <Path
              d="M292 628C293.2 638.8 297.2 642.8 308 644C297.2 645.2 293.2 649.2 292 660C290.8 649.2 286.8 645.2 276 644C286.8 642.8 290.8 638.8 292 628Z"
              fill="#FFF2D6"
            />
          </G>
        </Svg>
      </Animated.View>

      <Animated.View
        style={[
          styles.brand,
          {
            transform: [
              {
                translateY: richness.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, targetLockupTranslateY],
                }),
              },
              {
                scale: richness.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, targetLockupScale],
                }),
              },
            ],
          },
        ]}
      >
        <Image
          accessible={false}
          resizeMode="contain"
          source={SPLASH_LOCKUP}
          style={styles.lockup}
        />
      </Animated.View>
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
  },
  lockup: {
    width: NATIVE_LOCKUP_WIDTH,
    height: NATIVE_LOCKUP_WIDTH * (466 / 1948),
  },
});
