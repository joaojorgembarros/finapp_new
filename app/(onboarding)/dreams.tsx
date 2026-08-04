import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Alert, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { OB, OnboardingBackground, OnboardingShell, PrimaryButton, ScreenIntro } from "../../src/ui/OnboardingKit";

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

function readSelectedDreams(raw: string | string[] | undefined) {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? JSON.parse(value) : PRESELECTED;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : PRESELECTED;
  } catch {
    return PRESELECTED;
  }
}

function Chip({ dream, active, onPress }: { dream: Dream; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        styles[`chip${dream.size.toUpperCase()}` as "chipSM" | "chipMD" | "chipLG"],
        active && styles.chipActive,
      ]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{dream.label}</Text>
      {active ? (
        <View style={styles.check}>
          <Ionicons name="checkmark" size={11} color="#fff" />
        </View>
      ) : null}
    </Pressable>
  );
}

export default function DreamsScreen() {
  const params = useLocalSearchParams<{
    maxDreams?: string;
    returnToJourney?: string;
    excludedDreams?: string;
    selectedDreams?: string;
  }>();
  const maxDreams = Math.max(1, Math.min(MAX_DREAMS, Number(params.maxDreams) || MAX_DREAMS));
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

  const allDreams = useMemo(
    () =>
      [...DREAMS, ...extras].filter(
        (dream) => !excludedDreams.has(dream.label.trim().toLocaleLowerCase("pt-BR"))
      ),
    [excludedDreams, extras]
  );
  const count = selected.size;

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
    setModal(false);
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

  return (
    <OnboardingShell>
      <OnboardingBackground />
      <View style={styles.root}>
        <ScreenIntro
          eyebrow="Seus objetivos"
          title="Quais sonhos você quer conquistar?"
          subtitle="Escolha seus objetivos e organize sua jornada por prazo."
          onBack={params.returnToJourney === "1" ? () => router.back() : undefined}
          currentStep={1}
          totalSteps={params.returnToJourney === "1" ? 2 : 3}
        />

        <View style={styles.card}>
          <ScrollView contentContainerStyle={styles.chips} showsVerticalScrollIndicator={false}>
            {allDreams.map((dream) => (
              <Chip
                key={dream.label}
                dream={dream}
                active={selected.has(dream.label)}
                onPress={() => toggle(dream.label)}
              />
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={openCustomModal} style={styles.addButton}>
              <Ionicons name="add" size={17} color={OB.support} />
              <Text style={styles.addText}>Cadastrar sonho</Text>
            </Pressable>
            <Text style={styles.count}>
              {count === 0
                ? `Escolha até ${maxDreams} ${maxDreams === 1 ? "sonho" : "sonhos"}`
                : `${count} de ${maxDreams} sonho${maxDreams > 1 ? "s" : ""} selecionado${count > 1 ? "s" : ""}`}
            </Text>
            <PrimaryButton
              title="Continuar minha jornada"
              disabled={!count}
              onPress={next}
            />
          </View>
        </View>
      </View>

      <Modal visible={modal} transparent animationType="fade" onRequestClose={() => setModal(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <BlurView
            intensity={34}
            tint="dark"
            experimentalBlurMethod="dimezisBlurView"
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Cadastrar sonho</Text>
              <Pressable onPress={() => setModal(false)} hitSlop={12}>
                <Ionicons name="close" size={20} color={OB.support} />
              </Pressable>
            </View>
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="Digite seu sonho"
              placeholderTextColor={OB.support}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                Keyboard.dismiss();
                addCustom();
              }}
              style={styles.modalInput}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setModal(false)} style={styles.cancelButton}>
                <Text style={styles.cancelText}>Cancelar</Text>
              </Pressable>
              <PrimaryButton
                title="Concluir"
                disabled={!custom.trim()}
                onPress={addCustom}
                style={styles.modalPrimary}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  root: {
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
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    padding: 20,
    paddingBottom: 14,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
    shadowColor: OB.primary,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  chipSM: {
    paddingHorizontal: 15,
    paddingVertical: 9,
  },
  chipMD: {
    paddingHorizontal: 19,
    paddingVertical: 10,
  },
  chipLG: {
    paddingHorizontal: 23,
    paddingVertical: 11,
  },
  chipActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
    shadowOpacity: 0.22,
    elevation: 4,
  },
  chipText: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  chipTextActive: {
    color: "#fff",
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.support,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    padding: 20,
    gap: 13,
  },
  addButton: {
    minHeight: 46,
    borderRadius: 999,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: OB.support,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  addText: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  count: {
    color: OB.support,
    fontWeight: "800",
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(6,21,46,0.78)",
  },
  modalCard: {
    width: "100%",
    borderRadius: 24,
    padding: 20,
    gap: 16,
    backgroundColor: "#fff",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
  },
  modalInput: {
    minHeight: 52,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    paddingHorizontal: 16,
    color: OB.primary,
    fontSize: 15,
    fontWeight: "800",
    backgroundColor: OB.offWhite,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    minHeight: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FDE7E7",
    borderWidth: 1,
    borderColor: "#F5B9B9",
  },
  cancelText: {
    color: "#B94A4A",
    fontSize: 15,
    fontWeight: "900",
  },
  modalPrimary: {
    flex: 1,
  },
});
