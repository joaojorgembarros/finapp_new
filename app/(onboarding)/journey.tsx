import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
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
import { router, useLocalSearchParams } from "expo-router";
import { OB, OnboardingShell, PrimaryButton } from "../../src/ui/OnboardingKit";
import { formatBRLFromCents, parseBRLToCents } from "../../src/lib/format";
import { supabase } from "../../src/lib/supabase";

type Tab = "controle" | "jornada" | "desafios";
type MenuIcon = keyof typeof Ionicons.glyphMap;
type TrailPoint = { x: number; y: number };
type TrailSegment = { start: TrailPoint; c1: TrailPoint; c2: TrailPoint; end: TrailPoint };

const TRAIL_SEGMENTS: TrailSegment[] = [
  {
    start: { x: 34, y: 274 },
    c1: { x: 96, y: 264 },
    c2: { x: 176, y: 260 },
    end: { x: 250, y: 246 },
  },
  {
    start: { x: 250, y: 246 },
    c1: { x: 316, y: 232 },
    c2: { x: 309, y: 214 },
    end: { x: 254, y: 201 },
  },
  {
    start: { x: 254, y: 201 },
    c1: { x: 207, y: 191 },
    c2: { x: 223, y: 169 },
    end: { x: 282, y: 151 },
  },
  {
    start: { x: 282, y: 151 },
    c1: { x: 322, y: 138 },
    c2: { x: 324, y: 121 },
    end: { x: 306, y: 108 },
  },
];

const TRAIL_PATH =
  `M${TRAIL_SEGMENTS[0].start.x} ${TRAIL_SEGMENTS[0].start.y} ` +
  TRAIL_SEGMENTS.map((segment) => `C${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.end.x} ${segment.end.y}`).join(" ");

function cubicPoint(segment: TrailSegment, t: number) {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * segment.start.x +
      3 * mt * mt * t * segment.c1.x +
      3 * mt * t * t * segment.c2.x +
      t * t * t * segment.end.x,
    y:
      mt * mt * mt * segment.start.y +
      3 * mt * mt * t * segment.c1.y +
      3 * mt * t * t * segment.c2.y +
      t * t * t * segment.end.y,
  };
}

function buildTrailPoints() {
  const points: TrailPoint[] = [TRAIL_SEGMENTS[0].start];
  for (const segment of TRAIL_SEGMENTS) {
    for (let step = 1; step <= 18; step += 1) {
      points.push(cubicPoint(segment, step / 18));
    }
  }
  return points;
}

const TRAIL_POINTS = buildTrailPoints();

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
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
  for (let i = 1; i < TRAIL_POINTS.length; i += 1) {
    const start = TRAIL_POINTS[i - 1];
    const end = TRAIL_POINTS[i];
    const segment = distance(start, end);
    if (walked + segment >= target) {
      const t = segment === 0 ? 0 : (target - walked) / segment;
      return {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
      };
    }
    walked += segment;
  }

  return TRAIL_POINTS[TRAIL_POINTS.length - 1];
}

function readJson<T>(raw: string | string[] | undefined, fallback: T): T {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function MountainHero({ progress }: { progress: number }) {
  const progressPct = clampProgress(progress);
  const marker = pointAtProgress(progressPct);

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
          <SvgLinearGradient id="pathGlow" x1="40" y1="286" x2="306" y2="108" gradientUnits="userSpaceOnUse">
            <Stop offset="0%" stopColor="#BBDDFF" />
            <Stop offset="100%" stopColor="#FFFFFF" />
          </SvgLinearGradient>
        </Defs>

        <Rect width="390" height="335" rx="0" fill="url(#journeySky)" />
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

        <Path
          d={TRAIL_PATH}
          stroke="rgba(255,255,255,0.26)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Path
          d={TRAIL_PATH}
          stroke="url(#pathGlow)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <Circle cx={marker.x} cy={marker.y} r="12" fill="#FFFFFF" />
        <Circle cx={marker.x} cy={marker.y} r="6.5" fill="#2F73E0" />

        <Path d="M306 76 L306 108" stroke="#DCEBFF" strokeWidth="2" strokeLinecap="round" />
        <Path d="M306 76 L326 83 L306 91Z" fill="#DCEBFF" />

      </Svg>

      <View style={styles.heroTextBlock}>
        <Text style={styles.heroEyebrow}>Sua jornada</Text>
        <Text style={styles.heroTitle}>Sua jornada</Text>
        <Text style={styles.heroSubtitle}>Acompanhe o progresso dos seus sonhos.</Text>
      </View>

      <View style={styles.badge}>
        <Ionicons name="trail-sign-outline" size={22} color="#DCEBFF" />
        <Text style={styles.badgeText}>{progressPct}% concluído</Text>
      </View>

    </View>
  );
}

function ProgressCard({ label, value, percent, icon }: { label: string; value: string; percent: number; icon: string }) {
  return (
    <View style={styles.goalCard}>
      <View style={styles.goalBadge}>
        <Ionicons name={icon as any} size={20} color={OB.primary} />
      </View>
      <View style={styles.goalInfo}>
        <Text style={styles.goalTitle}>{label}</Text>
        <Text style={styles.goalValue}>Meta: {value}</Text>
        <View style={styles.smallTrack}>
          <View style={[styles.smallFill, { width: `${Math.min(100, percent)}%` }]} />
        </View>
      </View>
      <View style={styles.ring}>
        <Text style={styles.ringText}>{percent}%</Text>
      </View>
    </View>
  );
}

function DrawerButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: MenuIcon;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.drawerItem, active && styles.drawerItemActive]}>
      <Ionicons name={icon} size={20} color={active ? "#fff" : OB.support} />
      <Text style={[styles.drawerItemText, active && styles.drawerItemTextActive]}>{label}</Text>
      <Ionicons name="chevron-forward" size={15} color={active ? "rgba(255,255,255,0.74)" : OB.support} />
    </Pressable>
  );
}

function JourneyDrawer({
  open,
  activeTab,
  onClose,
  onTab,
  onLogout,
}: {
  open: boolean;
  activeTab: Tab;
  onClose: () => void;
  onTab: (tab: Tab) => void;
  onLogout: () => void;
}) {
  if (!open) return null;

  function goTab(tab: Tab) {
    onTab(tab);
    onClose();
  }

  function goRoute(pathname: "/(onboarding)/dreams" | "/(onboarding)/dream-values" | "/(onboarding)/financial-freedom") {
    onClose();
    router.push(pathname);
  }

  return (
    <View style={styles.drawerLayer}>
      <Pressable onPress={onClose} style={styles.drawerScrim} />
      <View style={styles.drawerPanel}>
        <View style={styles.drawerHero}>
          <Pressable onPress={onClose} style={styles.drawerClose} hitSlop={12}>
            <Ionicons name="close" size={21} color="#fff" />
          </Pressable>
          <View style={styles.drawerAvatar}>
            <Text style={styles.drawerAvatarText}>F</Text>
          </View>
          <Text style={styles.drawerTitle}>Finapp</Text>
          <Text style={styles.drawerSubtitle}>Sua jornada financeira</Text>
        </View>

        <View style={styles.drawerList}>
          <DrawerButton icon="compass-outline" label="Jornada" active={activeTab === "jornada"} onPress={() => goTab("jornada")} />
          <DrawerButton icon="sparkles-outline" label="Sonhos" onPress={() => goRoute("/(onboarding)/dreams")} />
          <DrawerButton icon="cash-outline" label="Valores dos sonhos" onPress={() => goRoute("/(onboarding)/dream-values")} />
          <DrawerButton icon="wallet-outline" label="Painel financeiro" active={activeTab === "controle"} onPress={() => goRoute("/(onboarding)/financial-freedom")} />
          <DrawerButton icon="trophy-outline" label="Desafios" active={activeTab === "desafios"} onPress={() => goTab("desafios")} />
        </View>

        <View style={styles.drawerFooter}>
          <Pressable onPress={onLogout} style={styles.logoutButton}>
            <Ionicons name="log-out-outline" size={20} color="#B94A4A" />
            <Text style={styles.logoutText}>Sair da conta</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function JourneyScreen() {
  const params = useLocalSearchParams<{ dreams?: string; values?: string }>();
  const [tab, setTab] = useState<Tab>("jornada");
  const [menuOpen, setMenuOpen] = useState(false);
  const [challengeDone, setChallengeDone] = useState(false);

  const dreams = useMemo(() => readJson<string[]>(params.dreams, ["Reserva de emergência", "Investir mais", "Liberdade financeira"]), [params.dreams]);
  const values = useMemo(() => readJson<Record<string, string>>(params.values, {}), [params.values]);

  const cards = dreams.slice(0, 3).map((dream, index) => {
    const cents = parseBRLToCents(values[dream] ?? "");
    return {
      label: dream,
      value: cents > 0 ? formatBRLFromCents(cents) : "a definir",
      percent: [75, 48, 22][index] ?? 15,
      icon: ["home-outline", "trending-up-outline", "flag-outline"][index] ?? "sparkles-outline",
    };
  });
  const journeyProgress = cards[0]?.percent ?? 0;

  function goToPanel() {
    router.replace("/(onboarding)/financial-freedom");
  }

  async function logout() {
    setMenuOpen(false);
    await supabase.auth.signOut();
    router.replace("/(auth)/login");
  }

  return (
    <OnboardingShell light>
      <View style={styles.root}>
        <View style={styles.content}>
          {tab === "jornada" ? (
            <>
              <MountainHero progress={journeyProgress} />
              <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Seus sonhos</Text>
                  <Text style={styles.sectionLink}>ver todos</Text>
                </View>
                {cards.map((card) => (
                  <ProgressCard key={card.label} {...card} />
                ))}

                <View style={styles.monthCard}>
                  <View style={styles.monthIcon}>
                    <Ionicons name="stats-chart" size={20} color="#fff" />
                  </View>
                  <View>
                    <Text style={styles.monthEyebrow}>Este mês</Text>
                    <Text style={styles.monthTitle}>Você avançou R$ 750</Text>
                  </View>
                </View>

                <View style={styles.challenge}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.challengeEyebrow}>Desafio do dia</Text>
                    <Text style={styles.challengeTitle}>{challengeDone ? "Desafio concluído!" : "Registrar um gasto do dia"}</Text>
                    <Text style={styles.challengeText}>{challengeDone ? "Boa. O controle começa nos pequenos registros." : "Registre pelo menos um gasto hoje para manter o controle."}</Text>
                  </View>
                  <Pressable onPress={() => setChallengeDone(true)} style={[styles.checkButton, challengeDone && styles.checkButtonDone]}>
                    <Ionicons name="checkmark" size={19} color={challengeDone ? "#fff" : OB.support} />
                  </Pressable>
                </View>

                <PrimaryButton title="Ir para o painel" onPress={goToPanel} style={{ marginTop: 4 }} />
              </ScrollView>
            </>
          ) : (
            <View style={styles.placeholder}>
              <Ionicons name={tab === "controle" ? "bar-chart-outline" : "trophy-outline"} size={42} color={OB.support} />
              <Text style={styles.placeholderTitle}>{tab === "controle" ? "Controle financeiro" : "Desafios em breve"}</Text>
              <Text style={styles.placeholderText}>{tab === "controle" ? "Seu painel completo aparece na próxima tela." : "Missões financeiras para manter sua jornada viva."}</Text>
            </View>
          )}
        </View>

        <View style={styles.nav}>
          <Pressable onPress={() => setMenuOpen(true)} style={styles.navItem}>
            <Ionicons name="menu-outline" size={23} color={OB.primary} />
            <Text style={[styles.navText, styles.navTextActive]}>Menu</Text>
          </Pressable>

          {[
            ["controle", "Controle", "bar-chart-outline"],
            ["jornada", "Jornada", "compass-outline"],
            ["desafios", "Desafios", "trophy-outline"],
          ].map(([id, label, icon]) => {
            const active = tab === id;
            return (
              <Pressable key={id} onPress={() => setTab(id as Tab)} style={styles.navItem}>
                <Ionicons name={icon as any} size={21} color={active ? OB.primary : OB.support} />
                <Text style={[styles.navText, active && styles.navTextActive]}>{label}</Text>
                {active ? <View style={styles.navIndicator} /> : null}
              </Pressable>
            );
          })}
        </View>
        <JourneyDrawer open={menuOpen} activeTab={tab} onClose={() => setMenuOpen(false)} onTab={setTab} onLogout={logout} />
      </View>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  content: {
    flex: 1,
  },
  hero: {
    height: 252,
    backgroundColor: OB.primary,
    overflow: "hidden",
  },
  badge: {
    position: "absolute",
    right: 18,
    top: 18,
    minHeight: 38,
    borderRadius: 99,
    paddingHorizontal: 14,
    flexDirection: "row",
    gap: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  badgeText: {
    color: OB.offWhite,
    fontSize: 13,
    fontWeight: "900",
  },
  heroTextBlock: {
    position: "absolute",
    left: 24,
    top: 30,
    maxWidth: 210,
  },
  heroEyebrow: {
    color: "#7BAFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2.2,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: OB.offWhite,
    fontSize: 27,
    fontWeight: "900",
    marginTop: 14,
    letterSpacing: 0,
  },
  heroSubtitle: {
    color: "rgba(220,235,255,0.86)",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 7,
  },
  scroll: {
    padding: 16,
    paddingTop: 8,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  sectionLink: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
  },
  goalCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    padding: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  goalBadge: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  goalInfo: {
    flex: 1,
  },
  goalTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  goalValue: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  smallTrack: {
    height: 5,
    borderRadius: 99,
    backgroundColor: OB.supportSoft,
    marginTop: 8,
    overflow: "hidden",
  },
  smallFill: {
    height: "100%",
    backgroundColor: OB.primary,
  },
  ring: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 5,
    borderColor: OB.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  ringText: {
    color: OB.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  monthCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    padding: 16,
    backgroundColor: OB.primary,
  },
  monthIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  monthEyebrow: {
    color: "rgba(123,160,200,0.85)",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  monthTitle: {
    color: OB.offWhite,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 3,
  },
  challenge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 20,
    padding: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  challengeEyebrow: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  challengeTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 6,
  },
  challengeText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 4,
  },
  checkButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  checkButtonDone: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  placeholderTitle: {
    color: OB.primary,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 14,
  },
  placeholderText: {
    color: OB.support,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
  nav: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    paddingBottom: 6,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingTop: 11,
    paddingBottom: 8,
  },
  navText: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
  },
  navTextActive: {
    color: OB.primary,
    fontWeight: "900",
  },
  navIndicator: {
    position: "absolute",
    bottom: 0,
    width: 28,
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: OB.primary,
  },
  drawerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30,
  },
  drawerScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6,21,46,0.58)",
  },
  drawerPanel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: "82%",
    maxWidth: 320,
    backgroundColor: OB.offWhite,
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 8, height: 0 },
    elevation: 35,
  },
  drawerHero: {
    minHeight: 198,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 20,
    backgroundColor: OB.primary,
    justifyContent: "flex-end",
  },
  drawerClose: {
    position: "absolute",
    top: 18,
    right: 16,
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  drawerAvatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    backgroundColor: OB.support,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.28)",
  },
  drawerAvatarText: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "900",
  },
  drawerTitle: {
    color: OB.offWhite,
    fontSize: 18,
    fontWeight: "900",
  },
  drawerSubtitle: {
    color: "rgba(160,200,235,0.86)",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  drawerList: {
    padding: 14,
    gap: 8,
    flex: 1,
  },
  drawerItem: {
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "transparent",
  },
  drawerItemActive: {
    backgroundColor: OB.primary,
  },
  drawerItemText: {
    flex: 1,
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  drawerItemTextActive: {
    color: "#fff",
  },
  drawerFooter: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  logoutButton: {
    minHeight: 52,
    borderRadius: 16,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FDE7E7",
    borderWidth: 1,
    borderColor: "#F5B9B9",
  },
  logoutText: {
    color: "#B94A4A",
    fontSize: 14,
    fontWeight: "900",
  },
});
