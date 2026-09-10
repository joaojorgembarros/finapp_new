import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { OB } from "../../ui/OnboardingKit";
import { DREAMS_COPY } from "./dreamsPresentation";

type TrailPoint = { x: number; y: number };
type TrailSegment = { start: TrailPoint; c1: TrailPoint; c2: TrailPoint; end: TrailPoint };

const HERO_WIDTH = 390;
const HERO_HEIGHT = 248;
const PEAK = { x: 292, y: 64 };

const TRAIL_SEGMENTS: TrailSegment[] = [
  { start: { x: 42, y: 228 }, c1: { x: 108, y: 224 }, c2: { x: 168, y: 214 }, end: { x: 214, y: 196 } },
  { start: { x: 214, y: 196 }, c1: { x: 262, y: 176 }, c2: { x: 278, y: 158 }, end: { x: 246, y: 142 } },
  { start: { x: 246, y: 142 }, c1: { x: 214, y: 128 }, c2: { x: 228, y: 108 }, end: { x: 268, y: 94 } },
  { start: { x: 268, y: 94 }, c1: { x: 292, y: 84 }, c2: { x: 296, y: 74 }, end: { x: PEAK.x, y: PEAK.y } },
];

const TRAIL_PATH =
  `M${TRAIL_SEGMENTS[0].start.x} ${TRAIL_SEGMENTS[0].start.y} ` +
  TRAIL_SEGMENTS.map((segment) => `C${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.end.x} ${segment.end.y}`).join(" ");

function cubicPoint(segment: TrailSegment, t: number) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * segment.start.x + 3 * mt * mt * t * segment.c1.x + 3 * mt * t * t * segment.c2.x + t ** 3 * segment.end.x,
    y: mt ** 3 * segment.start.y + 3 * mt * mt * t * segment.c1.y + 3 * mt * t * t * segment.c2.y + t ** 3 * segment.end.y,
  };
}

function buildTrailPoints() {
  const points: TrailPoint[] = [TRAIL_SEGMENTS[0].start];
  for (const segment of TRAIL_SEGMENTS) {
    for (let step = 1; step <= 18; step += 1) points.push(cubicPoint(segment, step / 18));
  }
  return points;
}

const TRAIL_POINTS = buildTrailPoints();

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

function distance(a: TrailPoint, b: TrailPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointAtProgress(progress: number) {
  const pct = clampProgress(progress) / 100;
  const total = TRAIL_POINTS.reduce((sum, point, index) => {
    if (index === 0) return sum;
    return sum + distance(TRAIL_POINTS[index - 1], point);
  }, 0);
  const target = total * pct;

  let walked = 0;
  for (let index = 1; index < TRAIL_POINTS.length; index += 1) {
    const start = TRAIL_POINTS[index - 1];
    const end = TRAIL_POINTS[index];
    const segment = distance(start, end);
    if (walked + segment >= target) {
      const t = segment === 0 ? 0 : (target - walked) / segment;
      return { x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t };
    }
    walked += segment;
  }

  return TRAIL_POINTS[TRAIL_POINTS.length - 1];
}

export function MountainHero({
  progress,
}: {
  progress: number;
  showProgress?: boolean;
}) {
  const compact = useWindowDimensions().width < 360;
  const marker = pointAtProgress(progress);

  return (
    <View style={styles.hero}>
      <Svg
        pointerEvents="none"
        viewBox={`0 0 ${HERO_WIDTH} ${HERO_HEIGHT}`}
        preserveAspectRatio="xMaxYMid meet"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <SvgLinearGradient id="journeySky" x1="0" y1="0" x2="0" y2={HERO_HEIGHT} gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#061936" />
            <Stop offset="48%" stopColor="#0A3674" />
            <Stop offset="100%" stopColor="#06152E" />
          </SvgLinearGradient>
          <SvgLinearGradient id="farMountain" x1="0" y1="88" x2="0" y2="248" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#2B83E8" />
            <Stop offset="100%" stopColor="#0B2A5E" />
          </SvgLinearGradient>
          <SvgLinearGradient id="mainMountain" x1="250" y1="52" x2="250" y2="248" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#4EA0FF" />
            <Stop offset="52%" stopColor="#1D68C7" />
            <Stop offset="100%" stopColor="#0A2B63" />
          </SvgLinearGradient>
          <SvgLinearGradient id="frontRidge" x1="0" y1="176" x2="0" y2="248" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#164D95" />
            <Stop offset="100%" stopColor="#061833" />
          </SvgLinearGradient>
          <SvgLinearGradient id="pathGlow" x1="42" y1="228" x2={PEAK.x} y2={PEAK.y} gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#BBDDFF" />
            <Stop offset="100%" stopColor="#FFFFFF" />
          </SvgLinearGradient>
          <RadialGradient id="starGlow" cx={PEAK.x} cy={PEAK.y - 22} r="18" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
            <Stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Rect width={HERO_WIDTH} height={HERO_HEIGHT} fill="url(#journeySky)" />
        <Circle cx="300" cy="70" r="108" fill="#2D8BFF" opacity="0.16" />
        <Circle cx="78" cy="210" r="128" fill="#1E72D7" opacity="0.14" />
        {[38, 118, 248, 338].map((x, index) => (
          <Circle key={x} cx={x} cy={[42, 58, 34, 92][index]} r={index === 1 ? 1.5 : 1.1} fill="#7BA0C8" opacity={0.85} />
        ))}
        {[70, 170, 235, 352].map((x, index) => (
          <Circle key={`small-${x}`} cx={x} cy={[20, 86, 48, 36][index]} r={0.8} fill="#BBDDFF" opacity={0.42} />
        ))}

        <Path d="M-20 176 L68 132 L118 154 L176 108 L228 136 L302 58 L410 148 L410 248 L-20 248Z" fill="url(#farMountain)" opacity="0.72" />
        <Path d="M132 168 L184 118 L228 142 L292 64 L372 154 L410 176 L410 248 L132 248Z" fill="url(#mainMountain)" />
        <Path d={`M${PEAK.x} ${PEAK.y} L312 128 L266 108Z`} fill="#7DBBFF" opacity="0.38" />
        <Path d={`M${PEAK.x} ${PEAK.y} L256 138 L228 142Z`} fill="#72B7FF" opacity="0.30" />
        <Path d="M176 108 L196 146 L142 140Z" fill="#7DBBFF" opacity="0.22" />
        <Ellipse cx="248" cy="102" rx="28" ry="4.5" fill="#69A9ED" opacity="0.24" />
        <Path d="M48 148 C74 134 86 134 112 149 C132 161 168 154 198 168 C116 168 52 166 -10 178Z" fill="#0C2E64" opacity="0.70" />
        <Path d="M-20 196 C54 168 120 204 190 180 C252 156 305 184 410 160 L410 248 L-20 248Z" fill="url(#frontRidge)" opacity="0.92" />
        <Path d="M-20 218 C52 194 112 226 178 206 C242 184 296 210 410 186 L410 248 L-20 248Z" fill="#061D40" opacity="0.84" />

        <G opacity="0.82">
          {[16, 38, 66, 348, 366, 382].map((x, index) => (
            <Path
              key={`tree-${x}`}
              d={`M${x} ${index < 3 ? 198 + index * 8 : 154 + (index - 3) * 12} l9 26 h-18 z M${x} ${index < 3 ? 184 + index * 8 : 140 + (index - 3) * 12} l7 20 h-14 z M${x} ${index < 3 ? 172 + index * 8 : 128 + (index - 3) * 12} l6 16 h-12 z`}
              fill="#03152E"
            />
          ))}
        </G>

        <Path d={TRAIL_PATH} stroke="rgba(255,255,255,0.22)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={TRAIL_PATH} stroke="url(#pathGlow)" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Circle cx={marker.x} cy={marker.y} r="10" fill="#FFFFFF" />
        <Circle cx={marker.x} cy={marker.y} r="5.5" fill="#2F73E0" />

        <Circle cx={PEAK.x} cy={PEAK.y - 22} r="16" fill="url(#starGlow)" />
        <Path
          d={`M${PEAK.x} ${PEAK.y - 38}c1.2 12.4 4.6 16.4 16.8 18-12.2 1.6-15.6 5.6-16.8 18-1.2-12.4-4.6-16.4-16.8-18 12.2-1.6 15.6-5.6 16.8-18Z`}
          fill="#F4F7FF"
        />
      </Svg>

      <View style={[styles.heroTextBlock, compact && styles.heroTextBlockCompact]}>
        <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]} accessibilityRole="header">
          {DREAMS_COPY.heroTitle}
        </Text>
        <Text style={[styles.heroSubtitle, compact && styles.heroSubtitleCompact]}>
          {DREAMS_COPY.heroSubtitle}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: "100%",
    aspectRatio: HERO_WIDTH / HERO_HEIGHT,
    backgroundColor: OB.primary,
    overflow: "hidden",
  },
  heroTextBlock: {
    position: "absolute",
    left: 16,
    top: 18,
    width: 200,
    maxWidth: "58%",
    alignItems: "flex-start",
    zIndex: 1,
  },
  heroTextBlockCompact: {
    left: 14,
    top: 14,
    width: 188,
    maxWidth: "64%",
  },
  heroTitle: {
    color: OB.offWhite,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "900",
    textAlign: "left",
  },
  heroTitleCompact: {
    fontSize: 22,
    lineHeight: 28,
  },
  heroSubtitle: {
    color: "rgba(220,235,255,0.86)",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 6,
    textAlign: "left",
  },
  heroSubtitleCompact: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
});
