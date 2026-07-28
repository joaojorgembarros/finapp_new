import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { addTransaction } from "../../src/lib/transactions";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import { CsvParseResult, formatFileSize, ParsedCsvTx, PickedCsvFile, parseCsv, readCsvText } from "../../src/lib/csvImport";
import { findBankById } from "../../src/lib/banks";

const emptyResult: CsvParseResult = {
  rows: [],
  errors: [],
  ignoredRows: 0,
  initialBalanceCents: null,
  finalBalanceCents: null,
  detectedBankId: null,
};

function SummaryPill({ label, value, tone }: { label: string; value: string; tone: "primary" | "good" | "bad" }) {
  const color = tone === "good" ? "#178A55" : tone === "bad" ? "#B94A4A" : OB.primary;
  const bg = tone === "good" ? "rgba(34,169,107,0.13)" : tone === "bad" ? "rgba(224,82,82,0.13)" : "rgba(123,160,200,0.16)";

  return (
    <View style={[styles.summaryPill, { backgroundColor: bg }]}>
      <Text style={styles.summaryLabel} numberOfLines={1}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {value}
      </Text>
    </View>
  );
}

function PreviewRow({ row }: { row: ParsedCsvTx }) {
  const isIncome = row.type === "income";
  const color = isIncome ? "#178A55" : "#B94A4A";

  return (
    <View style={styles.previewRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.previewTitle} numberOfLines={2}>{row.note}</Text>
        <Text style={styles.previewMeta}>Linha {row.rawLine} - {formatDateBRFromYMD(row.occurred_on)}</Text>
      </View>
      <Text style={[styles.previewAmount, { color }]}>
        {isIncome ? "+" : "-"}{formatBRLFromCents(row.amount_cents)}
      </Text>
    </View>
  );
}

export default function ImportCsvOnboarding() {
  const { userId } = useSession();
  const { householdId } = useHouseholdId(userId);
  const [csv, setCsv] = useState("");
  const [file, setFile] = useState<PickedCsvFile | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAllPreview, setShowAllPreview] = useState(false);

  const result = useMemo(() => (csv ? parseCsv(csv, { fileName: file?.name }) : emptyResult), [csv, file?.name]);
  const detectedBank = findBankById(result.detectedBankId);
  const income = result.rows.filter((row) => row.type === "income").reduce((sum, row) => sum + row.amount_cents, 0);
  const expense = result.rows.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount_cents, 0);
  const partial = income - expense;
  const accountBalance = result.initialBalanceCents === null ? partial : result.initialBalanceCents + partial;
  const hasFile = Boolean(file);
  const previewRows = showAllPreview ? result.rows : result.rows.slice(0, 8);

  async function pickCsv() {
    if (reading || busy) return;

    try {
      setReading(true);
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/csv", "text/plain"],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (picked.canceled) return;

      const asset = picked.assets[0];
      if (!asset) return;

      const content = await readCsvText(asset.uri);
      setCsv(content);
      setFile({ name: asset.name || "extrato.csv", size: asset.size });
      setShowAllPreview(false);
    } catch (error: any) {
      Alert.alert("Erro", error?.message ?? "Não foi possível ler o arquivo CSV.");
    } finally {
      setReading(false);
    }
  }

  function clearFile() {
    if (busy) return;
    setCsv("");
    setFile(null);
    setShowAllPreview(false);
  }

  async function importRows() {
    if (!userId || !householdId) return Alert.alert("Atenção", "Entre em uma casa antes de importar.");
    if (!result.rows.length) return Alert.alert("Atenção", "Não há transações válidas para importar.");
    if (busy) return;

    try {
      setBusy(true);
      for (const row of result.rows) {
        await addTransaction({
          householdId,
          userId,
          type: row.type,
          amount_cents: row.amount_cents,
          note: row.note,
          occurred_on: row.occurred_on,
          category_id: null,
        });
      }

      Alert.alert("Importação concluída", `${result.rows.length} transações foram salvas.`);
      clearFile();
    } catch (error: any) {
      Alert.alert("Erro", error?.message ?? "Falha ao importar CSV.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingShell light>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headerCard}>
          <Pressable onPress={() => router.back()} style={styles.backButton} hitSlop={12}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          <Text style={styles.headerEyebrow}>Importar extrato</Text>
          <Text style={styles.headerTitle}>CSV</Text>
          <Text style={styles.headerSubtitle}>Selecione o arquivo do banco e confira a prévia antes de salvar.</Text>
        </View>

        <View style={styles.card}>
          <Pressable onPress={pickCsv} disabled={reading || busy} style={({ pressed }) => [styles.uploadBox, hasFile && styles.uploadBoxActive, pressed && styles.pressed]}>
            <View style={[styles.uploadIcon, hasFile && styles.uploadIconActive]}>
              {reading ? (
                <ActivityIndicator color={hasFile ? "#fff" : OB.primary} />
              ) : (
                <Ionicons name={hasFile ? "document-text-outline" : "cloud-upload-outline"} size={27} color={hasFile ? "#fff" : OB.primary} />
              )}
            </View>
            <Text style={styles.uploadTitle}>{hasFile ? file?.name : "Selecionar arquivo CSV"}</Text>
            <Text style={styles.uploadText}>{hasFile ? formatFileSize(file?.size) : "Use um arquivo com data, descrição, valor e tipo"}</Text>
          </Pressable>

          <View style={styles.buttonRow}>
            <Pressable onPress={pickCsv} disabled={reading || busy} style={[styles.primaryButton, (reading || busy) && styles.buttonDisabled]}>
              <Text style={styles.primaryText}>{reading ? "Lendo..." : hasFile ? "Trocar arquivo" : "Escolher arquivo"}</Text>
            </Pressable>
            {hasFile ? (
              <Pressable onPress={clearFile} disabled={busy} style={[styles.secondaryButton, busy && styles.buttonDisabled]}>
                <Text style={styles.secondaryText}>Remover</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {!hasFile ? (
          <View style={styles.infoCard}>
            <Ionicons name="sparkles-outline" size={20} color={OB.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.infoTitle}>A prévia aparece aqui</Text>
              <Text style={styles.infoText}>Depois de selecionar o CSV, o app mostra totais, avisos e as primeiras movimentações encontradas.</Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Resumo da leitura</Text>
              {detectedBank ? (
                <View style={styles.detectedBank}>
                  <Ionicons name="business-outline" size={17} color={OB.primary} />
                  <Text style={styles.detectedBankText}>Banco identificado: {detectedBank.name}</Text>
                </View>
              ) : null}
              <View style={styles.summaryGrid}>
                <SummaryPill label="Válidas" value={String(result.rows.length)} tone="primary" />
                <SummaryPill label="Entradas" value={formatBRLFromCents(income)} tone="good" />
                <SummaryPill label="Saídas" value={formatBRLFromCents(expense)} tone="bad" />
                <SummaryPill label="Saldo da conta" value={formatBRLFromCents(accountBalance)} tone={accountBalance < 0 ? "bad" : "good"} />
              </View>

              {result.ignoredRows ? (
                <Text style={styles.mutedText}>{result.ignoredRows} lançamento(s) BB Rende Fácil ignorado(s), pois são aplicação ou resgate automático.</Text>
              ) : null}

              {result.errors.length ? (
                <View style={styles.errorBox}>
                  {result.errors.slice(0, 5).map((error) => (
                    <Text key={error} style={styles.errorText}>• {error}</Text>
                  ))}
                  {result.errors.length > 5 ? <Text style={styles.mutedText}>Mais {result.errors.length - 5} avisos encontrados.</Text> : null}
                </View>
              ) : (
                <Text style={styles.mutedText}>Tudo certo para importar.</Text>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.previewHeader}>
                <Text style={styles.sectionTitle}>Prévia do extrato</Text>
                {result.rows.length > 8 ? (
                  <Pressable onPress={() => setShowAllPreview((value) => !value)} style={styles.previewToggle}>
                    <Text style={styles.previewToggleText}>{showAllPreview ? "Ver menos" : "Ver tudo"}</Text>
                  </Pressable>
                ) : null}
              </View>

              {previewRows.map((row) => (
                <PreviewRow key={row.key} row={row} />
              ))}

              {result.rows.length > 8 && !showAllPreview ? (
                <Pressable onPress={() => setShowAllPreview(true)} style={styles.moreButton}>
                  <Text style={styles.moreText}>Ver mais {result.rows.length - 8} linhas</Text>
                </Pressable>
              ) : null}
              {!result.rows.length ? <Text style={styles.mutedText}>Nenhuma linha válida encontrada neste arquivo.</Text> : null}
            </View>

            <Pressable onPress={importRows} disabled={busy || !result.rows.length} style={[styles.importButton, (busy || !result.rows.length) && styles.importButtonDisabled]}>
              <Text style={[styles.importText, (busy || !result.rows.length) && styles.importTextDisabled]}>
                {busy ? "Importando..." : "Importar transações"}
              </Text>
            </Pressable>
          </>
        )}
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
    minHeight: 154,
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
  uploadBox: {
    minHeight: 180,
    borderRadius: 18,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: OB.support,
    backgroundColor: "rgba(123,160,200,0.12)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  uploadBoxActive: {
    borderColor: OB.primary,
    backgroundColor: "rgba(123,160,200,0.18)",
  },
  pressed: {
    opacity: 0.84,
  },
  uploadIcon: {
    width: 62,
    height: 62,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  uploadIconActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  uploadTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 14,
  },
  uploadText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
    textAlign: "center",
    marginTop: 6,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  primaryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  secondaryButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  secondaryText: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.5,
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
  sectionTitle: {
    color: OB.primary,
    fontSize: 16,
    fontWeight: "900",
  },
  detectedBank: {
    minHeight: 42,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(123,160,200,0.14)",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  detectedBankText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  summaryPill: {
    width: "48%",
    minWidth: 132,
    borderRadius: 14,
    padding: 12,
  },
  summaryLabel: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: "900",
    marginTop: 4,
  },
  mutedText: {
    color: OB.support,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  errorBox: {
    gap: 6,
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FBBF24",
  },
  errorText: {
    color: "#92400E",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  previewToggle: {
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  previewToggleText: {
    color: OB.primary,
    fontSize: 12,
    fontWeight: "900",
  },
  previewRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: OB.supportSoft,
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  previewTitle: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  previewMeta: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
  },
  previewAmount: {
    fontSize: 13,
    fontWeight: "900",
  },
  moreButton: {
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  moreText: {
    color: OB.primary,
    fontWeight: "900",
  },
  importButton: {
    minHeight: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.primary,
  },
  importButtonDisabled: {
    backgroundColor: "rgba(123,160,200,0.32)",
  },
  importText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "900",
  },
  importTextDisabled: {
    color: OB.support,
  },
});
