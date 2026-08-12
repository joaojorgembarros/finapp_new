import React from "react";
import { StyleSheet, Text, View } from "react-native";
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

type TrailPoint = { x: number; y: number };
type TrailSegment = { start: TrailPoint; c1: TrailPoint; c2: TrailPoint; end: TrailPoint };

const TRAIL_SEGMENTS: TrailSegment[] = [
  { start: { x: 34, y: 274 }, c1: { x: 96, y: 264 }, c2: { x: 176, y: 260 }, end: { x: 250, y: 246 } },
  { start: { x: 250, y: 246 }, c1: { x: 316, y: 232 }, c2: { x: 309, y: 214 }, end: { x: 254, y: 201 } },
  { start: { x: 254, y: 201 }, c1: { x: 207, y: 191 }, c2: { x: 223, y: 169 }, end: { x: 282, y: 151 } },
  { start: { x: 282, y: 151 }, c1: { x: 320, y: 136 }, c2: { x: 306, y: 106 }, end: { x: 286, y: 88 } },
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

export function MountainHero({ progress }: { progress: number }) {
  const marker = pointAtProgress(progress);

  return (
    <View style={styles.hero}>
      <Svg pointerEvents="none" viewBox="0 0 390 335" preserveAspectRatio="xMidYMid slice" style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgLinearGradient id="journeySky" x1="0" y1="0" x2="0" y2="335" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#061936" />
            <Stop offset="46%" stopColor="#0A3674" />
            <Stop offset="100%" stopColor="#06152E" />
          </SvgLinearGradient>
          <SvgLinearGradient id="farMountain" x1="0" y1="118" x2="0" y2="300" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#2B83E8" />
            <Stop offset="100%" stopColor="#0B2A5E" />
          </SvgLinearGradient>
          <SvgLinearGradient id="mainMountain" x1="250" y1="76" x2="250" y2="300" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#4EA0FF" />
            <Stop offset="52%" stopColor="#1D68C7" />
            <Stop offset="100%" stopColor="#0A2B63" />
          </SvgLinearGradient>
          <SvgLinearGradient id="frontRidge" x1="0" y1="230" x2="0" y2="350" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#164D95" />
            <Stop offset="100%" stopColor="#061833" />
          </SvgLinearGradient>
          <SvgLinearGradient id="pathGlow" x1="40" y1="286" x2="286" y2="88" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#BBDDFF" />
            <Stop offset="100%" stopColor="#FFFFFF" />
          </SvgLinearGradient>
        </Defs>

        <Rect width="390" height="335" fill="url(#journeySky)" />
        <Circle cx="285" cy="92" r="118" fill="#2D8BFF" opacity="0.18" />
        <Circle cx="82" cy="270" r="150" fill="#1E72D7" opacity="0.16" />
        {[38, 118, 248, 320].map((x, index) => (
          <Circle key={x} cx={x} cy={[50, 76, 42, 116][index]} r={index === 1 ? 1.5 : 1.1} fill="#7BA0C8" opacity={0.85} />
        ))}
        {[70, 170, 235, 310].map((x, index) => (
          <Circle key={`small-${x}`} cx={x} cy={[24, 112, 66, 48][index]} r={0.8} fill="#BBDDFF" opacity={0.42} />
        ))}

        <Path d="M-20 228 L72 176 L122 202 L188 148 L242 178 L302 96 L410 186 L410 335 L-20 335Z" fill="url(#farMountain)" opacity="0.72" />
        <Path d="M125 212 L174 158 L220 188 L286 88 L372 198 L410 224 L410 335 L125 335Z" fill="url(#mainMountain)" />
        <Path d="M286 88 L306 168 L260 140Z" fill="#7DBBFF" opacity="0.38" />
        <Path d="M286 88 L246 184 L220 188Z" fill="#72B7FF" opacity="0.30" />
        <Path d="M188 148 L208 192 L150 184Z" fill="#7DBBFF" opacity="0.22" />
        <Ellipse cx="235" cy="132" rx="30" ry="5" fill="#69A9ED" opacity="0.24" />
        <Path d="M48 188 C74 174 86 174 112 189 C132 201 168 194 198 208 C116 208 52 206 -10 218Z" fill="#0C2E64" opacity="0.70" />
        <Path d="M-20 252 C54 216 120 260 190 232 C252 204 305 236 410 204 L410 335 L-20 335Z" fill="url(#frontRidge)" opacity="0.92" />
        <Path d="M-20 282 C52 250 112 292 178 266 C242 238 296 270 410 236 L410 335 L-20 335Z" fill="#061D40" opacity="0.84" />

        <G opacity="0.82">
          {[8, 29, 58, 353, 368, 382].map((x, index) => (
            <Path
              key={`tree-${x}`}
              d={`M${x} ${index < 3 ? 248 + index * 10 : 206 + (index - 3) * 15} l10 30 h-20 z M${x} ${index < 3 ? 232 + index * 10 : 190 + (index - 3) * 15} l8 24 h-16 z M${x} ${index < 3 ? 218 + index * 10 : 176 + (index - 3) * 15} l7 20 h-14 z`}
              fill="#03152E"
            />
          ))}
        </G>

        <Path d={TRAIL_PATH} stroke="rgba(255,255,255,0.26)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Path d={TRAIL_PATH} stroke="url(#pathGlow)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <Circle cx={marker.x} cy={marker.y} r="12" fill="#FFFFFF" />
        <Circle cx={marker.x} cy={marker.y} r="6.5" fill="#2F73E0" />
        <Path d="M286 56 L286 88" stroke="#DCEBFF" strokeWidth="2" strokeLinecap="round" />
        <Path d="M286 56 L308 64 L286 73Z" fill="#DCEBFF" />
      </Svg>

      <View style={styles.heroTextBlock}>
        <Text style={styles.heroTitle} accessibilityRole="header">Seus sonhos</Text>
        <Text style={styles.heroSubtitle}>Acompanhe o progresso dos seus sonhos.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 236,
    backgroundColor: OB.primary,
    overflow: "hidden",
  },
  heroTextBlock: {
    position: "absolute",
    left: 16,
    top: 22,
    width: 184,
    alignItems: "flex-start",
    zIndex: 1,
  },
  heroTitle: {
    color: OB.offWhite,
    fontSize: 27,
    fontWeight: "900",
    textAlign: "left",
  },
  heroSubtitle: {
    color: "rgba(220,235,255,0.86)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 7,
    textAlign: "left",
  },
});
