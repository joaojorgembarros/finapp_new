import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";

type FormatOption = {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  active?: boolean;
};

const formats: FormatOption[] = [
  {
    title: "CSV",
    subtitle: "Importação rápida com prévia antes de salvar",
    icon: "grid-outline",
    active: true,
  },
  {
    title: "Excel (.xlsx)",
    subtitle: "Planilhas bancárias entram em breve",
    icon: "document-text-outline",
  },
  {
    title: "PDF",
    subtitle: "Leitura exige revisão e será adicionada depois",
    icon: "document-outline",
  },
];

function FormatCard({ option }: { option: FormatOption }) {
  function onPress() {
    if (option.active) {
      router.push("/(app)/import-csv");
      return;
    }

    Alert.alert("Importar extrato", `${option.title} será conectado em uma próxima etapa.`);
  }

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.formatCard, pressed && styles.pressed]}>
      <View style={[styles.formatIcon, option.active && styles.formatIconActive]}>
        <Ionicons name={option.icon} size={22} color={option.active ? "#fff" : OB.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.formatTitleRow}>
          <Text style={styles.formatTitle}>{option.title}</Text>
          {option.active ? (
            <View style={styles.recommendedBadge}>
              <Text style={styles.recommendedText}>Recomendado</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.formatSubtitle}>{option.subtitle}</Text>
      </View>
      <Ionicons name={option.active ? "chevron-forward" : "lock-closed-outline"} size={18} color={OB.support} />
    </Pressable>
  );
}

export default function ImportExtractOnboarding() {
  return (
    <OnboardingShell light>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          <Text style={styles.headerEyebrow}>Controle financeiro</Text>
          <Text style={styles.headerTitle}>Importar extrato</Text>
          <Text style={styles.headerSubtitle}>Escolha o formato do arquivo e revise tudo antes de salvar.</Text>
        </View>

        <Pressable
          onPress={() => router.push("/(app)/import-history")}
          style={({ pressed }) => [styles.historyCard, pressed && styles.pressed]}
        >
          <View style={styles.historyIcon}>
            <Ionicons name="time-outline" size={21} color={OB.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.historyTitle}>Histórico de importações</Text>
            <Text style={styles.historyText}>Consulte arquivos importados ou desfaça uma importação</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={OB.support} />
        </Pressable>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Formato do arquivo</Text>
          {formats.map((option) => (
            <FormatCard key={option.title} option={option} />
          ))}
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="checkmark-circle-outline" size={19} color={OB.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Você revisa antes de importar</Text>
            <Text style={styles.infoText}>O CSV mostra totais, avisos e uma prévia das movimentações antes de gravar no app.</Text>
          </View>
        </View>
      </ScrollView>
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 20,
    gap: 16,
    paddingBottom: 28,
  },
  headerCard: {
    minHeight: 140,
    borderRadius: 22,
    padding: 20,
    paddingRight: 58,
    justifyContent: "flex-end",
    backgroundColor: OB.primary,
  },
  backButton: {
    position: "absolute",
    right: 14,
    top: 14,
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
  },
  headerEyebrow: {
    color: OB.textOnDarkMid,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  headerTitle: {
    color: OB.textOnDark,
    fontSize: 25,
    fontWeight: "900",
    marginTop: 8,
  },
  headerSubtitle: {
    color: OB.textOnDarkMid,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 6,
  },
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  historyCard: {
    minHeight: 76,
    borderRadius: 18,
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(123,160,200,0.14)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  historyIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  historyTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  historyText: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
    marginTop: 4,
  },
  sectionTitle: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  formatCard: {
    minHeight: 76,
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  pressed: {
    opacity: 0.82,
  },
  formatIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  formatIconActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  formatTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  formatTitle: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  recommendedBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(123,160,200,0.22)",
  },
  recommendedText: {
    color: OB.primary,
    fontSize: 9,
    fontWeight: "900",
  },
  formatSubtitle: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 4,
  },
  infoCard: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    gap: 10,
    backgroundColor: "rgba(123,160,200,0.14)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  infoTitle: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  infoText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 4,
  },
});
