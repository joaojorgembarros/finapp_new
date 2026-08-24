import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";
import { OB } from "../../ui/OnboardingKit";
import { SonhoBrandLockup } from "../../ui/SonhoBrandLockup";

type TrailPoint = { x: number; y: number };
type TrailSegment = { start: TrailPoint; c1: TrailPoint; c2: TrailPoint; end: TrailPoint };

const HERO_WIDTH = 390;
const HERO_HEIGHT = 252;

const TRAIL_SEGMENTS: TrailSegment[] = [
  { start: { x: 38, y: 229 }, c1: { x: 82, y: 227 }, c2: { x: 128, y: 220 }, end: { x: 169, y: 202 } },
  { start: { x: 169, y: 202 }, c1: { x: 205, y: 194 }, c2: { x: 264, y: 193 }, end: { x: 249, y: 166 } },
  { start: { x: 249, y: 166 }, c1: { x: 238, y: 154 }, c2: { x: 208, y: 153 }, end: { x: 222, y: 132 } },
  { start: { x: 222, y: 132 }, c1: { x: 236, y: 115 }, c2: { x: 272, y: 106 }, end: { x: 289, y: 86 } },
];

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
  if (index === 0) return sum;
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
    ? 276
    : Math.round(Math.max(220, Math.min(260, width * (HERO_HEIGHT / HERO_WIDTH))));
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
            <Stop offset="0%" stopColor="#05142D" />
            <Stop offset="53%" stopColor="#0A2A53" />
            <Stop offset="100%" stopColor="#061831" />
          </SvgLinearGradient>
          <SvgLinearGradient id="farMountain" x1="0" y1="82" x2="0" y2="252" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#3A709F" />
            <Stop offset="58%" stopColor="#17466F" />
            <Stop offset="100%" stopColor="#082342" />
          </SvgLinearGradient>
          <SvgLinearGradient id="mainMountain" x1="250" y1="76" x2="250" y2="252" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#4D82B3" />
            <Stop offset="50%" stopColor="#245985" />
            <Stop offset="100%" stopColor="#09294F" />
          </SvgLinearGradient>
          <SvgLinearGradient id="frontRidge" x1="0" y1="188" x2="0" y2="252" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#123B68" />
            <Stop offset="100%" stopColor="#05172F" />
          </SvgLinearGradient>
          <SvgLinearGradient id="trailGlow" x1="38" y1="229" x2="289" y2="86" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#D9B98F" />
            <Stop offset="58%" stopColor="#F2DEC4" />
            <Stop offset="100%" stopColor="#FFF9EF" />
          </SvgLinearGradient>
        </Defs>

        <Rect width={HERO_WIDTH} height={HERO_HEIGHT} fill="url(#journeySky)" />
        <Circle cx="292" cy="76" r="108" fill="#6EA5D7" opacity="0.09" />
        <Circle cx="55" cy="235" r="126" fill="#2E679A" opacity="0.1" />

        {[
          [35, 51, 1.1],
          [89, 24, 0.7],
          [119, 72, 1.3],
          [174, 42, 0.75],
          [218, 29, 1],
          [327, 42, 0.8],
          [356, 104, 1.1],
        ].map(([x, y, radius], index) => (
          <Circle key={`star-${x}`} cx={x} cy={y} r={radius} fill="#D8E9FA" opacity={0.34 + (index % 3) * 0.12} />
        ))}

        <Path
          d="M-24 220 68 164l54 30 65-55 50 31 52-84 123 98v68H-24Z"
          fill="url(#farMountain)"
          opacity="0.72"
        />
        <Path d="M121 216 174 151l44 32 71-97 86 107 37 24v35H121Z" fill="url(#mainMountain)" />
        <Path d="m289 86 22 78-49-33Z" fill="#86A9CA" opacity="0.21" />
        <Path d="m289 86-43 98-28-1Z" fill="#A7C3DC" opacity="0.16" />
        <Path d="m187 139 20 46-57-21Z" fill="#81A4C5" opacity="0.14" />
        <Ellipse cx="241" cy="123" rx="32" ry="4.5" fill="#A6C5DF" opacity="0.1" />
        <Path d="M138 201c36-9 65-13 91-11 31 3 49-3 67-17" fill="none" stroke="#B6D0E6" strokeWidth="1" opacity="0.11" />
        <Path d="M-22 220c75-27 138 18 210-8 68-25 122 6 224-24v64H-22Z" fill="url(#frontRidge)" opacity="0.94" />
        <Path d="M-22 240c64-22 126 10 196-8 81-21 137 3 238-22v42H-22Z" fill="#061B36" opacity="0.88" />

        <G opacity="0.72">
          {[
            [8, 204],
            [28, 212],
            [354, 180],
            [374, 193],
          ].map(([x, y]) => (
            <Path
              key={`tree-${x}`}
              d={`M${x} ${y}l9 26h-18Z M${x} ${y - 13}l7 21h-14Z M${x} ${y - 24}l6 17h-12Z`}
              fill="#031329"
            />
          ))}
        </G>

        <Path d={TRAIL_PATH} stroke="#031126" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.48" />
        <Path d={TRAIL_PATH} stroke="#F1DCC5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.22" />
        <Path
          d={TRAIL_PATH}
          stroke="#F1DCC5"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={[walkedLength, TRAIL_LENGTH]}
          fill="none"
          opacity={safeProgress > 0 ? 0.1 : 0}
        />
        <Path
          d={TRAIL_PATH}
          stroke="url(#trailGlow)"
          strokeWidth="3.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={[walkedLength, TRAIL_LENGTH]}
          fill="none"
          opacity={safeProgress > 0 ? 1 : 0}
        />

        <Circle cx="38" cy="229" r="8" fill="#06152E" stroke="#F3E4D0" strokeWidth="3" opacity="0.96" />
        {safeProgress > 0 && !isComplete ? (
          <G>
            <Circle cx={marker.x} cy={marker.y} r="9" fill="#F3E0C8" opacity="0.12" />
            <Circle cx={marker.x} cy={marker.y} r="5.2" fill="#FFF9EF" />
            <Circle cx={marker.x} cy={marker.y} r="2.2" fill="#C69B67" />
          </G>
        ) : null}

        <Circle cx="289" cy="68" r={isComplete ? 25 : 20} fill="#F3DFC5" opacity={isComplete ? 0.16 : 0.08} />
        <Path
          d="M289 50c1 11 4 16 15 18-11 2-14 7-15 18-1-11-4-16-15-18 11-2 14-7 15-18Z"
          fill="#F6E6D0"
          opacity={isComplete ? 1 : 0.9}
        />
        <Path d="M303 56c.2 2.7 1 3.5 3.7 3.7-2.7.2-3.5 1-3.7 3.7-.2-2.7-1-3.5-3.7-3.7 2.7-.2 3.5-1-3.7-3.7Z" fill="#F2D7B6" opacity="0.78" />
      </Svg>

      <View style={[styles.heroTextBlock, { left: copyLeft }, compact && styles.heroTextBlockCompact, wide && styles.heroTextBlockWide]}>
        <SonhoBrandLockup style={styles.brand} />
        <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]} accessibilityRole="header">Sua jornada</Text>
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
