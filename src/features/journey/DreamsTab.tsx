import React from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { formatBRLFromCents } from "../../lib/format";
import { GoalProgress } from "../../lib/goals";
import { OB } from "../../ui/OnboardingKit";
import { MountainHero } from "./MountainHero";
import { resolveDreamIconName } from "./dreamIconCatalog";
import {
  DREAMS_COPY,
  dreamAchievementsCountCopy,
  dreamConqueredDateCopy,
  dreamProgressLabel,
  dreamProgressPercent,
  dreamSavedCopy,
  dreamTargetCopy,
  isDreamCompleted,
} from "./dreamsPresentation";

type MenuIcon = keyof typeof Ionicons.glyphMap;

function dreamIcon(title: string): MenuIcon {
  return resolveDreamIconName(title) as MenuIcon;
}

function DreamCard({
  goal,
  compact,
  onOpen,
}: {
  goal: GoalProgress;
  compact: boolean;
  onOpen: () => void;
}) {
  const progress = dreamProgressPercent(goal.contributed_cents, goal.target_cents);
  const completed = isDreamCompleted(goal.contributed_cents, goal.target_cents);
  const icon = completed ? "checkmark" : dreamIcon(goal.title);
  const percent = dreamProgressLabel(progress);

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Abrir sonho ${goal.title}`}
      style={({ pressed }) => [styles.card, completed && styles.cardCompleted, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        {goal.cover_photo_url ? (
          <View style={[styles.photoWrap, completed && styles.photoWrapCompleted]}>
            <Image source={{ uri: goal.cover_photo_url }} style={styles.photo} resizeMode="cover" />
          </View>
        ) : (
          <View style={[styles.iconWrap, completed && styles.iconWrapCompleted]}>
            <Ionicons name={icon} size={20} color={completed ? "#169B62" : OB.primary} />
          </View>
        )}
        <View style={styles.cardCopy}>
          <Text style={[styles.goalTitle, compact && styles.goalTitleCompact]} numberOfLines={2}>
            {goal.title}
          </Text>
          {completed ? (
            <>
              <Text style={styles.conqueredLabel}>{DREAMS_COPY.conqueredLabel}</Text>
              <Text style={styles.conqueredMeta} numberOfLines={2}>
                {goal.completed_on ? dreamConqueredDateCopy(goal.completed_on) : dreamSavedCopy(goal.contributed_cents)}
              </Text>
            </>
          ) : (
            <>
              <Text
                style={[styles.savedValue, compact && styles.savedValueCompact]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
              >
                {dreamSavedCopy(goal.contributed_cents)}
              </Text>
              <Text
                style={styles.targetValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
              >
                {dreamTargetCopy(goal.target_cents)}
              </Text>
            </>
          )}
        </View>
        <View style={[styles.percentBadge, completed && styles.percentBadgeCompleted]}>
          <Text style={[styles.percentText, completed && styles.percentTextCompleted]}>{percent}</Text>
        </View>
      </View>

      <View
        style={[styles.track, completed && styles.trackCompleted]}
        accessibilityLabel={`Progresso ${percent}`}
      >
        <View style={[styles.fill, completed && styles.fillCompleted, { width: `${progress}%` }]} />
      </View>

      <View style={styles.actions}>
        {completed ? (
          <Text style={styles.detailsHint}>{DREAMS_COPY.detailsAction}</Text>
        ) : (
          <>
            <Pressable
              onPress={onOpen}
              accessibilityRole="button"
              accessibilityLabel={`${DREAMS_COPY.saveAction} em ${goal.title}`}
              style={({ pressed }) => [styles.saveButton, pressed && styles.saveButtonPressed]}
            >
              <Ionicons name="wallet-outline" size={16} color="#fff" />
              <Text style={styles.saveButtonText}>{DREAMS_COPY.saveAction}</Text>
            </Pressable>
            <Text style={styles.detailsHint}>{DREAMS_COPY.detailsAction}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

export function DreamsTab({
  goals,
  activeGoals,
  completedGoals,
  monthTotal,
  journeyProgress,
  loading,
  achievementsOpen,
  onToggleAchievements,
  onOpenGoal,
  onCreateFirstDream,
  onAddDream,
  canAddDream,
  footer,
}: {
  goals: GoalProgress[];
  activeGoals: GoalProgress[];
  completedGoals: GoalProgress[];
  monthTotal: number;
  journeyProgress: number;
  loading: boolean;
  achievementsOpen: boolean;
  onToggleAchievements: () => void;
  onOpenGoal: (goal: GoalProgress) => void;
  onCreateFirstDream: () => void;
  onAddDream: () => void;
  canAddDream: boolean;
  footer?: React.ReactNode;
}) {
  const compact = useWindowDimensions().width < 360;
  const empty = !loading && goals.length === 0;
  const allCompleted = !loading && goals.length > 0 && activeGoals.length === 0;

  return (
    <View style={styles.root}>
      <MountainHero progress={journeyProgress} showProgress={goals.length > 0} />
      <ScrollView contentContainerStyle={[styles.scroll, compact && styles.scrollCompact]} showsVerticalScrollIndicator={false}>
        {activeGoals.length || loading ? (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{DREAMS_COPY.inProgressTitle}</Text>
            {loading ? <ActivityIndicator size="small" color={OB.primary} /> : null}
          </View>
        ) : null}

        {activeGoals.length ? (
          activeGoals.map((goal) => (
            <DreamCard key={goal.id} goal={goal} compact={compact} onOpen={() => onOpenGoal(goal)} />
          ))
        ) : empty ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Ionicons name="sparkles-outline" size={26} color={OB.primary} />
            </View>
            <Text style={styles.emptyTitle}>{DREAMS_COPY.emptyTitle}</Text>
            <Text style={styles.emptyText}>{DREAMS_COPY.emptyText}</Text>
            <Pressable
              onPress={onCreateFirstDream}
              accessibilityRole="button"
              accessibilityLabel={DREAMS_COPY.emptyAction}
              style={({ pressed }) => [styles.emptyButton, pressed && styles.saveButtonPressed]}
            >
              <Text style={styles.emptyButtonText}>{DREAMS_COPY.emptyAction}</Text>
            </Pressable>
          </View>
        ) : allCompleted ? (
          <Text style={styles.allCompleted}>{DREAMS_COPY.allCompleted}</Text>
        ) : null}

        {!loading && canAddDream && goals.length > 0 ? (
          <Pressable
            onPress={onAddDream}
            accessibilityRole="button"
            accessibilityLabel={DREAMS_COPY.addDreamAction}
            style={({ pressed }) => [styles.addCard, pressed && styles.cardPressed]}
          >
            <View style={styles.addIcon}>
              <Ionicons name="add" size={18} color={OB.primary} />
            </View>
            <Text style={styles.addText}>{DREAMS_COPY.addDreamAction}</Text>
            <Ionicons name="chevron-forward" size={17} color={OB.support} />
          </Pressable>
        ) : null}

        <View style={styles.monthCard}>
          <View style={styles.monthIcon}>
            <Ionicons name="calendar-outline" size={18} color={OB.primary} />
          </View>
          <View style={styles.monthCopy}>
            <Text style={styles.monthEyebrow}>{DREAMS_COPY.monthEyebrow}</Text>
            <Text
              style={styles.monthValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              {formatBRLFromCents(monthTotal)}
            </Text>
          </View>
        </View>

        {footer}

        {completedGoals.length ? (
          <View style={styles.achievements}>
            <Pressable
              onPress={onToggleAchievements}
              accessibilityRole="button"
              accessibilityLabel={DREAMS_COPY.achievementsTitle}
              style={styles.achievementsHeader}
            >
              <View style={styles.achievementsTitleRow}>
                <View style={styles.achievementsIcon}>
                  <Ionicons name="trophy" size={17} color="#169B62" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.achievementsTitle}>{DREAMS_COPY.achievementsTitle}</Text>
                  <Text style={styles.achievementsCount}>{dreamAchievementsCountCopy(completedGoals.length)}</Text>
                </View>
              </View>
              <Ionicons name={achievementsOpen ? "chevron-up" : "chevron-down"} size={19} color={OB.support} />
            </Pressable>
            {achievementsOpen ? (
              <View style={styles.achievementsList}>
                {completedGoals.map((goal) => (
                  <DreamCard key={goal.id} goal={goal} compact={compact} onOpen={() => onOpenGoal(goal)} />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OB.offWhite,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 12,
  },
  scrollCompact: {
    paddingHorizontal: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  cardCompleted: {
    borderColor: "rgba(22,155,98,0.26)",
    backgroundColor: "#FBFFFD",
  },
  cardPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  iconWrap: {
    width: 52,
    height: 52,
    aspectRatio: 1,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    overflow: "hidden",
    flexShrink: 0,
  },
  iconWrapCompleted: {
    backgroundColor: "#E5F7EE",
  },
  photoWrap: {
    width: 52,
    height: 52,
    aspectRatio: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: OB.offWhite,
    flexShrink: 0,
  },
  photoWrapCompleted: {
    borderWidth: 1,
    borderColor: "rgba(22,155,98,0.34)",
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  cardCopy: {
    flex: 1,
    minWidth: 0,
  },
  goalTitle: {
    color: OB.primary,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "900",
  },
  goalTitleCompact: {
    fontSize: 15,
    lineHeight: 20,
  },
  savedValue: {
    color: OB.primary,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "800",
    marginTop: 6,
  },
  savedValueCompact: {
    fontSize: 13,
  },
  targetValue: {
    color: "#5E7591",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
    marginTop: 2,
  },
  conqueredLabel: {
    color: "#169B62",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
  },
  conqueredMeta: {
    color: "#5E7591",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  percentBadge: {
    minWidth: 46,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  percentBadgeCompleted: {
    backgroundColor: "#E5F7EE",
  },
  percentText: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  percentTextCompleted: {
    color: "#169B62",
  },
  track: {
    height: 8,
    borderRadius: 99,
    backgroundColor: OB.supportSoft,
    overflow: "hidden",
  },
  trackCompleted: {
    backgroundColor: "rgba(22,155,98,0.14)",
  },
  fill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: OB.primary,
  },
  fillCompleted: {
    backgroundColor: "#22A96B",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  saveButton: {
    minHeight: 40,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: OB.primary,
  },
  saveButtonPressed: {
    opacity: 0.86,
  },
  saveButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
  },
  detailsHint: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
  },
  emptyCard: {
    borderRadius: 22,
    padding: 22,
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
    gap: 8,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    marginBottom: 4,
  },
  emptyTitle: {
    color: OB.primary,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyText: {
    color: "#5E7591",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
    maxWidth: 280,
  },
  emptyButton: {
    minHeight: 46,
    marginTop: 8,
    borderRadius: 16,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  emptyButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  allCompleted: {
    color: "#5E7591",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    paddingHorizontal: 2,
  },
  addCard: {
    minHeight: 52,
    borderRadius: 17,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: OB.support,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 13,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  addIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.14)",
  },
  addText: {
    flex: 1,
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  monthCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  monthIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  monthCopy: {
    flex: 1,
    minWidth: 0,
  },
  monthEyebrow: {
    color: "#5E7591",
    fontSize: 11,
    fontWeight: "800",
  },
  monthValue: {
    color: OB.primary,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  achievements: {
    gap: 10,
    marginTop: 4,
  },
  achievementsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 2,
    gap: 10,
  },
  achievementsTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  achievementsIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5F7EE",
  },
  achievementsTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  achievementsCount: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  achievementsList: {
    gap: 10,
  },
});
