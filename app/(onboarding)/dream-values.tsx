import React, { useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { OB, OnboardingBackground, OnboardingShell, PrimaryButton, ScreenIntro, SecondaryButton } from "../../src/ui/OnboardingKit";
import { formatBRLFromCents, formatBRLInputFromDigits, parseBRLToCents } from "../../src/lib/format";
import { useSession } from "../../src/providers/SessionProvider";
import { markNewOnboardingDone } from "../../src/lib/newOnboarding";

const FALLBACK = ["Reserva de emergência", "Investir mais", "Liberdade financeira"];

function readDreams(raw: string | string[] | undefined) {
  try {
    const value = Array.isArray(raw) ? raw[0] : raw;
    const parsed = value ? JSON.parse(value) : null;
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function DreamValueCard({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
}) {
  const cents = parseBRLToCents(value);

  return (
    <View style={styles.valueCard}>
      <View style={styles.cardAccent} />
      <View style={styles.goalRow}>
        <View style={styles.goalIcon}>
          <Ionicons name="sparkles" size={18} color={OB.support} />
        </View>
        <View style={styles.goalCopy}>
          <Text style={styles.goalTitle}>{label}</Text>
          <Text style={styles.goalMeta}>Meta financeira</Text>
        </View>
      </View>

      <View style={styles.inputBox}>
        <Text style={styles.currency}>R$</Text>
        <TextInput
          value={value.replace("R$", "").trim()}
          onChangeText={(text) => onChange(formatBRLInputFromDigits(text))}
          placeholder="0,00"
          placeholderTextColor={OB.support}
          keyboardType="number-pad"
          style={styles.input}
        />
      </View>

      <Text style={styles.helper}>{cents > 0 ? `${formatBRLFromCents(cents)} definidos para este objetivo` : "Quanto você precisa para conquistar este sonho?"}</Text>
    </View>
  );
}

export default function DreamValuesScreen() {
  const params = useLocalSearchParams<{ dreams?: string }>();
  const { userId } = useSession();
  const dreams = useMemo(() => readDreams(params.dreams), [params.dreams]);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(dreams.map((dream) => [dream, ""])));
  const [saving, setSaving] = useState(false);

  const filled = Object.values(values).filter((value) => parseBRLToCents(value) > 0).length;
  const canContinue = filled > 0;

  async function next() {
    if (saving) return;
    try {
      setSaving(true);
      if (userId) {
        await markNewOnboardingDone(userId);
      }
    } catch {
      // O fluxo visual não deve travar se o armazenamento local falhar.
    } finally {
      setSaving(false);
    }

    router.push({
      pathname: "/(onboarding)/journey",
      params: {
        dreams: JSON.stringify(dreams),
        values: JSON.stringify(values),
      },
    });
  }

  return (
    <OnboardingShell>
      <OnboardingBackground />
      <KeyboardAvoidingView enabled={Platform.OS === "ios"} behavior="padding" style={styles.keyboard}>
        <ScreenIntro
          eyebrow="Valores dos sonhos"
          title="Quanto custa realizar seus sonhos?"
          subtitle="Defina o valor que você acredita precisar para conquistar cada objetivo."
          onBack={() => router.back()}
        />

        <View style={styles.card}>
          <View style={styles.progressWrap}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressText}>{filled} de {dreams.length} preenchidos</Text>
              <Text style={styles.progressText}>{Math.round((filled / dreams.length) * 100)}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${(filled / dreams.length) * 100}%` }]} />
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {dreams.map((dream) => (
              <DreamValueCard
                key={dream}
                label={dream}
                value={values[dream] ?? ""}
                onChange={(value) => setValues((prev) => ({ ...prev, [dream]: value }))}
              />
            ))}
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footerHint}>{canContinue ? "Você pode ajustar os valores depois." : "Preencha ao menos um valor para continuar."}</Text>
            <PrimaryButton title={saving ? "Salvando..." : "Continuar"} disabled={!canContinue || saving} onPress={next} />
            <SecondaryButton title="Voltar" onPress={() => router.back()} />
          </View>
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
  },
  progressWrap: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  progressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  progressText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  progressTrack: {
    height: 5,
    borderRadius: 99,
    overflow: "hidden",
    backgroundColor: OB.supportSoft,
  },
  progressFill: {
    height: "100%",
    borderRadius: 99,
    backgroundColor: OB.primary,
  },
  list: {
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  valueCard: {
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.9)",
    shadowColor: OB.primary,
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardAccent: {
    height: 3,
    backgroundColor: OB.support,
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    paddingBottom: 12,
  },
  goalIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  goalCopy: {
    flex: 1,
  },
  goalTitle: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
  },
  goalMeta: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  inputBox: {
    marginHorizontal: 16,
    minHeight: 50,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
    backgroundColor: OB.offWhite,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
  },
  currency: {
    color: OB.primary,
    fontSize: 15,
    fontWeight: "900",
    marginRight: 6,
  },
  input: {
    flex: 1,
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  helper: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  footer: {
    gap: 10,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
  },
  footerHint: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
});
