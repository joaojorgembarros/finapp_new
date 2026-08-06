import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { OB, OnboardingShell } from "../../src/ui/OnboardingKit";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { formatBRLFromCents, formatDateBRFromYMD } from "../../src/lib/format";
import { CsvParseResult, formatFileSize, ParsedCsvTx, PickedCsvFile, parseCsv, readCsvText } from "../../src/lib/csvImport";
import { BANK_OPTIONS, BankId, findBankById } from "../../src/lib/banks";
import { Category, Kind, listCategories } from "../../src/lib/categories";
import { BankLogo } from "../../src/ui/BankLogo";
import {
  StatementCategorySuggestion,
  statementSimilarityKey,
  suggestStatementCategory,
} from "../../src/lib/statementCategorization";
import {
  listStatementCategoryRules,
  StatementCategoryRule,
  StatementCategoryRuleInput,
} from "../../src/lib/statementCategoryRules";
import {
  findStatementImportByHash,
  findStatementImportConflicts,
  hashStatementContent,
  importStatement,
  isDuplicateStatementError,
  StatementBalanceConfidence,
  StatementImport,
} from "../../src/lib/statementImports";

const emptyResult: CsvParseResult = {
  rows: [],
  errors: [],
  ignoredRows: 0,
  rejectedRows: 0,
  initialBalanceCents: null,
  finalBalanceCents: null,
  finalBalanceConfidence: "unavailable",
  detectedBankId: null,
};

function SummaryPill({ label, value, tone }: { label: string; value: string; tone: "primary" | "good" | "bad" }) {
  const color = tone === "good" ? "#178A55" : tone === "bad" ? "#B94A4A" : OB.primary;
  const bg = tone === "good" ? "rgba(34,169,107,0.13)" : tone === "bad" ? "rgba(224,82,82,0.13)" : "rgba(123,160,200,0.16)";

  return (
    <View style={[styles.summaryPill, { backgroundColor: bg }]}>
      <Text style={styles.summaryLabel} numberOfLines={2}>{label}</Text>
      <Text style={[styles.summaryValue, { color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
        {value}
      </Text>
    </View>
  );
}

function PreviewRow({
  row,
  conflict,
  categories,
  categoryId,
  suggestion,
  autoSuggested,
  similarCount,
  onCategoryChange,
  onOpenCategoryPicker,
  onApplySimilar,
}: {
  row: ParsedCsvTx;
  conflict: boolean;
  categories: Category[];
  categoryId: string | null;
  suggestion: StatementCategorySuggestion | null;
  autoSuggested: boolean;
  similarCount: number;
  onCategoryChange: (categoryId: string | null) => void;
  onOpenCategoryPicker: () => void;
  onApplySimilar: () => void;
}) {
  const isIncome = row.type === "income";
  const color = isIncome ? "#178A55" : "#B94A4A";
  const availableCategories = categories.filter((category) => category.flow === row.type);
  const selectedCategory = availableCategories.find((category) => category.id === categoryId) ?? null;

  return (
    <View style={[styles.previewRow, conflict && styles.previewRowConflict]}>
      <View style={styles.previewMain}>
        <View style={{ flex: 1 }}>
          <Text style={styles.previewTitle} numberOfLines={2}>{row.note}</Text>
          <Text style={styles.previewMeta}>Linha {row.rawLine} - {formatDateBRFromYMD(row.occurred_on)}</Text>
          {conflict ? <Text style={styles.conflictBadge}>Já existe · não será importada</Text> : null}
        </View>
        <Text style={[styles.previewAmount, { color }]}>
          {isIncome ? "+" : "-"}{formatBRLFromCents(row.amount_cents)}
        </Text>
      </View>

      {!conflict && availableCategories.length ? (
        <View style={styles.categoryReview}>
          <View style={styles.categoryReviewHeader}>
            <Text style={styles.categoryReviewLabel}>Categoria</Text>
            {autoSuggested ? (
              <Text style={styles.autoSuggestionLabel}>Sugerida automaticamente</Text>
            ) : null}
            {!categoryId && suggestion ? (
              <Pressable
                onPress={() => onCategoryChange(suggestion.categoryId)}
                style={styles.suggestionButton}
              >
                <Ionicons name="sparkles-outline" size={12} color="#175CD3" />
                <Text style={styles.suggestionText}>Usar {suggestion.categoryName}</Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            onPress={onOpenCategoryPicker}
            style={({ pressed }) => [styles.categorySelectButton, pressed && styles.categorySelectButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Selecionar categoria para ${row.note}`}
          >
            <View style={[styles.categorySelectIcon, selectedCategory && styles.categorySelectIconActive]}>
              <Ionicons
                name={(selectedCategory?.icon || "pricetag-outline") as any}
                size={17}
                color={selectedCategory ? "#fff" : OB.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.categorySelectCaption}>
                {selectedCategory ? "Categoria selecionada" : "Ainda sem categoria"}
              </Text>
              <Text style={styles.categorySelectName} numberOfLines={1}>
                {selectedCategory?.name ?? "Selecionar categoria"}
              </Text>
            </View>
            <View style={styles.categorySelectAction}>
              <Text style={styles.categorySelectActionText}>{selectedCategory ? "Alterar" : "Escolher"}</Text>
              <Ionicons name="chevron-down" size={16} color={OB.primary} />
            </View>
          </Pressable>

          {categoryId ? (
            <Pressable onPress={onApplySimilar} style={styles.applySimilarButton}>
              <Ionicons name="bookmark-outline" size={13} color={OB.primary} />
              <Text style={styles.applySimilarText}>
                {similarCount > 1
                  ? `Aplicar a ${similarCount} semelhantes e lembrar`
                  : "Lembrar para próximas importações"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function ImportCsvOnboarding() {
  const { session, userId } = useSession();
  const { householdId } = useHouseholdId(userId);
  const [csv, setCsv] = useState("");
  const [file, setFile] = useState<PickedCsvFile | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAllPreview, setShowAllPreview] = useState(false);
  const [fileHash, setFileHash] = useState<string | null>(null);
  const [duplicateImport, setDuplicateImport] = useState<StatementImport | null>(null);
  const [conflictLines, setConflictLines] = useState<number[]>([]);
  const [checkingDuplicate, setCheckingDuplicate] = useState(false);
  const [duplicateCheckError, setDuplicateCheckError] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const [categoryAssignments, setCategoryAssignments] = useState<Record<string, string | null>>({});
  const [categoryRules, setCategoryRules] = useState<StatementCategoryRule[]>([]);
  const [pendingCategoryRules, setPendingCategoryRules] = useState<Record<string, StatementCategoryRuleInput>>({});
  const [autoSuggestedRows, setAutoSuggestedRows] = useState<Set<string>>(new Set());
  const [categoryPickerRow, setCategoryPickerRow] = useState<ParsedCsvTx | null>(null);
  const [selectedBankId, setSelectedBankId] = useState<BankId | null>(null);
  const [bankPickerOpen, setBankPickerOpen] = useState(false);

  const result = useMemo(() => (csv ? parseCsv(csv, { fileName: file?.name }) : emptyResult), [csv, file?.name]);
  const detectedBank = findBankById(result.detectedBankId);
  const selectedBank = findBankById(selectedBankId);
  const registeredBankNames = useMemo(
    () => Array.isArray(session?.user.user_metadata?.finapp_banks)
      ? session.user.user_metadata.finapp_banks.map(String)
      : [],
    [session?.user.user_metadata?.finapp_banks]
  );
  const bankOptions = useMemo(() => {
    const preferred = BANK_OPTIONS.filter((bank) => registeredBankNames.includes(bank.name));
    if (detectedBank && !preferred.some((bank) => bank.id === detectedBank.id)) {
      preferred.unshift(detectedBank);
    }
    const otherBank = BANK_OPTIONS.find((bank) => bank.id === "outro-banco");
    if (preferred.length && otherBank && !preferred.some((bank) => bank.id === otherBank.id)) {
      preferred.push(otherBank);
    }
    return preferred.length ? preferred : [...BANK_OPTIONS];
  }, [detectedBank, registeredBankNames]);
  const income = result.rows.filter((row) => row.type === "income").reduce((sum, row) => sum + row.amount_cents, 0);
  const expense = result.rows.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount_cents, 0);
  const partial = income - expense;
  const balanceConfidence: StatementBalanceConfidence = result.finalBalanceConfidence;
  const accountBalance = result.finalBalanceCents;
  const balanceSummaryLabel = balanceConfidence === "confirmed"
    ? "Saldo final confirmado"
    : balanceConfidence === "derived"
      ? "Saldo final estimado"
      : "Resultado do arquivo";
  const balanceSummaryValue = accountBalance ?? partial;
  const hasFile = Boolean(file);
  const conflictLineSet = useMemo(() => new Set(conflictLines), [conflictLines]);
  const categorySuggestions = useMemo(() => {
    const suggestions = new Map<string, StatementCategorySuggestion>();
    for (const row of result.rows) {
      const suggestion = suggestStatementCategory(row, categories, categoryRules);
      if (suggestion) suggestions.set(row.key, suggestion);
    }
    return suggestions;
  }, [categories, categoryRules, result.rows]);
  const similarityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of result.rows) {
      if (conflictLineSet.has(row.rawLine)) continue;
      const key = `${row.type}:${statementSimilarityKey(row.note)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [conflictLineSet, result.rows]);
  const importableCount = result.rows.filter((row) => !conflictLineSet.has(row.rawLine)).length;
  const categorizedCount = result.rows.filter(
    (row) => !conflictLineSet.has(row.rawLine) && Boolean(categoryAssignments[row.key])
  ).length;
  const availableSuggestionCount = result.rows.filter(
    (row) =>
      !conflictLineSet.has(row.rawLine) &&
      !Object.prototype.hasOwnProperty.call(categoryAssignments, row.key) &&
      categorySuggestions.has(row.key)
  ).length;
  const partialConflict = conflictLines.length > 0 && !duplicateImport;
  const previewRows = showAllPreview ? result.rows : result.rows.slice(0, 8);
  const pickerCategories = categoryPickerRow
    ? categories.filter((category) => category.flow === categoryPickerRow.type)
    : [];
  const pickerCategoryId = categoryPickerRow
    ? categoryAssignments[categoryPickerRow.key] ?? null
    : null;
  const importDisabled =
    busy ||
    checkingDuplicate ||
    Boolean(duplicateImport) ||
    Boolean(duplicateCheckError) ||
    importableCount < 1 ||
    !selectedBankId ||
    !fileHash;

  useEffect(() => {
    let active = true;

    setDuplicateImport(null);
    setConflictLines([]);
    setDuplicateCheckError("");

    if (!householdId || !fileHash || !result.rows.length) {
      setCheckingDuplicate(false);
      return () => {
        active = false;
      };
    }

    setCheckingDuplicate(true);
    Promise.all([
      findStatementImportByHash(householdId, fileHash),
      findStatementImportConflicts(householdId, result.rows),
    ])
      .then(([existingImport, conflictingLines]) => {
        if (!active) return;
        setDuplicateImport(existingImport);
        setConflictLines(conflictingLines);
      })
      .catch((error: any) => {
        if (active) setDuplicateCheckError(error?.message ?? "Não foi possível verificar o histórico de importações.");
      })
      .finally(() => {
        if (active) setCheckingDuplicate(false);
      });

    return () => {
      active = false;
    };
  }, [fileHash, householdId, result.rows]);

  useEffect(() => {
    let active = true;

    if (!householdId) {
      setCategories([]);
      setCategoryRules([]);
      setCategoriesLoading(false);
      return () => {
        active = false;
      };
    }

    setCategoriesLoading(true);
    setCategoriesError("");
    Promise.all([
      listCategories(householdId),
      listStatementCategoryRules(householdId),
    ])
      .then(([items, learnedRules]) => {
        if (!active) return;
        setCategories(items);
        setCategoryRules(learnedRules);
      })
      .catch((error: any) => {
        if (active) setCategoriesError(error?.message ?? "Não foi possível carregar suas categorias.");
      })
      .finally(() => {
        if (active) setCategoriesLoading(false);
      });

    return () => {
      active = false;
    };
  }, [householdId]);

  useEffect(() => {
    if (!categorySuggestions.size) return;

    const automaticCandidates = result.rows.filter(
      (row) =>
        !conflictLineSet.has(row.rawLine) &&
        categorySuggestions.get(row.key)?.confidence === "high"
    );
    if (!automaticCandidates.length) return;

    setCategoryAssignments((current) => {
      const next = { ...current };
      let changed = false;

      for (const row of automaticCandidates) {
        if (Object.prototype.hasOwnProperty.call(next, row.key)) continue;
        next[row.key] = categorySuggestions.get(row.key)?.categoryId ?? null;
        changed = true;
      }

      return changed ? next : current;
    });

    setAutoSuggestedRows((current) => {
      const next = new Set(current);
      let changed = false;
      for (const row of automaticCandidates) {
        if (
          Object.prototype.hasOwnProperty.call(categoryAssignments, row.key) ||
          next.has(row.key)
        ) continue;
        next.add(row.key);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [categoryAssignments, categorySuggestions, conflictLineSet, result.rows]);

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
      const hash = await hashStatementContent(content);
      const fileName = asset.name || "extrato.csv";
      const parsed = parseCsv(content, { fileName });
      setCsv(content);
      setFile({ name: fileName, size: asset.size });
      setFileHash(hash);
      setSelectedBankId(null);
      setBankPickerOpen(parsed.rows.length > 0);
      setCategoryAssignments({});
      setPendingCategoryRules({});
      setAutoSuggestedRows(new Set());
      setCategoryPickerRow(null);
      setShowAllPreview(false);
    } catch (error: any) {
      Alert.alert("Erro", error?.message ?? "Não foi possível ler o arquivo CSV.");
    } finally {
      setReading(false);
    }
  }

  function clearFile() {
    setCsv("");
    setFile(null);
    setFileHash(null);
    setSelectedBankId(null);
    setBankPickerOpen(false);
    setDuplicateImport(null);
    setConflictLines([]);
    setCategoryAssignments({});
    setPendingCategoryRules({});
    setAutoSuggestedRows(new Set());
    setCategoryPickerRow(null);
    setDuplicateCheckError("");
    setShowAllPreview(false);
  }

  function setRowCategory(row: ParsedCsvTx, categoryId: string | null) {
    setCategoryAssignments((current) => ({ ...current, [row.key]: categoryId }));
    setAutoSuggestedRows((current) => {
      const next = new Set(current);
      next.delete(row.key);
      return next;
    });

    const ruleKey = `${row.type}:${statementSimilarityKey(row.note)}`;
    setPendingCategoryRules((current) => {
      if (!current[ruleKey]) return current;
      const next = { ...current };
      if (categoryId) next[ruleKey] = {
        flow: row.type,
        match_key: statementSimilarityKey(row.note),
        category_id: categoryId,
      };
      else delete next[ruleKey];
      return next;
    });
  }

  function choosePickerCategory(categoryId: string | null) {
    if (!categoryPickerRow) return;
    setRowCategory(categoryPickerRow, categoryId);
    setCategoryPickerRow(null);
  }

  function applyCategoryToSimilar(row: ParsedCsvTx) {
    const categoryId = categoryAssignments[row.key];
    if (!categoryId) return;
    const similarityKey = statementSimilarityKey(row.note);
    const ruleKey = `${row.type}:${similarityKey}`;

    setCategoryAssignments((current) => {
      const next = { ...current };
      for (const candidate of result.rows) {
        if (candidate.type !== row.type || conflictLineSet.has(candidate.rawLine)) continue;
        if (statementSimilarityKey(candidate.note) === similarityKey) {
          next[candidate.key] = categoryId;
        }
      }
      return next;
    });
    setAutoSuggestedRows((current) => {
      const next = new Set(current);
      for (const candidate of result.rows) {
        if (
          candidate.type === row.type &&
          statementSimilarityKey(candidate.note) === similarityKey
        ) next.delete(candidate.key);
      }
      return next;
    });
    setPendingCategoryRules((current) => ({
      ...current,
      [ruleKey]: {
        flow: row.type,
        match_key: similarityKey,
        category_id: categoryId,
      },
    }));
  }

  function acceptAllSuggestions() {
    setCategoryAssignments((current) => {
      const next = { ...current };
      for (const row of result.rows) {
        if (
          conflictLineSet.has(row.rawLine) ||
          Object.prototype.hasOwnProperty.call(next, row.key)
        ) continue;
        const suggestion = categorySuggestions.get(row.key);
        if (suggestion) next[row.key] = suggestion.categoryId;
      }
      return next;
    });
  }

  async function importRows() {
    if (!userId || !householdId) return Alert.alert("Atenção", "Entre em uma casa antes de importar.");
    if (!result.rows.length) return Alert.alert("Atenção", "Não há transações válidas para importar.");
    if (!file || !fileHash) return Alert.alert("Atenção", "A identificação do arquivo ainda não está disponível.");
    if (!selectedBankId) {
      setBankPickerOpen(true);
      return Alert.alert("Escolha o banco", "Informe de qual banco é este extrato antes de importar.");
    }
    if (checkingDuplicate) return Alert.alert("Atenção", "Aguarde a verificação do arquivo.");
    if (duplicateImport) return Alert.alert("Arquivo já importado", "Escolha outro extrato para continuar.");
    if (busy) return;

    try {
      setBusy(true);
      const importResult = await importStatement({
        householdId,
        fileHash,
        fileName: file.name,
        bankId: selectedBankId,
        initialBalanceCents: result.initialBalanceCents,
        finalBalanceCents: accountBalance,
        balanceConfidence,
        rejectedCount: result.rejectedRows,
        rows: result.rows.map((row) => ({
          ...row,
          categoryId: categoryAssignments[row.key] ?? null,
        })),
        categoryRules: Object.values(pendingCategoryRules),
      });

      const completionParts = [
        `${importResult.imported_count} movimentação(ões) do ${selectedBank?.name ?? "banco selecionado"} foram salvas`,
      ];
      if (importResult.skipped_count) {
        completionParts.push(`${importResult.skipped_count} repetida(s) foram ignoradas`);
      }
      if (importResult.rejected_count) {
        completionParts.push(`${importResult.rejected_count} linha(s) inválida(s) foram rejeitadas`);
      }
      if (importResult.categorized_count) {
        completionParts.push(`${importResult.categorized_count} movimentação(ões) foram categorizadas`);
      }
      if (importResult.learned_rules_count) {
        completionParts.push(`${importResult.learned_rules_count} regra(s) foram lembradas`);
      }

      const importCycleDate = importResult.imported_period_end ?? result.rows
        .filter((row) => !conflictLineSet.has(row.rawLine))
        .reduce(
        (latest, row) => row.occurred_on > latest ? row.occurred_on : latest,
        ""
      );

      clearFile();
      Alert.alert(
        "Importação concluída",
        `${completionParts.join("; ")}.`,
        [
          {
            text: "Ver movimentações",
            onPress: () => router.replace({
              pathname: "/(app)/transaction-history",
              params: { importId: importResult.import_id },
            }),
          },
          {
            text: "Ir para Controle",
            onPress: () => router.replace({
              pathname: "/(app)/journey",
              params: importCycleDate ? { tab: "controle", cycleDate: importCycleDate } : { tab: "controle" },
            }),
          },
        ]
      );
    } catch (error: any) {
      if (isDuplicateStatementError(error)) {
        const existingImport = await findStatementImportByHash(householdId, fileHash).catch(() => null);
        setDuplicateImport(existingImport);
        Alert.alert(
          "Nada novo para importar",
          existingImport
            ? "Este mesmo arquivo já consta no histórico desta conta."
            : "Todas as movimentações deste arquivo já existem no app."
        );
        return;
      }
      Alert.alert("Erro", error?.message ?? "Falha ao importar CSV.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <OnboardingShell light>
      <>
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
              <View style={styles.bankSelectionHeader}>
                <View style={[styles.bankSelectionIcon, selectedBank && { backgroundColor: `${selectedBank.color}18` }]}>
                  <Ionicons name="business-outline" size={20} color={selectedBank?.color ?? OB.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Banco do extrato</Text>
                  <Text style={styles.bankSelectionSubtitle}>Essa informação identifica a origem das movimentações.</Text>
                </View>
                <View style={styles.requiredBadge}>
                  <Text style={styles.requiredBadgeText}>Obrigatório</Text>
                </View>
              </View>

              <Pressable
                onPress={() => setBankPickerOpen(true)}
                style={({ pressed }) => [styles.bankSelectionButton, selectedBank && styles.bankSelectionButtonSelected, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Escolher banco do extrato"
              >
                <BankLogo
                  bankId={selectedBank?.id ?? "unknown"}
                  size={42}
                  color={selectedBank?.color ?? OB.support}
                  shortName={selectedBank?.shortName ?? "?"}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bankSelectionCaption}>{selectedBank ? "Banco confirmado" : "Selecione o banco"}</Text>
                  <Text style={styles.bankSelectionName}>{selectedBank?.name ?? "De qual banco é este CSV?"}</Text>
                </View>
                <Text style={styles.bankSelectionAction}>{selectedBank ? "Alterar" : "Escolher"}</Text>
                <Ionicons name="chevron-forward" size={17} color={OB.primary} />
              </Pressable>

              {detectedBank && !selectedBank ? (
                <View style={styles.bankDetectionHint}>
                  <Ionicons name="sparkles-outline" size={14} color="#175CD3" />
                  <Text style={styles.bankDetectionHintText}>O arquivo parece ser do {detectedBank.name}. Confirme antes de continuar.</Text>
                </View>
              ) : null}
            </View>

            {checkingDuplicate ? (
              <View style={styles.infoCard}>
                <ActivityIndicator size="small" color={OB.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoTitle}>Verificando o arquivo</Text>
                  <Text style={styles.infoText}>Consultando o histórico para evitar transações duplicadas.</Text>
                </View>
              </View>
            ) : duplicateImport ? (
              <View style={styles.duplicateBox}>
                <Ionicons name="copy-outline" size={21} color="#9A3412" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.duplicateTitle}>Este arquivo já foi importado</Text>
                  <Text style={styles.duplicateText}>
                    {duplicateImport.transaction_count} transações de {formatDateBRFromYMD(duplicateImport.period_start)} a {formatDateBRFromYMD(duplicateImport.period_end)} já constam no app.
                  </Text>
                </View>
              </View>
            ) : partialConflict ? (
              <View style={styles.conflictBox}>
                <Ionicons name="git-compare-outline" size={21} color="#175CD3" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.conflictTitle}>
                    {importableCount
                      ? "Encontramos movimentações já existentes"
                      : "Todas as movimentações já existem"}
                  </Text>
                  <Text style={styles.conflictText}>
                    {importableCount
                      ? `${importableCount} nova(s) serão importadas e ${conflictLines.length} repetida(s) serão ignoradas.`
                      : `${conflictLines.length} movimentação(ões) já constam no app. Nada será duplicado.`}
                  </Text>
                </View>
              </View>
            ) : duplicateCheckError ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>• {duplicateCheckError}</Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Resumo da leitura</Text>
              <View style={styles.summaryGrid}>
                <SummaryPill label="Válidas" value={String(result.rows.length)} tone="primary" />
                <SummaryPill label="Entradas" value={formatBRLFromCents(income)} tone="good" />
                <SummaryPill label="Saídas" value={formatBRLFromCents(expense)} tone="bad" />
                <SummaryPill
                  label={balanceSummaryLabel}
                  value={formatBRLFromCents(balanceSummaryValue)}
                  tone={balanceSummaryValue < 0 ? "bad" : "good"}
                />
              </View>

              <Text style={styles.mutedText}>
                {balanceConfidence === "confirmed"
                  ? "O saldo final foi informado pelo próprio extrato."
                  : balanceConfidence === "derived"
                    ? "Saldo final identificado a partir do saldo após os lançamentos ou estimado pelas movimentações do arquivo."
                    : "O resultado do arquivo é apenas a diferença entre entradas e saídas; não representa o saldo bancário da conta."}
              </Text>

              {result.ignoredRows ? (
                <Text style={styles.mutedText}>{result.ignoredRows} lançamento(s) BB Rende Fácil ignorado(s), pois são aplicação ou resgate automático.</Text>
              ) : null}

              {result.errors.length ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorTitle}>
                    {result.rejectedRows
                      ? `${result.rejectedRows} linha(s) inválida(s) não serão importadas`
                      : "O arquivo precisa de atenção"}
                  </Text>
                  {result.errors.slice(0, 5).map((error) => (
                    <Text key={error} style={styles.errorText}>• {error}</Text>
                  ))}
                  {result.errors.length > 5 ? <Text style={styles.mutedText}>Mais {result.errors.length - 5} avisos encontrados.</Text> : null}
                </View>
              ) : duplicateImport ? (
                <Text style={styles.mutedText}>A importação foi bloqueada para não duplicar suas movimentações.</Text>
              ) : partialConflict ? (
                <Text style={styles.mutedText}>Somente as {importableCount} movimentações novas serão salvas.</Text>
              ) : (
                <Text style={styles.mutedText}>Tudo certo para importar.</Text>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.categorySummaryHeader}>
                <View style={styles.categorySummaryIcon}>
                  <Ionicons name="pricetags-outline" size={19} color={OB.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>Revisar categorias</Text>
                  <Text style={styles.categorySummaryText}>
                    {categoriesLoading
                      ? "Carregando suas categorias..."
                      : categoriesError
                        ? "As categorias não puderam ser carregadas."
                        : categories.length
                          ? `${categorizedCount} de ${importableCount} movimentação(ões) confirmada(s)`
                          : "Você ainda não possui categorias cadastradas."}
                  </Text>
                </View>
                {categoriesLoading ? <ActivityIndicator size="small" color={OB.primary} /> : null}
              </View>

              {categoriesError ? <Text style={styles.categoryErrorText}>{categoriesError}</Text> : null}

              {!categoriesLoading && !categoriesError && categories.length ? (
                <>
                  <Text style={styles.mutedText}>
                    Sugestões de alta confiança já vêm selecionadas, mas você pode alterar todas antes de importar.
                  </Text>
                  {Object.keys(pendingCategoryRules).length ? (
                    <Text style={styles.learnedRulesPendingText}>
                      {Object.keys(pendingCategoryRules).length} regra(s) serão lembradas nesta casa.
                    </Text>
                  ) : null}
                  {availableSuggestionCount ? (
                    <Pressable onPress={acceptAllSuggestions} style={styles.acceptSuggestionsButton}>
                      <Ionicons name="sparkles-outline" size={15} color="#175CD3" />
                      <Text style={styles.acceptSuggestionsText}>
                        Aceitar {availableSuggestionCount} sugestão(ões)
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : !categoriesLoading && !categoriesError ? (
                <Pressable onPress={() => router.push("/(app)/categories")} style={styles.manageCategoriesButton}>
                  <Text style={styles.manageCategoriesText}>Criar categorias</Text>
                  <Ionicons name="chevron-forward" size={15} color={OB.primary} />
                </Pressable>
              ) : null}
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
                <PreviewRow
                  key={row.key}
                  row={row}
                  conflict={conflictLineSet.has(row.rawLine)}
                  categories={categories}
                  categoryId={categoryAssignments[row.key] ?? null}
                  autoSuggested={autoSuggestedRows.has(row.key)}
                  suggestion={
                    Object.prototype.hasOwnProperty.call(categoryAssignments, row.key)
                      ? null
                      : categorySuggestions.get(row.key) ?? null
                  }
                  similarCount={
                    similarityCounts.get(`${row.type}:${statementSimilarityKey(row.note)}`) ?? 1
                  }
                  onCategoryChange={(categoryId) => setRowCategory(row, categoryId)}
                  onOpenCategoryPicker={() => setCategoryPickerRow(row)}
                  onApplySimilar={() => applyCategoryToSimilar(row)}
                />
              ))}

              {result.rows.length > 8 && !showAllPreview ? (
                <Pressable onPress={() => setShowAllPreview(true)} style={styles.moreButton}>
                  <Text style={styles.moreText}>Ver mais {result.rows.length - 8} linhas</Text>
                </Pressable>
              ) : null}
              {!result.rows.length ? <Text style={styles.mutedText}>Nenhuma linha válida encontrada neste arquivo.</Text> : null}
            </View>

            <Pressable onPress={importRows} disabled={importDisabled} style={[styles.importButton, importDisabled && styles.importButtonDisabled]}>
              <Text style={[styles.importText, importDisabled && styles.importTextDisabled]}>
                {busy
                  ? "Importando..."
                  : checkingDuplicate
                    ? "Verificando arquivo..."
                    : duplicateImport
                      ? "Arquivo já importado"
                      : partialConflict
                        ? importableCount
                          ? `Importar ${importableCount} nova(s)`
                          : "Nada novo para importar"
                        : result.rejectedRows
                          ? `Importar ${importableCount} válida(s)`
                          : "Importar transações"}
              </Text>
            </Pressable>
          </>
        )}
        </ScrollView>

        <Modal visible={Boolean(categoryPickerRow)} transparent animationType="fade" onRequestClose={() => setCategoryPickerRow(null)}>
          <Pressable style={styles.categoryPickerBackdrop} onPress={() => setCategoryPickerRow(null)}>
            <Pressable style={styles.categoryPickerCard} onPress={(event) => event.stopPropagation()}>
              <View style={styles.categoryPickerHeader}>
                <View style={styles.categoryPickerHeaderIcon}>
                  <Ionicons name="pricetags-outline" size={20} color={OB.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.categoryPickerTitle}>Escolher categoria</Text>
                  <Text style={styles.categoryPickerSubtitle} numberOfLines={2}>
                    {categoryPickerRow?.note}
                  </Text>
                </View>
                <Pressable onPress={() => setCategoryPickerRow(null)} style={styles.categoryPickerClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fechar">
                  <Ionicons name="close" size={20} color={OB.support} />
                </Pressable>
              </View>

              <ScrollView style={styles.categoryPickerScroll} contentContainerStyle={styles.categoryPickerContent} showsVerticalScrollIndicator={false}>
                <Pressable
                  onPress={() => choosePickerCategory(null)}
                  style={({ pressed }) => [
                    styles.categoryPickerOption,
                    !pickerCategoryId && styles.categoryPickerOptionActive,
                    pressed && styles.categoryPickerOptionPressed,
                  ]}
                >
                  <View style={[styles.categoryPickerOptionIcon, !pickerCategoryId && styles.categoryPickerOptionIconActive]}>
                    <Ionicons name="remove-circle-outline" size={18} color={!pickerCategoryId ? "#fff" : OB.support} />
                  </View>
                  <Text style={[styles.categoryPickerOptionText, !pickerCategoryId && styles.categoryPickerOptionTextActive]}>Sem categoria</Text>
                  {!pickerCategoryId ? <Ionicons name="checkmark-circle" size={20} color="#fff" /> : null}
                </Pressable>

                {(["fixed", "variable"] as Kind[]).map((pickerKind) => {
                  const groupCategories = pickerCategories.filter((category) => category.kind === pickerKind);
                  if (!groupCategories.length) return null;
                  const isIncome = categoryPickerRow?.type === "income";
                  const groupTitle = isIncome
                    ? pickerKind === "fixed" ? "Entradas fixas" : "Entradas variáveis"
                    : pickerKind === "fixed" ? "Saídas fixas" : "Saídas variáveis";

                  return (
                    <View key={pickerKind} style={styles.categoryPickerGroup}>
                      <Text style={styles.categoryPickerGroupTitle}>{groupTitle}</Text>
                      {groupCategories.map((category) => {
                        const active = category.id === pickerCategoryId;
                        return (
                          <Pressable
                            key={category.id}
                            onPress={() => choosePickerCategory(category.id)}
                            style={({ pressed }) => [
                              styles.categoryPickerOption,
                              active && styles.categoryPickerOptionActive,
                              pressed && styles.categoryPickerOptionPressed,
                            ]}
                          >
                            <View style={[styles.categoryPickerOptionIcon, active && styles.categoryPickerOptionIconActive]}>
                              <Ionicons name={(category.icon || "pricetag-outline") as any} size={18} color={active ? "#fff" : OB.primary} />
                            </View>
                            <Text style={[styles.categoryPickerOptionText, active && styles.categoryPickerOptionTextActive]}>{category.name}</Text>
                            {active ? <Ionicons name="checkmark-circle" size={20} color="#fff" /> : <Ionicons name="chevron-forward" size={17} color={OB.support} />}
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal visible={bankPickerOpen && hasFile} transparent animationType="fade" onRequestClose={() => setBankPickerOpen(false)}>
          <Pressable style={styles.categoryPickerBackdrop} onPress={() => setBankPickerOpen(false)}>
            <Pressable style={styles.bankPickerCard} onPress={(event) => event.stopPropagation()}>
              <View style={styles.categoryPickerHeader}>
                <View style={styles.categoryPickerHeaderIcon}>
                  <Ionicons name="business-outline" size={20} color={OB.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.categoryPickerTitle}>De qual banco é este CSV?</Text>
                  <Text style={styles.categoryPickerSubtitle}>Escolha o banco para identificar a origem das movimentações.</Text>
                </View>
                <Pressable onPress={() => setBankPickerOpen(false)} style={styles.categoryPickerClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fechar">
                  <Ionicons name="close" size={20} color={OB.support} />
                </Pressable>
              </View>

              <ScrollView style={styles.bankPickerScroll} contentContainerStyle={styles.bankPickerContent} showsVerticalScrollIndicator={false}>
                {bankOptions.map((bank) => {
                  const active = bank.id === selectedBankId;
                  const detected = bank.id === result.detectedBankId;
                  const registered = registeredBankNames.includes(bank.name);
                  return (
                    <Pressable
                      key={bank.id}
                      onPress={() => {
                        setSelectedBankId(bank.id);
                        setBankPickerOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.bankPickerOption,
                        active && { borderColor: bank.color, backgroundColor: `${bank.color}12` },
                        pressed && styles.categoryPickerOptionPressed,
                      ]}
                    >
                      <BankLogo bankId={bank.id} size={42} color={bank.color} shortName={bank.shortName} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.bankPickerName}>{bank.name}</Text>
                        <View style={styles.bankPickerBadges}>
                          {registered ? <Text style={styles.registeredBankText}>Cadastrado</Text> : null}
                          {detected ? <Text style={styles.detectedBankText}>Identificado no arquivo</Text> : null}
                        </View>
                      </View>
                      {active ? <Ionicons name="checkmark-circle" size={21} color={bank.color} /> : <Ionicons name="chevron-forward" size={18} color={OB.support} />}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      </>
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
  bankSelectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bankSelectionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.14)",
  },
  bankSelectionSubtitle: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 14,
    marginTop: 3,
  },
  requiredBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 5,
    backgroundColor: "#FFF4F2",
    borderWidth: 1,
    borderColor: "#FDA29B",
  },
  requiredBadgeText: {
    color: "#B42318",
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  bankSelectionButton: {
    minHeight: 64,
    borderRadius: 16,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFAEB",
    borderWidth: 1.5,
    borderColor: "#FEC84B",
  },
  bankSelectionButtonSelected: {
    backgroundColor: OB.offWhite,
    borderColor: OB.supportSoft,
  },
  bankSelectionCaption: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  bankSelectionName: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
    marginTop: 3,
  },
  bankSelectionAction: {
    color: OB.primary,
    fontSize: 10,
    fontWeight: "900",
  },
  bankDetectionHint: {
    minHeight: 34,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#EFF8FF",
  },
  bankDetectionHintText: {
    flex: 1,
    color: "#175CD3",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 14,
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
    minHeight: 28,
    color: OB.support,
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 14,
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
  errorTitle: {
    color: "#92400E",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 17,
  },
  duplicateBox: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDBA74",
  },
  duplicateTitle: {
    color: "#9A3412",
    fontSize: 13,
    fontWeight: "900",
  },
  duplicateText: {
    color: "#C2410C",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 4,
  },
  conflictBox: {
    borderRadius: 18,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "#EFF8FF",
    borderWidth: 1,
    borderColor: "#84CAFF",
  },
  conflictTitle: {
    color: "#175CD3",
    fontSize: 13,
    fontWeight: "900",
  },
  conflictText: {
    color: "#1849A9",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 4,
  },
  categorySummaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  categorySummaryIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,160,200,0.14)",
  },
  categorySummaryText: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
    marginTop: 3,
  },
  categoryErrorText: {
    color: "#B42318",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
  },
  acceptSuggestionsButton: {
    minHeight: 43,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#EFF8FF",
    borderWidth: 1,
    borderColor: "#84CAFF",
  },
  acceptSuggestionsText: {
    color: "#175CD3",
    fontSize: 11,
    fontWeight: "900",
  },
  manageCategoriesButton: {
    minHeight: 43,
    borderRadius: 13,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(123,160,200,0.14)",
  },
  manageCategoriesText: {
    color: OB.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  learnedRulesPendingText: {
    color: "#175CD3",
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 15,
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
    gap: 10,
  },
  previewRowConflict: {
    opacity: 0.62,
  },
  previewMain: {
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
  conflictBadge: {
    alignSelf: "flex-start",
    color: "#175CD3",
    fontSize: 9,
    fontWeight: "900",
    marginTop: 5,
  },
  previewAmount: {
    fontSize: 13,
    fontWeight: "900",
  },
  categoryReview: {
    gap: 8,
    borderRadius: 13,
    padding: 10,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  categoryReviewHeader: {
    minHeight: 25,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  categoryReviewLabel: {
    color: OB.primary,
    fontSize: 10,
    fontWeight: "900",
  },
  autoSuggestionLabel: {
    color: "#178A55",
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  suggestionButton: {
    maxWidth: "76%",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#EFF8FF",
    borderWidth: 1,
    borderColor: "#84CAFF",
  },
  suggestionText: {
    color: "#175CD3",
    fontSize: 9,
    fontWeight: "900",
  },
  categorySelectButton: {
    minHeight: 58,
    borderRadius: 14,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  categorySelectButtonPressed: {
    backgroundColor: "rgba(123,160,200,0.12)",
    transform: [{ scale: 0.99 }],
  },
  categorySelectIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  categorySelectIconActive: {
    backgroundColor: OB.primary,
  },
  categorySelectCaption: {
    color: OB.support,
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  categorySelectName: {
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 2,
  },
  categorySelectAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  categorySelectActionText: {
    color: OB.primary,
    fontSize: 10,
    fontWeight: "900",
  },
  applySimilarButton: {
    alignSelf: "flex-start",
    minHeight: 30,
    borderRadius: 10,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(123,160,200,0.16)",
  },
  applySimilarText: {
    color: OB.primary,
    fontSize: 9,
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
  categoryPickerBackdrop: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
    backgroundColor: "rgba(7, 18, 38, 0.62)",
  },
  categoryPickerCard: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "82%",
    alignSelf: "center",
    borderRadius: 22,
    padding: 18,
    gap: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  categoryPickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  categoryPickerHeaderIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  categoryPickerTitle: {
    color: OB.primary,
    fontSize: 17,
    fontWeight: "900",
  },
  categoryPickerSubtitle: {
    color: OB.support,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
    marginTop: 2,
  },
  categoryPickerClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: OB.offWhite,
  },
  categoryPickerScroll: {
    flexGrow: 0,
  },
  categoryPickerContent: {
    gap: 12,
    paddingBottom: 2,
  },
  categoryPickerGroup: {
    gap: 8,
  },
  categoryPickerGroupTitle: {
    color: OB.support,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.9,
    textTransform: "uppercase",
    paddingHorizontal: 2,
  },
  categoryPickerOption: {
    minHeight: 54,
    borderRadius: 15,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: OB.offWhite,
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  categoryPickerOptionActive: {
    backgroundColor: OB.primary,
    borderColor: OB.primary,
  },
  categoryPickerOptionPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  categoryPickerOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  categoryPickerOptionIconActive: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  categoryPickerOptionText: {
    flex: 1,
    color: OB.primary,
    fontSize: 13,
    fontWeight: "900",
  },
  categoryPickerOptionTextActive: {
    color: "#fff",
  },
  bankPickerCard: {
    width: "100%",
    maxWidth: 460,
    maxHeight: "82%",
    alignSelf: "center",
    borderRadius: 22,
    padding: 18,
    gap: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: OB.supportSoft,
  },
  bankPickerScroll: {
    flexGrow: 0,
  },
  bankPickerContent: {
    gap: 9,
    paddingBottom: 2,
  },
  bankPickerOption: {
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: OB.offWhite,
    borderWidth: 1.5,
    borderColor: OB.supportSoft,
  },
  bankPickerName: {
    color: OB.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  bankPickerBadges: {
    minHeight: 15,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 4,
  },
  registeredBankText: {
    color: "#178A55",
    fontSize: 9,
    fontWeight: "900",
  },
  detectedBankText: {
    color: "#175CD3",
    fontSize: 9,
    fontWeight: "900",
  },
});
