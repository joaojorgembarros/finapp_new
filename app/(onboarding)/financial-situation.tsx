import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
import { markNewOnboardingDone } from "../../src/lib/newOnboarding";
import { useSession } from "../../src/providers/SessionProvider";
import { BANK_CATALOG } from "../../src/lib/banks";

type Bank = {
  name: string;
  shortName: string;
  color: string;
};

const DEBT_OPTIONS = [
  "Cartão de crédito",
  "Empréstimo pessoal",
  "Financiamento de veículo",
  "Financiamento imobiliário",
  "Financiamento estudantil",
  "Não tenho dívidas",
] as const;

const NO_DEBTS = "Não tenho dívidas";
const NO_BANK = "Não uso banco";

const BANKS: Bank[] = [
  ...BANK_CATALOG.map(({ name, shortName, color }) => ({ name, shortName, color })),
  { name: "Outro banco", shortName: "+", color: OB.support },
  { name: NO_BANK, shortName: "—", color: "#64748B" },
];

function parseStringArray(raw: string | string[] | undefined) {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseValues(raw: string | string[] | undefined) {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]))
      : {};
  } catch {
    return {};
  }
}

function DebtChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.debtChip, selected && styles.debtChipSelected]}>
      {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
      <Text style={[styles.debtChipText, selected && styles.debtChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function BankCard({
  bank,
  selected,
  onPress,
}: {
  bank: Bank;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={bank.name}
      onPress={onPress}
      style={[styles.bankCard, selected && styles.bankCardSelected]}
    >
      <View style={[styles.bankMark, { backgroundColor: bank.color }]}>
        <Text style={styles.bankMarkText}>{bank.shortName}</Text>
      </View>
      <Text numberOfLines={2} style={styles.bankName}>{bank.name}</Text>
      <View style={[styles.selectionMark, selected && styles.selectionMarkSelected]}>
        {selected ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
      </View>
    </Pressable>
  );
}

export default function FinancialSituationScreen() {
  const params = useLocalSearchParams<{ dreams?: string; values?: string }>();
  const { session, userId } = useSession();
  const metadata = session?.user.user_metadata;

  const dreams = useMemo(
    () => {
      const fromParams = parseStringArray(params.dreams);
      return fromParams.length
        ? fromParams
        : Array.isArray(metadata?.finapp_dreams)
          ? metadata.finapp_dreams.map(String)
          : [];
    },
    [metadata?.finapp_dreams, params.dreams]
  );
  const values = useMemo(
    () => {
      const fromParams = parseValues(params.values);
      return Object.keys(fromParams).length
        ? fromParams
        : parseValues(JSON.stringify(metadata?.finapp_dream_values ?? {}));
    },
    [metadata?.finapp_dream_values, params.values]
  );

  const [selectedDebts, setSelectedDebts] = useState<Set<string>>(
    () => new Set(Array.isArray(metadata?.finapp_debts) ? metadata.finapp_debts.map(String) : [NO_DEBTS])
  );
  const [selectedBanks, setSelectedBanks] = useState<Set<string>>(
    () => new Set(Array.isArray(metadata?.finapp_banks) ? metadata.finapp_banks.map(String) : [])
  );
  const [section, setSection] = useState<"debts" | "banks">("debts");
  const [saving, setSaving] = useState(false);

  function toggleDebt(label: string) {
    setSelectedDebts((current) => {
      if (label === NO_DEBTS) return new Set(current.has(NO_DEBTS) ? [] : [NO_DEBTS]);
      const next = new Set([...current].filter((item) => item !== NO_DEBTS));
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function toggleBank(label: string) {
    setSelectedBanks((current) => {
      if (label === NO_BANK) return new Set(current.has(NO_BANK) ? [] : [NO_BANK]);
      const next = new Set([...current].filter((item) => item !== NO_BANK));
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  async function finish() {
    if (!userId) return Alert.alert("Sessão expirada", "Entre novamente para continuar.");
    if (!dreams.length) {
      return Alert.alert("Sonhos não encontrados", "Volte e selecione ao menos um sonho.");
    }
    if (!selectedDebts.size) {
      return Alert.alert("Conte sobre suas dívidas", "Escolha uma opção para continuar.");
    }
    if (!selectedBanks.size) {
      return Alert.alert("Escolha seus bancos", "Selecione ao menos um banco ou marque que não usa banco.");
    }

    try {
      setSaving(true);
      await markNewOnboardingDone(userId, dreams, values, {
        banks: [...selectedBanks],
        debts: [...selectedDebts],
      });
      router.replace({
        pathname: "/(app)/journey",
        params: {
          dreams: JSON.stringify(dreams),
          values: JSON.stringify(values),
        },
      });
    } catch (error: any) {
      Alert.alert(
        "Não foi possível concluir",
        error?.message ?? "Confira sua conexão e tente novamente."
      );
    } finally {
      setSaving(false);
    }
  }

  const canFinish = selectedDebts.size > 0 && selectedBanks.size > 0 && !saving;

  function goBack() {
    router.replace({
      pathname: "/(onboarding)/dream-values",
      params: {
        dreams: JSON.stringify(dreams),
        values: JSON.stringify(values),
      },
    });
  }

  function handleBack() {
    if (section === "banks") {
      setSection("debts");
      return;
    }
    goBack();
  }

  function continueToBanks() {
    if (!selectedDebts.size) {
      Alert.alert("Conte sobre suas dívidas", "Escolha uma opção para continuar.");
      return;
    }
    setSection("banks");
  }

  return (
    <OnboardingShell>
      <OnboardingBackground />
      <View style={styles.root}>
        <ScreenIntro
          eyebrow="Seu ponto de partida"
          title="Vamos entender onde você está hoje"
          subtitle="Essas informações ajudam a organizar uma jornada que faça sentido para você."
          onBack={handleBack}
          currentStep={3}
          totalSteps={3}
        />

        <View style={styles.card}>
          <View style={styles.sectionProgress}>
            <View style={styles.sectionProgressCopy}>
              <Text style={styles.sectionProgressLabel}>
                PARTE {section === "debts" ? "1" : "2"} DE 2
              </Text>
              <Text style={styles.sectionProgressTitle}>
                {section === "debts" ? "Dívidas" : "Seus bancos"}
              </Text>
            </View>
            <View style={styles.sectionProgressBars}>
              <View style={styles.sectionProgressBarActive} />
              <View
                style={[
                  styles.sectionProgressBar,
                  section === "banks" && styles.sectionProgressBarActive,
                ]}
              />
            </View>
          </View>

          <ScrollView
            key={section}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={section === "banks"}
          >
            {section === "debts" ? (
              <View>
              <View style={styles.sectionHeading}>
                <View style={styles.sectionIcon}>
                  <Ionicons name="card-outline" size={18} color={OB.primary} />
                </View>
                <View style={styles.sectionCopy}>
                  <Text style={styles.sectionTitle}>Você possui alguma dívida?</Text>
                  <Text style={styles.sectionSubtitle}>Você pode selecionar mais de uma opção.</Text>
                </View>
              </View>
              <View style={styles.debtList}>
                {DEBT_OPTIONS.map((option) => (
                  <DebtChip
                    key={option}
                    label={option}
                    selected={selectedDebts.has(option)}
                    onPress={() => toggleDebt(option)}
                  />
                ))}
              </View>
              </View>
            ) : (
              <View>
              <View style={styles.sectionHeading}>
                <View style={styles.sectionIcon}>
                  <Ionicons name="business-outline" size={18} color={OB.primary} />
                </View>
                <View style={styles.sectionCopy}>
                  <Text style={styles.sectionTitle}>Quais bancos você usa?</Text>
                  <Text style={styles.sectionSubtitle}>Selecione todos que fazem parte da sua rotina.</Text>
                </View>
              </View>
              <View style={styles.bankGrid}>
                {BANKS.map((bank) => (
                  <BankCard
                    key={bank.name}
                    bank={bank}
                    selected={selectedBanks.has(bank.name)}
                    onPress={() => toggleBank(bank.name)}
                  />
                ))}
              </View>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerHint}>
              {section === "debts"
                ? "Na próxima parte, você poderá escolher seus bancos."
                : "Usaremos essas escolhas para personalizar sua experiência."}
            </Text>
            {section === "debts" ? (
              <PrimaryButton
                title="Continuar para meus bancos"
                disabled={!selectedDebts.size}
                onPress={continueToBanks}
              />
            ) : (
              <>
                <PrimaryButton
                  title={saving ? "Preparando sua jornada..." : "Concluir e ver minha jornada"}
                  disabled={!canFinish}
                  onPress={finish}
                />
                {saving ? <ActivityIndicator color={OB.primary} size="small" /> : null}
              </>
            )}
          </View>
        </View>
      </View>
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
    overflow: "hidden",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.88)",
    shadowColor: OB.primary,
    shadowOpacity: 0.25,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -10 },
    elevation: 10,
  },
  sectionProgress: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: OB.supportSoft,
  },
  sectionProgressCopy: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  sectionProgressLabel: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  sectionProgressTitle: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  sectionProgressBars: {
    width: 76,
    flexDirection: "row",
    gap: 6,
  },
  sectionProgressBar: {
    flex: 1,
    height: 5,
    borderRadius: 99,
    backgroundColor: OB.supportSoft,
  },
  sectionProgressBarActive: {
    flex: 1,
    height: 5,
    borderRadius: 99,
    backgroundColor: OB.primary,
  },
  content: {
    padding: 20,
    paddingBottom: 24,
  },
  sectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 16,
  },
  sectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF0F7",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  sectionCopy: {
    flex: 1,
  },
  sectionTitle: {
    color: OB.primary,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: "900",
  },
  sectionSubtitle: {
    color: OB.support,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
    marginTop: 2,
  },
  debtList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  debtChip: {
    minHeight: 42,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 15,
    paddingVertical: 10,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  debtChipSelected: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  debtChipText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "800",
  },
  debtChipTextSelected: {
    color: "#fff",
  },
  bankGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  bankCard: {
    width: "48.4%",
    minHeight: 112,
    borderRadius: 20,
    padding: 14,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    shadowColor: OB.primary,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  bankCardSelected: {
    backgroundColor: "#ECF3FB",
    borderColor: OB.primary,
    shadowOpacity: 0.14,
    elevation: 3,
  },
  bankMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bankMarkText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  bankName: {
    color: OB.primary,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "900",
    marginTop: 9,
    paddingRight: 22,
  },
  selectionMark: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: "#fff",
  },
  selectionMarkSelected: {
    borderColor: OB.primary,
    backgroundColor: OB.primary,
  },
  footer: {
    padding: 20,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    backgroundColor: "rgba(246,247,249,0.98)",
  },
  footerHint: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
});
