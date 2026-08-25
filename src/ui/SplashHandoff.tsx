import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, {
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

const SPLASH_LOCKUP = require("../../assets/splash-lockup.png");
const SPLASH_WORDMARK = require("../../assets/splash-wordmark-bodoni-moda.png");
const SPLASH_BRAND_SYMBOL = require("../../assets/splash-brand-symbol.png");
const NATIVE_LOCKUP_WIDTH = 200;
const NATIVE_LOCKUP_HEIGHT = NATIVE_LOCKUP_WIDTH * (466 / 1948);
const WORDMARK_CROP_WIDTH = NATIVE_LOCKUP_WIDTH * (1440 / 1948);
const BRAND_SYMBOL_LEFT = NATIVE_LOCKUP_WIDTH * (1489 / 1948);
const BRAND_SYMBOL_HEIGHT = NATIVE_LOCKUP_HEIGHT * (430 / 466);
const BRAND_SYMBOL_WIDTH = BRAND_SYMBOL_HEIGHT * (784 / 824);
const BRAND_SYMBOL_TOP = (NATIVE_LOCKUP_HEIGHT - BRAND_SYMBOL_HEIGHT) / 2;
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
  const targetLockupWidth = Math.min(Math.max(width * 0.6, 218), 250);
  const targetLockupScale = targetLockupWidth / NATIVE_LOCKUP_WIDTH;
  const targetLockupTranslateY = -Math.min(
    Math.max(height * 0.083, 56),
    74,
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
              x1="0"
              x2="390"
              y1="844"
              y2="0"
            >
              <Stop offset="0" stopColor="#040D22" />
              <Stop offset="0.56" stopColor="#06132D" />
              <Stop offset="1" stopColor="#091934" />
            </LinearGradient>
            <RadialGradient
              id="ambientDepth"
              cx="455"
              cy="78"
              gradientUnits="userSpaceOnUse"
              rx="470"
              ry="600"
            >
              <Stop offset="0" stopColor="#294469" stopOpacity="0.085" />
              <Stop offset="0.48" stopColor="#182F50" stopOpacity="0.025" />
              <Stop offset="1" stopColor="#06132D" stopOpacity="0" />
            </RadialGradient>
            <LinearGradient
              id="edgeDepth"
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="390"
              y1="844"
              y2="0"
            >
              <Stop offset="0" stopColor="#010716" stopOpacity="0.1" />
              <Stop offset="0.62" stopColor="#07162F" stopOpacity="0" />
              <Stop offset="1" stopColor="#263C60" stopOpacity="0.018" />
            </LinearGradient>
            <LinearGradient
              id="goldThread"
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="425"
              y1="820"
              y2="390"
            >
              <Stop offset="0" stopColor="#E7CFA7" stopOpacity="0.18" />
              <Stop offset="0.38" stopColor="#FFF4DE" stopOpacity="0.78" />
              <Stop offset="0.72" stopColor="#EFD5AA" stopOpacity="0.42" />
              <Stop offset="1" stopColor="#DAB984" stopOpacity="0.1" />
            </LinearGradient>
            <LinearGradient
              id="verticalRay"
              gradientUnits="userSpaceOnUse"
              x1="292"
              x2="292"
              y1="600"
              y2="688"
            >
              <Stop offset="0" stopColor="#FFF9EE" stopOpacity="0" />
              <Stop offset="0.5" stopColor="#FFF9EE" stopOpacity="0.24" />
              <Stop offset="1" stopColor="#FFF9EE" stopOpacity="0" />
            </LinearGradient>
            <LinearGradient
              id="horizontalRay"
              gradientUnits="userSpaceOnUse"
              x1="246"
              x2="338"
              y1="644"
              y2="644"
            >
              <Stop offset="0" stopColor="#FFF9EE" stopOpacity="0" />
              <Stop offset="0.5" stopColor="#FFF9EE" stopOpacity="0.2" />
              <Stop offset="1" stopColor="#FFF9EE" stopOpacity="0" />
            </LinearGradient>
            <RadialGradient
              id="starLight"
              cx="292"
              cy="644"
              gradientUnits="userSpaceOnUse"
              rx="16"
              ry="22"
            >
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.32" stopColor="#FFFDF7" />
              <Stop offset="0.72" stopColor="#F7E3BF" />
              <Stop offset="1" stopColor="#E8CDA6" />
            </RadialGradient>
          </Defs>

          <Rect width="390" height="844" fill="url(#nightDepth)" />
          <Rect width="390" height="844" fill="url(#ambientDepth)" />
          <Rect width="390" height="844" fill="url(#edgeDepth)" />

          <Path
            d="M423 414C393 443 374 473 344 498C311 526 279 554 239 573C198 592 155 591 112 598C65 605 23 622-24 651"
            fill="none"
            stroke="url(#goldThread)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.42"
            strokeWidth="0.44"
          />
          <Path
            d="M423 570C389 596 354 620 320 637C308 642 300 644 292 644C270 665 253 693 225 712C190 736 153 746 115 761C72 777 35 814 20 860"
            fill="none"
            stroke="url(#goldThread)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.36"
            strokeWidth="0.38"
          />
          <Path
            d="M292 644C322 676 348 705 421 716"
            fill="none"
            stroke="url(#goldThread)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.18"
            strokeWidth="0.3"
          />

          <G>
            <Path
              d="M292 600C292.4 625 292.6 638 294.2 644C292.6 650 292.4 663 292 688C291.6 663 291.4 650 289.8 644C291.4 638 291.6 625 292 600Z"
              fill="url(#verticalRay)"
            />
            <Path
              d="M246 644C272 643.6 286.7 643.4 292 641.8C297.3 643.4 312 643.6 338 644C312 644.4 297.3 644.6 292 646.2C286.7 644.6 272 644.4 246 644Z"
              fill="url(#horizontalRay)"
            />
            <Path
              d="M292 623C292.8 637.2 296.2 641.8 307 644C296.2 646.2 292.8 650.8 292 665C291.2 650.8 287.8 646.2 277 644C287.8 641.8 291.2 637.2 292 623Z"
              fill="url(#starLight)"
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
        <Animated.Image
          accessible={false}
          resizeMode="contain"
          source={SPLASH_LOCKUP}
          style={[
            styles.lockup,
            {
              opacity: richness.interpolate({
                inputRange: [0, 1],
                outputRange: [1, 0],
              }),
            },
          ]}
        />
        <Animated.View style={[styles.refinedLockup, { opacity: richness }]}>
          <View style={styles.wordmarkCrop}>
            <Image
              accessible={false}
              resizeMode="contain"
              source={SPLASH_WORDMARK}
              style={styles.refinedWordmark}
            />
          </View>
          <Image
            accessible={false}
            resizeMode="contain"
            source={SPLASH_BRAND_SYMBOL}
            style={styles.brandSymbol}
          />
        </Animated.View>
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
    width: NATIVE_LOCKUP_WIDTH,
    height: NATIVE_LOCKUP_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  lockup: {
    ...StyleSheet.absoluteFillObject,
    width: NATIVE_LOCKUP_WIDTH,
    height: NATIVE_LOCKUP_HEIGHT,
  },
  refinedLockup: {
    ...StyleSheet.absoluteFillObject,
  },
  wordmarkCrop: {
    position: "absolute",
    left: 0,
    top: 0,
    width: WORDMARK_CROP_WIDTH,
    height: NATIVE_LOCKUP_HEIGHT,
    overflow: "hidden",
  },
  refinedWordmark: {
    width: NATIVE_LOCKUP_WIDTH,
    height: NATIVE_LOCKUP_HEIGHT,
  },
  brandSymbol: {
    position: "absolute",
    left: BRAND_SYMBOL_LEFT,
    top: BRAND_SYMBOL_TOP,
    width: BRAND_SYMBOL_WIDTH,
    height: BRAND_SYMBOL_HEIGHT,
    tintColor: "#F9E8CA",
  },
});
