import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { OB } from "../../ui/OnboardingKit";
import { SonhoBrandLockup } from "../../ui/SonhoBrandLockup";

type TrailPoint = { x: number; y: number };
type TrailSegment = { start: TrailPoint; c1: TrailPoint; c2: TrailPoint; end: TrailPoint };

const HERO_WIDTH = 390;
const HERO_HEIGHT = 318;
const PEAK = { x: 258, y: 92 };

const TRAIL_SEGMENTS: TrailSegment[] = [
  { start: { x: 32, y: 294 }, c1: { x: 82, y: 293 }, c2: { x: 136, y: 292 }, end: { x: 186, y: 288 } },
  { start: { x: 186, y: 288 }, c1: { x: 228, y: 284 }, c2: { x: 262, y: 274 }, end: { x: 278, y: 256 } },
  { start: { x: 278, y: 256 }, c1: { x: 295, y: 239 }, c2: { x: 272, y: 224 }, end: { x: 238, y: 218 } },
  { start: { x: 238, y: 218 }, c1: { x: 204, y: 215 }, c2: { x: 193, y: 197 }, end: { x: 224, y: 176 } },
  { start: { x: 224, y: 176 }, c1: { x: 246, y: 160 }, c2: { x: 258, y: 146 }, end: { x: 266, y: 128 } },
  { start: { x: 266, y: 128 }, c1: { x: 270, y: 116 }, c2: { x: 266, y: 106 }, end: { x: 262, y: 100 } },
  { start: { x: 262, y: 100 }, c1: { x: 260, y: 96 }, c2: { x: 259, y: 94 }, end: { x: PEAK.x, y: PEAK.y } },
];

const TRAIL_WIDTHS = [1.95, 1.8, 1.62, 1.42, 1.22, 1.04, 0.88];
const TRAIL_GLOW_WIDTHS = [0, 0, 2.2, 2.8, 3.4, 4.2, 5.1];
const TRAIL_GLOW_OPACITY = [0, 0, 0.06, 0.08, 0.11, 0.15, 0.2];

const TRAIL_PATH =
  `M${TRAIL_SEGMENTS[0].start.x} ${TRAIL_SEGMENTS[0].start.y} ` +
  TRAIL_SEGMENTS.map(
    (segment) =>
      `C${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.end.x} ${segment.end.y}`
  ).join(" ");

function cubicPoint(segment: TrailSegment, t: number) {
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * segment.start.x +
      3 * mt * mt * t * segment.c1.x +
      3 * mt * t * t * segment.c2.x +
      t ** 3 * segment.end.x,
    y:
      mt ** 3 * segment.start.y +
      3 * mt * mt * t * segment.c1.y +
      3 * mt * t * t * segment.c2.y +
      t ** 3 * segment.end.y,
  };
}

function buildTrailPoints() {
  const points: TrailPoint[] = [TRAIL_SEGMENTS[0].start];
  for (const segment of TRAIL_SEGMENTS) {
    for (let step = 1; step <= 24; step += 1) points.push(cubicPoint(segment, step / 24));
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

const TRAIL_LENGTH = TRAIL_POINTS.reduce((sum, point, index) => {
  if (index === 0) return 0;
  return sum + distance(TRAIL_POINTS[index - 1], point);
}, 0);

function pointAtProgress(progress: number) {
  const target = TRAIL_LENGTH * (clampProgress(progress) / 100);
  let walked = 0;

  for (let index = 1; index < TRAIL_POINTS.length; index += 1) {
    const start = TRAIL_POINTS[index - 1];
    const end = TRAIL_POINTS[index];
    const segmentLength = distance(start, end);
    if (walked + segmentLength >= target) {
      const t = segmentLength === 0 ? 0 : (target - walked) / segmentLength;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }
    walked += segmentLength;
  }

  return TRAIL_POINTS[TRAIL_POINTS.length - 1];
}

const STAR_DOTS: readonly [number, number, number, number][] = [
  [58, 26, 0.7, 0.28],
  [96, 18, 0.55, 0.22],
  [168, 14, 0.6, 0.2],
  [298, 22, 0.75, 0.32],
  [332, 40, 0.5, 0.24],
  [362, 68, 0.7, 0.26],
  [348, 108, 0.45, 0.18],
  [310, 54, 0.55, 0.2],
];

export function MountainHero({ progress }: { progress: number }) {
  const { width, fontScale } = useWindowDimensions();
  const safeProgress = clampProgress(progress);
  const marker = pointAtProgress(safeProgress);
  const walkedLength = Math.max(0.01, TRAIL_LENGTH * (safeProgress / 100));
  const isComplete = safeProgress >= 100;
  const wide = width >= 600;
  const containedArt = width >= 480 || fontScale > 1.15;
  const compact = width < 350;
  const baseHeight = wide
    ? 352
    : Math.round(Math.max(252, Math.min(336, width * (HERO_HEIGHT / HERO_WIDTH))));
  const accessibilityHeight = Math.round((Math.max(1, Math.min(fontScale, 2.5)) - 1) * 104);
  const height = baseHeight + accessibilityHeight;
  const copyLeft = wide
    ? Math.max(24, (width - 520) / 2 + 18)
    : containedArt
      ? Math.max(18, (width - 420) / 2 + 18)
      : 18;
  const artAlignment = fontScale > 1.15
    ? "xMidYMax meet"
    : containedArt
      ? "xMidYMid meet"
      : "xMidYMid slice";

  return (
    <View style={[styles.hero, { height }]}>
      <Svg
        pointerEvents="none"
        viewBox={`0 0 ${HERO_WIDTH} ${HERO_HEIGHT}`}
        preserveAspectRatio={artAlignment}
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <SvgLinearGradient id="journeySky" x1="0" y1="0" x2="0" y2={HERO_HEIGHT} gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#06152E" />
            <Stop offset="42%" stopColor="#081A38" />
            <Stop offset="100%" stopColor="#06152E" />
          </SvgLinearGradient>
          <SvgLinearGradient id="farRange" x1="0" y1="176" x2="0" y2={HERO_HEIGHT} gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#182D42" />
            <Stop offset="100%" stopColor="#0B1A2C" />
          </SvgLinearGradient>
          <SvgLinearGradient id="midRange" x1="0" y1="198" x2="0" y2={HERO_HEIGHT} gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#203B52" />
            <Stop offset="100%" stopColor="#10263A" />
          </SvgLinearGradient>
          <SvgLinearGradient id="mainBody" x1="258" y1="92" x2="180" y2={HERO_HEIGHT} gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#284A61" />
            <Stop offset="42%" stopColor="#173449" />
            <Stop offset="100%" stopColor="#0B1F32" />
          </SvgLinearGradient>
          <SvgLinearGradient id="litFace" x1="270" y1="92" x2="300" y2="168" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#708494" />
            <Stop offset="55%" stopColor="#405B6D" />
            <Stop offset="100%" stopColor="#223C50" />
          </SvgLinearGradient>
          <SvgLinearGradient id="summitFace" x1="258" y1="92" x2="246" y2="151" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#E8DDCB" />
            <Stop offset="30%" stopColor="#D1C4AF" />
            <Stop offset="66%" stopColor="#7E8B93" />
            <Stop offset="100%" stopColor="#365064" />
          </SvgLinearGradient>
          <RadialGradient id="starGlow" cx={PEAK.x} cy={PEAK.y - 22} rx="15" ry="15" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#F8EBD4" stopOpacity="0.48" />
            <Stop offset="55%" stopColor="#E4C49A" stopOpacity="0.1" />
            <Stop offset="100%" stopColor="#E4C49A" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Rect width={HERO_WIDTH} height={HERO_HEIGHT} fill="url(#journeySky)" />

        {STAR_DOTS.map(([x, y, radius, opacity]) => (
          <Circle key={`star-${x}-${y}`} cx={x} cy={y} r={radius} fill="#E8F0FA" opacity={opacity} />
        ))}

        <Path
          d="M-28 318 L-28 232 C-4 225 16 215 34 206 C50 209 66 219 82 222 C99 216 113 203 128 192 C145 196 161 206 176 210 C194 205 211 193 228 186 C247 191 266 202 282 206 C300 201 320 190 338 184 C361 189 386 199 418 204 L418 318Z"
          fill="url(#farRange)"
          opacity="0.55"
        />

        <Path
          d="M-18 318 L-18 250 C4 241 26 227 48 220 C65 224 81 235 96 238 C113 231 130 214 146 208 C164 213 182 226 198 230 C216 227 232 217 246 214 C254 220 261 229 268 236 L268 318Z"
          fill="url(#midRange)"
          opacity="0.86"
        />
        <Path d="M20 235 C39 227 53 225 68 229 C79 232 87 236 96 238 L84 260 C67 253 51 248 36 246Z" fill="#29475D" opacity="0.3" />
        <Path d="M116 228 C128 218 138 211 146 208 C164 214 181 226 198 230 L184 253 C165 244 148 236 132 232Z" fill="#2B4A60" opacity="0.27" />

        <Path
          d="M96 318 L111 252 L130 236 L151 212 L171 219 L187 225 L203 191 L214 168 L228 153 L239 137 L248 117 L258 92 L269 108 L280 122 L298 140 L314 158 L332 179 L352 200 L373 216 L392 232 L420 250 L420 318Z"
          fill="url(#mainBody)"
        />
        <Path d="M258 92 L248 117 L239 137 L257 134 L280 122 L269 108Z" fill="#183247" opacity="0.94" />
        <Path d="M258 92 L269 108 L280 122 L270 140 L258 134 L247 151 L238 139 L248 117Z" fill="url(#summitFace)" />
        <Path d="M280 122 L298 140 L314 158 L301 174 L271 140 L258 134Z" fill="url(#litFace)" opacity="0.9" />
        <Path d="M258 134 L271 140 L301 174 L328 192 L307 205 L279 190 L254 177Z" fill="#29475C" opacity="0.78" />
        <Path d="M248 117 L239 137 L228 153 L214 168 L202 192 L186 226 L152 212 L172 202 L194 181 L218 151Z" fill="#102A3B" opacity="0.92" />
        <Path d="M228 153 L214 168 L202 192 L186 226 L205 239 L228 248 L241 219 L254 177 L239 137Z" fill="#1A394D" opacity="0.84" />
        <Path d="M254 177 L241 219 L228 248 L258 246 L292 240 L307 217 L328 192 L301 174Z" fill="#173347" opacity="0.84" />
        <Path d="M186 226 L160 232 L132 243 L112 252 L96 318 L151 286 L197 266 L228 248 L205 239Z" fill="#0D2437" opacity="0.96" />
        <Path d="M228 248 L258 246 L292 240 L323 220 L352 200 L373 216 L392 232 L420 250 L420 318 L96 318 L151 286 L197 266Z" fill="#0B2032" opacity="0.97" />

        <Path
          d="M-24 318 L-24 264 L8 251 L32 240 L51 246 L78 256 L99 250 L126 242 L151 248 L176 256 L198 250 L220 246 L220 318Z"
          fill="#050C14"
        />
        <Path
          d="M208 318 L221 286 L232 266 L257 258 L284 250 L312 256 L340 266 L365 260 L391 252 L420 246 L420 318Z"
          fill="#040A12"
        />

        <Path
          d={TRAIL_PATH}
          stroke="#041018"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          opacity="0.32"
        />
        {TRAIL_SEGMENTS.map((segment, index) => (
          <G key={`trail-${index}`}>
            {TRAIL_GLOW_WIDTHS[index] > 0 ? (
              <Path
                d={`M${segment.start.x} ${segment.start.y} C${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.end.x} ${segment.end.y}`}
                stroke="#E8CFAE"
                strokeWidth={TRAIL_GLOW_WIDTHS[index]}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                opacity={TRAIL_GLOW_OPACITY[index]}
              />
            ) : null}
            <Path
              d={`M${segment.start.x} ${segment.start.y} C${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.end.x} ${segment.end.y}`}
              stroke="#F3E2C8"
              strokeWidth={TRAIL_WIDTHS[index]}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </G>
        ))}
        {safeProgress > 0 ? (
          <Path
            d={TRAIL_PATH}
            stroke="#FFF9EF"
            strokeWidth="1.15"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={[walkedLength, TRAIL_LENGTH]}
            fill="none"
            opacity={0.55}
          />
        ) : null}

        <Circle cx="32" cy="294" r="5.6" fill="#06152E" stroke="#F3E4D0" strokeWidth="1.9" />
        {safeProgress > 0 && !isComplete ? (
          <G>
            <Circle cx={marker.x} cy={marker.y} r="4.2" fill="#FFF9EF" />
            <Circle cx={marker.x} cy={marker.y} r="1.7" fill="#C69B67" />
          </G>
        ) : null}

        <Circle cx={PEAK.x} cy={PEAK.y - 22} r={isComplete ? 14 : 12} fill="url(#starGlow)" />
        <Path
          d={`M${PEAK.x} ${PEAK.y - 44} L${PEAK.x} ${PEAK.y - 8}`}
          stroke="#F6E6D0"
          strokeWidth="1.05"
          opacity="0.4"
        />
        <Path
          d={`M${PEAK.x} ${PEAK.y - 44}c1.4 15.1 5.4 20 20.5 22-15.1 2-19.1 6.9-20.5 22-1.4-15.1-5.4-20-20.5-22 15.1-2 19.1-6.9 20.5-22Z`}
          fill="#F8EDDC"
        />
      </Svg>

      <View style={[styles.heroTextBlock, { left: copyLeft }, compact && styles.heroTextBlockCompact, wide && styles.heroTextBlockWide]}>
        <SonhoBrandLockup style={styles.brand} />
        <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]} accessibilityRole="header">Seus sonhos</Text>
        <Text style={[styles.heroSubtitle, compact && styles.heroSubtitleCompact]}>Acompanhe o progresso dos seus sonhos.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: "100%",
    backgroundColor: OB.primaryDeep,
    overflow: "hidden",
  },
  heroTextBlock: {
    position: "absolute",
    top: 15,
    width: 230,
    alignItems: "flex-start",
    zIndex: 1,
  },
  heroTextBlockCompact: {
    width: 192,
  },
  heroTextBlockWide: {
    width: 240,
  },
  brand: {
    marginBottom: 18,
  },
  heroTitle: {
    color: "#F6E8D7",
    fontFamily: "serif",
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "400",
    letterSpacing: -0.5,
  },
  heroTitleCompact: {
    fontSize: 31,
    lineHeight: 36,
  },
  heroSubtitle: {
    color: "rgba(246,232,215,0.78)",
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 23,
    marginTop: 8,
  },
  heroSubtitleCompact: {
    fontSize: 14,
    lineHeight: 20,
  },
});
