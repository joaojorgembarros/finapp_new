import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as NavigationBar from "expo-navigation-bar";
import { router, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { resolveDreamIconKind } from "../../src/features/journey/dreamIconCatalog";
import { useKeyboardAwareScroll } from "../../src/hooks/useKeyboardAwareScroll";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";

type Dream = { label: string; size: "sm" | "md" | "lg" };

const DREAMS: Dream[] = [
  { label: "Quitar dívidas", size: "lg" },
  { label: "Reserva de emergência", size: "lg" },
  { label: "Comprar um carro", size: "md" },
  { label: "Comprar uma moto", size: "sm" },
  { label: "Abrir um negócio", size: "md" },
  { label: "Investir mais", size: "sm" },
  { label: "Reformar a casa", size: "md" },
  { label: "Mudar de cidade", size: "sm" },
  { label: "Fazer faculdade", size: "md" },
  { label: "Viajar", size: "sm" },
  { label: "Liberdade financeira", size: "lg" },
  { label: "Casar", size: "sm" },
  { label: "Ter filhos", size: "sm" },
  { label: "Estudar fora", size: "md" },
];

const PRESELECTED: string[] = [];
const MAX_DREAMS = 3;
const BRAND_SYMBOL = require("../../assets/splash-brand-symbol.png");

const DREAM_MARK_ICONS = {
  emergency: "shield-checkmark-outline",
  home: "home-outline",
  travel: "airplane-outline",
  car: "car-outline",
  motorcycle: "bicycle-outline",
  wedding: "heart-outline",
  education: "school-outline",
  business: "briefcase-outline",
  health: "medkit-outline",
  retirement: "time-outline",
  debt: "card-outline",
  investment: "trending-up-outline",
  family: "people-outline",
  relocation: "location-outline",
  freedom: "lock-open-outline",
  other: "flag-outline",
} as const;

function readSelectedDreams(raw: string | string[] | undefined) {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? JSON.parse(value) : PRESELECTED;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : PRESELECTED;
  } catch {
    return PRESELECTED;
  }
}

function DreamsBackground() {
  return (
    <View pointerEvents="none" style={styles.background}>
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 390 844"
        preserveAspectRatio="xMidYMid slice"
        style={StyleSheet.absoluteFill}
      >
        <Path
          d="M-28 786C66 752 160 809 253 770C309 747 341 719 418 701"
          fill="none"
          stroke="#7BA0C8"
          strokeOpacity={0.22}
          strokeWidth={1.1}
        />
        <Path
          d="M-18 817C72 789 166 835 258 796C316 771 350 749 416 742"
          fill="none"
          stroke="#7BA0C8"
          strokeOpacity={0.1}
          strokeWidth={0.8}
        />
        <Circle cx="335" cy="735" r="1.7" fill="#FFFFFF" opacity={0.34} />
        <Circle cx="349" cy="728" r="0.9" fill="#FFFFFF" opacity={0.22} />
        <Circle cx="62" cy="776" r="1" fill="#FFFFFF" opacity={0.16} />
      </Svg>
    </View>
  );
}

function DreamChoice({ dream, onPress }: { dream: Dream; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Selecionar ${dream.label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, pressed && styles.choicePressed]}
    >
      <Ionicons name="add" size={15} color="#AFC7E8" />
      <Text style={styles.choiceText}>{dream.label}</Text>
    </Pressable>
  );
}

function SelectedDreamCard({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={styles.dreamCard}>
      <View style={styles.dreamMark}>
        <Ionicons
          name={DREAM_MARK_ICONS[resolveDreamIconKind(label)]}
          size={20}
          color="#BCD0EE"
        />
      </View>
      <View style={styles.dreamCopy}>
        <Text numberOfLines={2} style={styles.dreamTitle}>
          {label}
        </Text>
        <View style={styles.valuePill}>
          <Text style={styles.valueText}>Valor estimado · próxima etapa</Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remover sonho ${label}`}
        hitSlop={6}
        onPress={onRemove}
        style={({ pressed }) => [styles.removeButton, pressed && styles.removeButtonPressed]}
      >
        <Ionicons name="close" size={20} color="#C2CBD9" />
      </Pressable>
    </View>
  );
}

export default function DreamsScreen() {
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const params = useLocalSearchParams<{
    maxDreams?: string;
    returnToJourney?: string;
    excludedDreams?: string;
    selectedDreams?: string;
  }>();
  const maxDreams = Math.max(1, Math.min(MAX_DREAMS, Number(params.maxDreams) || MAX_DREAMS));
  const totalSteps = params.returnToJourney === "1" ? 2 : 3;
  const initialDreams = useMemo(
    () => readSelectedDreams(params.selectedDreams).slice(0, maxDreams),
    [maxDreams, params.selectedDreams]
  );
  const excludedDreams = useMemo(() => {
    try {
      const parsed = params.excludedDreams ? JSON.parse(params.excludedDreams) : [];
      return new Set(
        Array.isArray(parsed)
          ? parsed.map((item) => String(item).trim().toLocaleLowerCase("pt-BR"))
          : []
      );
    } catch {
      return new Set<string>();
    }
  }, [params.excludedDreams]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialDreams));
  const [extras, setExtras] = useState<Dream[]>(() =>
    initialDreams
      .filter(
        (label) =>
          !DREAMS.some(
            (dream) =>
              dream.label.trim().toLocaleLowerCase("pt-BR") ===
              label.trim().toLocaleLowerCase("pt-BR")
          )
      )
      .map((label) => ({ label, size: "md" }))
  );
  const [modal, setModal] = useState(false);
  const [custom, setCustom] = useState("");
  const customInputRef = useRef<TextInput>(null);
  const modalKeyboard = useKeyboardAwareScroll<"custom">(12, { ensureFieldRunway: true });

  useEffect(() => {
    if (Platform.OS !== "android") return;
    NavigationBar.setBackgroundColorAsync(OB.primaryDeep).catch(() => {});
    NavigationBar.setButtonStyleAsync("light").catch(() => {});
    return () => {
      NavigationBar.setBackgroundColorAsync("#f8fafc").catch(() => {});
      NavigationBar.setButtonStyleAsync("dark").catch(() => {});
    };
  }, []);

  const allDreams = useMemo(
    () =>
      [...DREAMS, ...extras].filter(
        (dream) => !excludedDreams.has(dream.label.trim().toLocaleLowerCase("pt-BR"))
      ),
    [excludedDreams, extras]
  );
  const selectedDreams = useMemo(
    () =>
      [...selected].map(
        (label) => allDreams.find((dream) => dream.label === label) ?? { label, size: "md" }
      ),
    [allDreams, selected]
  );
  const availableDreams = useMemo(
    () => allDreams.filter((dream) => !selected.has(dream.label)),
    [allDreams, selected]
  );
  const count = selected.size;

  function closeCustomModal() {
    modalKeyboard.cancelPendingScroll();
    Keyboard.dismiss();
    setModal(false);
  }

  function toggle(label: string) {
    if (!selected.has(label) && count >= maxDreams) {
      Alert.alert(
        "Limite de sonhos",
        `Escolha até ${maxDreams} ${maxDreams === 1 ? "sonho" : "sonhos"} para completar suas vagas atuais.`
      );
      return;
    }

    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function addCustom() {
    const label = custom.trim();
    if (!label) return;
    if (!selected.has(label) && count >= maxDreams) {
      Alert.alert("Limite de sonhos", "Remova um sonho antes de cadastrar outro.");
      return;
    }

    if (!allDreams.some((dream) => dream.label.toLowerCase() === label.toLowerCase())) {
      setExtras((previous) => [...previous, { label, size: "md" }]);
    }
    setSelected((previous) => new Set([...previous, label]));
    setCustom("");
    closeCustomModal();
  }

  function openCustomModal() {
    if (count >= maxDreams) {
      Alert.alert(
        "Limite de sonhos",
        `Você já preencheu ${maxDreams === 1 ? "a vaga disponível" : "as vagas disponíveis"}.`
      );
      return;
    }
    setModal(true);
  }

  function next() {
    if (!count) {
      Alert.alert("Escolha um sonho", "Selecione pelo menos um objetivo para continuar.");
      return;
    }

    router.push({
      pathname: "/(onboarding)/dream-values",
      params: {
        dreams: JSON.stringify([...selected]),
        returnToJourney: params.returnToJourney ?? "0",
        maxDreams: params.maxDreams,
        excludedDreams: params.excludedDreams,
      },
    });
  }

  const capacityCopy = maxDreams === MAX_DREAMS
    ? "Você pode adicionar até 3 sonhos."
    : `Você pode adicionar até ${maxDreams} ${maxDreams === 1 ? "sonho" : "sonhos"} nesta etapa.`;

  return (
    <OnboardingShell>
      <StatusBar style="light" backgroundColor={OB.primaryDeep} translucent={false} />
      <DreamsBackground />
      <View style={styles.frame}>
        <View style={[styles.topSection, compact && styles.topSectionCompact]}>
          <View style={styles.navigationRow}>
            {params.returnToJourney === "1" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Voltar"
                hitSlop={6}
                onPress={() => router.back()}
                style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
              >
                <Ionicons name="arrow-back" size={27} color="#FFFFFF" />
              </Pressable>
            ) : null}
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
            accessibilityLabel={`Etapa 1 de ${totalSteps}`}
            style={styles.progressBlock}
          >
            <Text style={styles.stepText}>1 de {totalSteps}</Text>
            <View style={styles.progressTrack}>
              {Array.from({ length: totalSteps }, (_, index) => (
                <View
                  key={index}
                  style={[styles.progressSegment, index === 0 && styles.progressSegmentActive]}
                />
              ))}
            </View>
          </View>
        </View>

        <ScrollView
          bounces={false}
          contentContainerStyle={[styles.content, compact && styles.contentCompact]}
          showsVerticalScrollIndicator={false}
          style={styles.contentScroll}
        >
          <View style={[styles.intro, compact && styles.introCompact]}>
            <Text accessibilityRole="header" style={[styles.title, compact && styles.titleCompact]}>
              Quais sonhos{"\n"}você quer{"\n"}conquistar?
            </Text>
            <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>
              Escolha até {maxDreams} {maxDreams === 1 ? "sonho" : "sonhos"} para começar sua jornada.
            </Text>
          </View>

          {selectedDreams.length ? (
            <View accessibilityLabel="Sonhos selecionados" style={styles.selectedList}>
              {selectedDreams.map((dream) => (
                <SelectedDreamCard
                  key={dream.label}
                  label={dream.label}
                  onRemove={() => toggle(dream.label)}
                />
              ))}
            </View>
          ) : null}

          {count < maxDreams && availableDreams.length ? (
            <View style={[styles.suggestions, selectedDreams.length ? styles.suggestionsAfterList : null]}>
              <Text style={styles.suggestionsLabel}>
                {count ? "Escolha mais um sonho" : "Comece por uma sugestão"}
              </Text>
              <ScrollView
                horizontal
                contentContainerStyle={styles.choices}
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
                style={styles.choicesScroll}
              >
                {availableDreams.map((dream) => (
                  <DreamChoice key={dream.label} dream={dream} onPress={() => toggle(dream.label)} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Adicionar sonho personalizado"
            onPress={openCustomModal}
            style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
          >
            <Ionicons name="add" size={24} color="#9ABBE8" />
            <Text style={styles.addText}>Adicionar sonho</Text>
          </Pressable>
          <Text style={styles.capacityText}>{capacityCopy}</Text>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continuar"
            accessibilityState={{ disabled: !count }}
            disabled={!count}
            onPress={next}
            style={({ pressed }) => [
              styles.continueButton,
              !count && styles.continueButtonDisabled,
              pressed && count ? styles.continueButtonPressed : null,
            ]}
          >
            <Text style={[styles.continueText, !count && styles.continueTextDisabled]}>Continuar</Text>
          </Pressable>
        </View>
      </View>

      <Modal
        visible={modal}
        transparent
        animationType="fade"
        onRequestClose={closeCustomModal}
        onShow={() => {
          requestAnimationFrame(() => customInputRef.current?.focus());
        }}
      >
        <KeyboardAvoidingView
          enabled={Platform.OS === "ios"}
          behavior="padding"
          style={styles.modalOverlay}
        >
          <BlurView
            intensity={34}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <ScrollView
            ref={modalKeyboard.scrollRef}
            style={styles.modalScroll}
            contentContainerStyle={[
              styles.modalScrollContent,
              modalKeyboard.keyboardInset
                ? { paddingBottom: 20 + modalKeyboard.keyboardInset }
                : null,
            ]}
            keyboardDismissMode="none"
            keyboardShouldPersistTaps="always"
            onScrollBeginDrag={modalKeyboard.cancelPendingScroll}
            onScroll={modalKeyboard.handleScroll}
            scrollEventThrottle={16}
            onContentSizeChange={modalKeyboard.handleContentSizeChange}
            showsVerticalScrollIndicator={false}
          >
            <View
              ref={modalKeyboard.registerFieldNode("custom")}
              collapsable={false}
              onLayout={modalKeyboard.registerField("custom")}
              style={styles.modalCard}
            >
              <View style={styles.modalHeader}>
                <View style={styles.modalHeading}>
                  <Text style={styles.modalTitle}>Adicionar sonho</Text>
                  <Text style={styles.modalSubtitle}>Dê um nome ao objetivo que você quer conquistar.</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Fechar"
                  onPress={closeCustomModal}
                  hitSlop={12}
                  style={styles.modalClose}
                >
                  <Ionicons name="close" size={21} color="#C2CBD9" />
                </Pressable>
              </View>
              <TextInput
                ref={customInputRef}
                accessibilityLabel="Nome do sonho"
                value={custom}
                onChangeText={setCustom}
                placeholder="Digite seu sonho"
                placeholderTextColor={OB.support}
                returnKeyType="done"
                onFocus={() => modalKeyboard.focusField("custom")}
                onPressIn={() => modalKeyboard.focusField("custom")}
                onSubmitEditing={addCustom}
                style={styles.modalInput}
              />
              <View style={styles.modalActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancelar"
                  onPress={closeCustomModal}
                  style={styles.cancelButton}
                >
                  <Text style={styles.cancelText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !custom.trim() }}
                  disabled={!custom.trim()}
                  onPress={addCustom}
                  style={[styles.modalPrimary, !custom.trim() && styles.modalPrimaryDisabled]}
                >
                  <Text style={[styles.modalPrimaryText, !custom.trim() && styles.modalPrimaryTextDisabled]}>
                    Concluir
                  </Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  background: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#06152E",
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
  dreamMark: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22,56,112,0.22)",
    borderWidth: 1,
    borderColor: "rgba(123,160,200,0.30)",
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
  contentScroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
  },
  contentCompact: {
    paddingTop: 16,
  },
  intro: {
    alignItems: "center",
    marginBottom: 24,
  },
  introCompact: {
    marginBottom: 18,
  },
  title: {
    maxWidth: 300,
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
  selectedList: {
    gap: 10,
  },
  dreamCard: {
    minHeight: 78,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.20)",
    backgroundColor: "rgba(255,255,255,0.02)",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 7,
  },
  dreamCopy: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
  },
  dreamTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 21,
    fontWeight: "600",
  },
  valuePill: {
    minHeight: 25,
    marginTop: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.16)",
    backgroundColor: "rgba(4,16,37,0.26)",
    justifyContent: "center",
    paddingHorizontal: 9,
  },
  valueText: {
    color: "#AEB9C9",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
  },
  removeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    marginTop: -5,
  },
  removeButtonPressed: {
    opacity: 0.62,
  },
  suggestions: {
    marginTop: 2,
  },
  suggestionsAfterList: {
    marginTop: 18,
  },
  suggestionsLabel: {
    marginBottom: 10,
    color: "#8C9AAE",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  choices: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 22,
  },
  choicesScroll: {
    marginHorizontal: -22,
  },
  choice: {
    minHeight: 46,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(123,160,200,0.24)",
    backgroundColor: "rgba(255,255,255,0.018)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  choicePressed: {
    borderColor: "rgba(175,199,232,0.55)",
    backgroundColor: "rgba(123,160,200,0.10)",
  },
  choiceText: {
    color: "#C6D1DF",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  addButton: {
    minHeight: 60,
    marginTop: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(140,154,174,0.72)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  addButtonPressed: {
    backgroundColor: "rgba(123,160,200,0.07)",
    borderColor: "rgba(175,199,232,0.82)",
  },
  addText: {
    color: "#9ABBE8",
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "500",
  },
  capacityText: {
    marginTop: 14,
    color: "#8C9AAE",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 10,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(2,10,24,0.82)",
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 22,
  },
  modalCard: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.22)",
    padding: 20,
    gap: 18,
    backgroundColor: "#0A1B36",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  modalHeading: {
    flex: 1,
  },
  modalTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "800",
  },
  modalSubtitle: {
    marginTop: 5,
    color: "#8C9AAE",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  modalClose: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -7,
    marginRight: -7,
  },
  modalInput: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.28)",
    paddingHorizontal: 16,
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(140,154,174,0.26)",
    backgroundColor: "rgba(255,255,255,0.025)",
  },
  cancelText: {
    color: "#C2CBD9",
    fontSize: 14,
    fontWeight: "700",
  },
  modalPrimary: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  modalPrimaryDisabled: {
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  modalPrimaryText: {
    color: "#06152E",
    fontSize: 14,
    fontWeight: "800",
  },
  modalPrimaryTextDisabled: {
    color: "rgba(255,255,255,0.36)",
  },
});
