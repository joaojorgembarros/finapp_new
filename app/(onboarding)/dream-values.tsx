import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import {
  OB,
  OnboardingBackground,
  OnboardingShell,
  PrimaryButton,
  ScreenIntro,
} from "../../src/ui/OnboardingKit";
import { formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { useSession } from "../../src/providers/SessionProvider";
import { markNewOnboardingDone, saveNewOnboardingDraft } from "../../src/lib/newOnboarding";

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

function DreamValueCard({
  index,
  label,
  value,
  onChange,
  onFocus,
  onLayout,
}: {
  index: number;
  label: string;
  value: string;
  onChange: (text: string) => void;
  onFocus: () => void;
  onLayout: (y: number) => void;
}) {
  const cents = parseBRLToCents(value);
  const filled = cents > 0;

  return (
    <View
      onLayout={(event) => onLayout(event.nativeEvent.layout.y)}
      style={[styles.valueCard, filled && styles.valueCardFilled]}
    >
      <View style={styles.goalRow}>
        <View style={[styles.goalIcon, filled && styles.goalIconFilled]}>
          <Ionicons
            name={filled ? "checkmark" : "sparkles-outline"}
            size={18}
            color={filled ? "#fff" : OB.primary}
          />
        </View>
        <View style={styles.goalCopy}>
          <Text style={styles.goalMeta}>SONHO {index + 1}</Text>
          <Text style={styles.goalTitle}>{label}</Text>
        </View>
      </View>

      <Text style={styles.inputLabel}>Valor do objetivo</Text>
      <View style={[styles.inputBox, filled && styles.inputBoxFilled]}>
        <View style={styles.currencyBadge}>
          <Text style={styles.currency}>R$</Text>
        </View>
        <TextInput
          accessibilityLabel={`Valor do sonho ${label}`}
          value={value.replace("R$", "").trim()}
          onChangeText={(text) => onChange(formatBRLInputFromDigits(text))}
          placeholder="0,00"
          placeholderTextColor="#91A4BA"
          keyboardType="number-pad"
          returnKeyType="done"
          selectTextOnFocus
          onFocus={onFocus}
          onPressIn={onFocus}
          style={styles.input}
        />
      </View>

      {!filled ? (
        <View style={styles.helperRow}>
          <Ionicons name="information-circle-outline" size={14} color={OB.support} />
          <Text style={styles.helper}>Digite uma estimativa para este objetivo.</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function DreamValuesScreen() {
  const params = useLocalSearchParams<{
    dreams?: string;
    values?: string;
    returnToJourney?: string;
    maxDreams?: string;
    excludedDreams?: string;
  }>();
  const { userId } = useSession();
  const listRef = useRef<ScrollView>(null);
  const focusedIndex = useRef<number | null>(null);
  const cardY = useRef<Record<number, number>>({});
  const dreams = useMemo(() => readDreams(params.dreams), [params.dreams]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    readValues(params.values, dreams)
  );
  const [saving, setSaving] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const filled = Object.values(values).filter((value) => parseBRLToCents(value) > 0).length;
  const canContinue = dreams.length > 0 && filled > 0;
  const progress = Math.round((filled / Math.max(dreams.length, 1)) * 100);

  const scrollToDream = useCallback((index: number, delay = 60) => {
    const y = cardY.current[index];
    if (typeof y !== "number") return;

    setTimeout(() => {
      listRef.current?.scrollTo({ y: Math.max(y - 8, 0), animated: true });
    }, delay);
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardVisible(true);
      setKeyboardHeight(Platform.OS === "android" ? event.endCoordinates.height : 0);
      if (focusedIndex.current !== null) {
        scrollToDream(focusedIndex.current, 100);
      }
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
      focusedIndex.current = null;
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToDream]);

  function focusDream(index: number) {
    focusedIndex.current = index;
    scrollToDream(index, keyboardVisible ? 40 : 240);
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
      Alert.alert("Não foi possível concluir", error?.message ?? "Tente novamente em instantes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingShell>
      <OnboardingBackground />
      <KeyboardAvoidingView
        enabled={Platform.OS === "ios"}
        behavior="padding"
        style={styles.keyboard}
      >
        <ScreenIntro
          eyebrow="Valores dos sonhos"
          title="Quanto custa realizar seus sonhos?"
          subtitle="Defina o valor que você acredita precisar para conquistar cada objetivo."
          onBack={goBack}
          currentStep={2}
          totalSteps={params.returnToJourney === "1" ? 2 : 3}
          compact
        />

        <View style={styles.card}>
          <View style={styles.progressWrap}>
            <View style={styles.progressHeader}>
              <View>
                <Text style={styles.progressTitle}>Seu planejamento</Text>
                <Text style={styles.progressText}>
                  {filled} de {dreams.length} {dreams.length === 1 ? "valor definido" : "valores definidos"}
                </Text>
              </View>
              <View style={[styles.progressBadge, progress === 100 && styles.progressBadgeComplete]}>
                <Text style={[styles.progressPercent, progress === 100 && styles.progressPercentComplete]}>
                  {progress}%
                </Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  progress === 100 && styles.progressFillComplete,
                  { width: `${progress}%` },
                ]}
              />
            </View>
          </View>

          <ScrollView
            ref={listRef}
            style={styles.listScroll}
            contentContainerStyle={[
              styles.list,
              keyboardVisible && styles.listWithKeyboard,
              keyboardHeight
                ? { paddingBottom: keyboardHeight + 24 }
                : null,
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {dreams.map((dream, index) => (
              <DreamValueCard
                key={dream}
                index={index}
                label={dream}
                value={values[dream] ?? ""}
                onChange={(value) =>
                  setValues((previous) => ({ ...previous, [dream]: value }))
                }
                onFocus={() => focusDream(index)}
                onLayout={(y) => {
                  cardY.current[index] = y;
                }}
              />
            ))}
          </ScrollView>

          {!keyboardVisible ? (
            <View style={styles.footer}>
              <Text style={styles.footerHint}>
                {canContinue
                  ? params.returnToJourney === "1"
                    ? "Salve para voltar à sua jornada."
                    : "Próxima etapa: sua situação financeira."
                  : "Preencha pelo menos um valor para continuar."}
              </Text>
              <PrimaryButton
                title={
                  saving
                    ? "Salvando..."
                    : params.returnToJourney === "1"
                      ? "Salvar valores"
                      : "Continuar minha jornada"
                }
                disabled={!canContinue || saving}
                onPress={next}
              />
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    flex: 1,
  },
  card: {
    flex: 1,
    marginHorizontal: 12,
    marginBottom: 14,
    borderRadius: 28,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.88)",
    overflow: "hidden",
    shadowColor: OB.primary,
    shadowOpacity: 0.26,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -12 },
    elevation: 10,
  },
  progressWrap: {
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  },
  progressTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  progressText: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
  },
  progressBadge: {
    minWidth: 44,
    height: 32,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  progressBadgeComplete: {
    backgroundColor: "#E7F7EF",
    borderColor: "rgba(23,138,85,0.22)",
  },
  progressPercent: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  progressPercentComplete: {
    color: "#178A55",
  },
  progressTrack: {
    height: 6,
    borderRadius: 99,
    overflow: "hidden",
    backgroundColor: OB.supportSoft,
  },
  progressFill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: OB.primary,
  },
  progressFillComplete: {
    backgroundColor: "#22A96B",
  },
  listScroll: {
    flex: 1,
  },
  list: {
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  listWithKeyboard: {
    paddingBottom: 28,
  },
  valueCard: {
    borderRadius: 18,
    padding: 12,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "rgba(123,160,200,0.18)",
    shadowColor: OB.primary,
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  valueCardFilled: {
    borderColor: "rgba(23,138,85,0.24)",
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 9,
  },
  goalIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF1F8",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  goalIconFilled: {
    backgroundColor: "#22A96B",
    borderColor: "#22A96B",
  },
  goalCopy: {
    flex: 1,
  },
  goalMeta: {
    color: OB.support,
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.3,
    marginBottom: 3,
  },
  goalTitle: {
    color: OB.primary,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "900",
  },
  inputLabel: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  inputBox: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingRight: 14,
  },
  inputBoxFilled: {
    borderColor: "rgba(23,138,85,0.38)",
    backgroundColor: "#FBFEFC",
  },
  currencyBadge: {
    width: 36,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF1F8",
    marginRight: 9,
  },
  currency: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  input: {
    flex: 1,
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
    paddingVertical: 7,
  },
  helperRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 6,
  },
  helper: {
    flex: 1,
    color: OB.support,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
  },
  footer: {
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  footerHint: {
    color: OB.support,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    textAlign: "center",
  },
});
