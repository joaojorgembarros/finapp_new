import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as NavigationBar from "expo-navigation-bar";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { DREAM_ICON_NAMES, resolveDreamIconKind } from "../../src/features/journey/dreamIconCatalog";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { formatBRLInputFromDigits } from "../../src/lib/format";
import { hasAllPositiveDreamValues } from "../../src/lib/onboardingDreamValues";
import { markNewOnboardingDone, saveNewOnboardingDraft } from "../../src/lib/newOnboarding";
import { discardInvalidAuthSession, isMissingAuthUserError } from "../../src/lib/sessionValidity";
import { supabase } from "../../src/lib/supabase";
import { useSession } from "../../src/providers/SessionProvider";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";

const BRAND_SYMBOL = require("../../assets/splash-brand-symbol.png");

function readDreams(raw: string | string[] | undefined) {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function readValues(raw: string | string[] | undefined, dreams: string[]) {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? JSON.parse(value) : {};
    return Object.fromEntries(
      dreams.map((dream) => [
        dream,
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? String(parsed[dream] ?? "")
          : "",
      ])
    );
  } catch {
    return Object.fromEntries(dreams.map((dream) => [dream, ""]));
  }
}

function DreamValuesBackground() {
  return <View pointerEvents="none" style={styles.background} />;
}

function DreamValueCard({
  active,
  index,
  label,
  value,
  onChange,
  onFocus,
  onLayout,
  inputRef,
  textInputRef,
}: {
  active: boolean;
  index: number;
  label: string;
  value: string;
  onChange: (text: string) => void;
  onFocus: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  inputRef: (node: View | null) => void;
  textInputRef: (node: TextInput | null) => void;
}) {
  const displayValue = value.replace("R$", "").trim();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Editar valor do sonho ${label}`}
      onPress={onFocus}
      onLayout={onLayout}
      style={[
        styles.valueCard,
        index % 2 === 1 && styles.valueCardOffset,
        active && styles.valueCardActive,
      ]}
    >
      <View ref={inputRef} collapsable={false} style={styles.cardBody}>
        <View style={styles.goalMark}>
          <Ionicons
            name={DREAM_ICON_NAMES[resolveDreamIconKind(label)] as keyof typeof Ionicons.glyphMap}
            size={18}
            color={active ? "#F4F7FF" : "#AFC7E8"}
          />
        </View>

        <View style={styles.goalCopy}>
          <Text numberOfLines={2} style={styles.goalTitle}>
            {label}
          </Text>
          <Text style={styles.inputLabel}>Valor estimado</Text>
          <View style={styles.valueRow}>
            <Text style={[styles.currency, !displayValue && styles.currencyMuted]}>R$</Text>
            <TextInput
              ref={textInputRef}
              accessibilityLabel={`Valor do sonho ${label}`}
              value={displayValue}
              onChangeText={(text) => onChange(formatBRLInputFromDigits(text))}
              placeholder="0"
              placeholderTextColor="#8C9AAE"
              keyboardType="number-pad"
              returnKeyType="done"
              selectTextOnFocus
              onFocus={onFocus}
              onPressIn={onFocus}
              style={styles.input}
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Editar ${label}`}
          hitSlop={6}
          onPress={onFocus}
          style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
        >
          <Ionicons name="pencil-outline" size={15} color={active ? "#F4F7FF" : "#AFC7E8"} />
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function DreamValuesScreen() {
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const params = useLocalSearchParams<{
    dreams?: string;
    values?: string;
    returnToJourney?: string;
    maxDreams?: string;
    excludedDreams?: string;
  }>();
  const { userId } = useSession();
  const {
    scrollRef: listRef,
    keyboardVisible,
    keyboardInset,
    registerField,
    registerFieldNode,
    focusField,
    cancelPendingScroll,
    handleScroll,
    handleContentSizeChange,
  } = useKeyboardAwareScroll<string>(8, {
    ensureFieldRunway: true,
    keyboardClearance: 64,
  });
  const dreams = useMemo(() => readDreams(params.dreams), [params.dreams]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    readValues(params.values, dreams)
  );
  const [saving, setSaving] = useState(false);
  const [activeDream, setActiveDream] = useState<string | null>(dreams[0] ?? null);
  const textInputRefs = useRef<Record<string, TextInput | null>>({});
  const totalSteps = params.returnToJourney === "1" ? 2 : 3;

  const canContinue = hasAllPositiveDreamValues(dreams, values);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setBackgroundColorAsync(OB.primaryDeep).catch(() => {});
    NavigationBar.setButtonStyleAsync("light").catch(() => {});
    return () => {
      NavigationBar.setBackgroundColorAsync("#f8fafc").catch(() => {});
      NavigationBar.setButtonStyleAsync("dark").catch(() => {});
    };
  }, []);

  function focusDream(dream: string, index: number) {
    setActiveDream(dream);
    focusField(String(index));
    requestAnimationFrame(() => {
      textInputRefs.current[dream]?.focus();
    });
  }

  function goBack() {
    router.replace({
      pathname: "/(onboarding)/dreams",
      params: {
        selectedDreams: JSON.stringify(dreams),
        returnToJourney: params.returnToJourney ?? "0",
        maxDreams: params.maxDreams,
        excludedDreams: params.excludedDreams,
      },
    });
  }

  async function next() {
    if (saving) return;
    if (!userId) {
      Alert.alert("Sessão expirada", "Entre novamente para continuar.");
      return;
    }

    try {
      setSaving(true);
      if (params.returnToJourney === "1") {
        await markNewOnboardingDone(userId, dreams, values);
        router.replace({
          pathname: "/(app)/journey",
          params: {
            dreams: JSON.stringify(dreams),
            values: JSON.stringify(values),
          },
        });
      } else {
        await saveNewOnboardingDraft(dreams, values);
        router.push({
          pathname: "/(onboarding)/financial-situation",
          params: {
            dreams: JSON.stringify(dreams),
            values: JSON.stringify(values),
          },
        });
      }
    } catch (error: any) {
      if (isMissingAuthUserError(error)) {
        await discardInvalidAuthSession(supabase.auth);
        return;
      }
      Alert.alert("Não foi possível concluir", error?.message ?? "Tente novamente em instantes.");
    } finally {
      setSaving(false);
    }
  }

  const continueTitle = saving
    ? "Salvando..."
    : params.returnToJourney === "1"
      ? "Salvar valores"
      : "Continuar";

  return (
    <OnboardingShell>
      <StatusBar style="light" backgroundColor={OB.primaryDeep} translucent={false} />
      <DreamValuesBackground />
      <KeyboardAvoidingView
        enabled={Platform.OS === "ios"}
        behavior="padding"
        style={styles.keyboard}
      >
        <View style={styles.frame}>
          <View style={[styles.topSection, compact && styles.topSectionCompact]}>
            <View style={styles.navigationRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Voltar"
                hitSlop={6}
                onPress={goBack}
                style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              >
                <Ionicons name="arrow-back" size={27} color="#FFFFFF" />
              </Pressable>
              <Image
                accessible={false}
                resizeMode="contain"
                source={BRAND_SYMBOL}
                style={styles.brandSymbol}
                tintColor="#FFFFFF"
              />
            </View>

            <View
              accessibilityRole="text"
              accessibilityLabel={`Etapa 2 de ${totalSteps}`}
              style={styles.progressBlock}
            >
              <Text style={styles.stepText}>2 de {totalSteps}</Text>
              <View style={styles.progressTrack}>
                {Array.from({ length: totalSteps }, (_, index) => (
                  <View
                    key={index}
                    style={[styles.progressSegment, index < 2 && styles.progressSegmentActive]}
                  />
                ))}
              </View>
            </View>
          </View>

          <ScrollView
            ref={listRef}
            style={styles.listScroll}
            contentContainerStyle={[
              styles.list,
              compact && styles.listCompact,
              keyboardVisible && styles.listWithKeyboard,
              keyboardInset ? { paddingBottom: 28 + keyboardInset } : null,
            ]}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            onScrollBeginDrag={cancelPendingScroll}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            onContentSizeChange={handleContentSizeChange}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.intro, compact && styles.introCompact]}>
              <Text accessibilityRole="header" style={[styles.title, compact && styles.titleCompact]}>
                Agora, dê um número{"\n"}aos seus sonhos.
              </Text>
              <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>
                Uma estimativa já é suficiente para começar.
              </Text>
            </View>

            <View style={styles.cardList}>
              {dreams.map((dream, index) => (
                <DreamValueCard
                  key={dream}
                  active={activeDream === dream}
                  index={index}
                  label={dream}
                  value={values[dream] ?? ""}
                  onChange={(value) =>
                    setValues((previous) => ({ ...previous, [dream]: value }))
                  }
                  onFocus={() => focusDream(dream, index)}
                  onLayout={registerField(String(index))}
                  inputRef={registerFieldNode(String(index))}
                  textInputRef={(node) => {
                    textInputRefs.current[dream] = node;
                  }}
                />
              ))}
            </View>
          </ScrollView>

          {!keyboardVisible ? (
            <View style={styles.footer}>
              <Text style={styles.footerHint}>Você poderá ajustar esses valores depois.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={continueTitle}
                accessibilityState={{ disabled: !canContinue || saving }}
                disabled={!canContinue || saving}
                onPress={next}
                style={({ pressed }) => [
                  styles.continueButton,
                  (!canContinue || saving) && styles.continueButtonDisabled,
                  pressed && canContinue && !saving ? styles.continueButtonPressed : null,
                ]}
              >
                <Text
                  style={[
                    styles.continueText,
                    (!canContinue || saving) && styles.continueTextDisabled,
                  ]}
                >
                  {continueTitle}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#06152E",
  },
  keyboard: {
    flex: 1,
  },
  frame: {
    flex: 1,
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
  },
  topSection: {
    paddingHorizontal: 22,
    paddingTop: 6,
    paddingBottom: 5,
  },
  topSectionCompact: {
    paddingTop: 2,
  },
  navigationRow: {
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    position: "absolute",
    left: -7,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonPressed: {
    opacity: 0.7,
  },
  brandSymbol: {
    width: 46,
    height: 52,
  },
  progressBlock: {
    alignItems: "center",
    paddingTop: 8,
  },
  stepText: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "500",
  },
  progressTrack: {
    width: "74%",
    maxWidth: 284,
    flexDirection: "row",
    gap: 7,
    marginTop: 13,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 99,
    backgroundColor: "rgba(140,154,174,0.20)",
  },
  progressSegmentActive: {
    backgroundColor: "#FFFFFF",
  },
  listScroll: {
    flex: 1,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
  },
  listCompact: {
    paddingTop: 16,
  },
  listWithKeyboard: {
    paddingBottom: 28,
  },
  intro: {
    alignItems: "center",
    marginBottom: 28,
  },
  introCompact: {
    marginBottom: 20,
  },
  title: {
    maxWidth: 320,
    color: "#FFFFFF",
    fontSize: 31,
    lineHeight: 37,
    fontWeight: "800",
    letterSpacing: -0.7,
    textAlign: "center",
  },
  titleCompact: {
    fontSize: 27,
    lineHeight: 32,
  },
  subtitle: {
    maxWidth: 306,
    marginTop: 12,
    color: "#8C9AAE",
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "500",
    textAlign: "center",
  },
  subtitleCompact: {
    marginTop: 9,
    fontSize: 14,
    lineHeight: 20,
  },
  cardList: {
    gap: 16,
    paddingTop: 4,
  },
  valueCard: {
    width: "100%",
    minHeight: 108,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(175,199,232,0.16)",
    backgroundColor: "#0B1F42",
    paddingVertical: 16,
    paddingLeft: 16,
    paddingRight: 12,
    shadowColor: "#020817",
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  valueCardOffset: {
    alignSelf: "center",
  },
  valueCardActive: {
    borderColor: "rgba(175,199,232,0.38)",
    backgroundColor: "#10264D",
    shadowColor: "#020817",
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  cardBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  goalMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(175,199,232,0.18)",
  },
  goalCopy: {
    flex: 1,
    minWidth: 0,
  },
  goalTitle: {
    color: "#F4F7FF",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  inputLabel: {
    marginTop: 8,
    color: "#8C9AAE",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
  },
  valueRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 36,
  },
  currency: {
    color: "#FFFFFF",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    letterSpacing: -0.4,
    marginRight: 6,
  },
  currencyMuted: {
    color: "#8C9AAE",
  },
  input: {
    flex: 1,
    color: "#FFFFFF",
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "700",
    letterSpacing: -0.4,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  editButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(175,199,232,0.14)",
    alignSelf: "flex-start",
    marginTop: 2,
  },
  editButtonPressed: {
    opacity: 0.7,
  },
  footer: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 10,
  },
  footerHint: {
    marginBottom: 12,
    color: "#8C9AAE",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "500",
    textAlign: "center",
  },
  continueButton: {
    minHeight: 56,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  continueButtonDisabled: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  continueButtonPressed: {
    opacity: 0.86,
  },
  continueText: {
    color: "#06152E",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "800",
  },
  continueTextDisabled: {
    color: "rgba(255,255,255,0.42)",
  },
});
