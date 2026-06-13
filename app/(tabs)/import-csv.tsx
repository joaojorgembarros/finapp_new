// app/(tabs)/import-csv.tsx
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import Screen from "../../src/ui/Screen";
import { AppHeader, Button, Card, Label, P, Row } from "../../src/ui/components";
import { theme } from "../../src/ui/theme";
import { useSession } from "../../src/providers/SessionProvider";
import { useHouseholdId } from "../../src/hooks/useHousehold";
import { addTransaction, TxType } from "../../src/lib/transactions";
import { formatBRLFromCents, formatDateBRFromYMD, parseBRLToCents } from "../../src/lib/format";
import { emitTxChanged } from "../../src/lib/bus";

type ParsedTx = {
  key: string;
  occurred_on: string;
  note: string;
  amount_cents: number;
  type: TxType;
  rawLine: number;
};

type ParseResult = {
  rows: ParsedTx[];
  errors: string[];
  ignoredRows: number;
  initialBalanceCents: number | null;
  finalBalanceCents: number | null;
};

type PickedFile = {
  name: string;
  size?: number | null;
};

const cp1252Controls: Record<number, string> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};

function base64ToBytes(base64: string) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean[i] ?? "A");
    const b = chars.indexOf(clean[i + 1] ?? "A");
    const c = clean[i + 2] === "=" ? -1 : chars.indexOf(clean[i + 2] ?? "A");
    const d = clean[i + 3] === "=" ? -1 : chars.indexOf(clean[i + 3] ?? "A");
    const chunk = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);

    bytes.push((chunk >> 16) & 255);
    if (c >= 0) bytes.push((chunk >> 8) & 255);
    if (d >= 0) bytes.push(chunk & 255);
  }

  return bytes;
}

function decodeUtf8(bytes: number[]) {
  let text = "";

  for (let i = 0; i < bytes.length; i += 1) {
    const b1 = bytes[i];

    if (b1 < 0x80) {
      text += String.fromCharCode(b1);
      continue;
    }

    if (b1 >= 0xc2 && b1 <= 0xdf) {
      const b2 = bytes[i + 1];
      if ((b2 & 0xc0) !== 0x80) return null;
      text += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
      i += 1;
      continue;
    }

    if (b1 >= 0xe0 && b1 <= 0xef) {
      const b2 = bytes[i + 1];
      const b3 = bytes[i + 2];
      if ((b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return null;
      text += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
      i += 2;
      continue;
    }

    if (b1 >= 0xf0 && b1 <= 0xf4) {
      const b2 = bytes[i + 1];
      const b3 = bytes[i + 2];
      const b4 = bytes[i + 3];
      if ((b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80 || (b4 & 0xc0) !== 0x80) return null;
      text += String.fromCodePoint(((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f));
      i += 3;
      continue;
    }

    return null;
  }

  return text;
}

function decodeWindows1252(bytes: number[]) {
  return bytes.map((byte) => cp1252Controls[byte] ?? String.fromCharCode(byte)).join("");
}

async function readCsvText(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = base64ToBytes(base64);
  return decodeUtf8(bytes) ?? decodeWindows1252(bytes);
}

function splitCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }

  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, "").trim());
}

function normalizeHeader(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function findColumn(headers: string[], names: string[]) {
  return headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    return names.some((name) => normalized === name || normalized.includes(name));
  });
}

function findColumns(headers: string[], names: string[]) {
  return headers
    .map((header, index) => {
      const normalized = normalizeHeader(header);
      return names.some((name) => normalized === name || normalized.includes(name)) ? index : -1;
    })
    .filter((index) => index >= 0);
}

function parseDate(value: string) {
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;

  const br = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/);
  if (!br) return null;

  const day = Number(br[1]);
  const month = Number(br[2]);
  const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseType(typeText: string, cents: number): TxType {
  const value = normalizeHeader(typeText);
  if (["entrada", "receita", "income", "credito", "credit"].includes(value)) return "income";
  if (["saida", "despesa", "expense", "debito", "debit"].includes(value)) return "expense";
  return cents < 0 ? "expense" : "income";
}

function detectDelimiter(firstLine: string) {
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semicolons >= commas ? ";" : ",";
}

function getHeaderInfo(line: string) {
  const delimiter = detectDelimiter(line);
  const headers = splitCsvLine(line, delimiter);
  const dateIdx = findColumn(headers, ["data", "date", "datalancamento", "ocorridoem", "occurredon"]);
  const amountIdx = findColumn(headers, ["valor", "amount", "quantia", "total"]);
  const creditIdx = findColumn(headers, ["credito", "creditor", "creditors", "credit", "entrada", "receita"]);
  const debitIdx = findColumn(headers, ["debito", "debitor", "debitors", "debit", "saida", "despesa"]);
  const balanceIdx = findColumn(headers, ["saldo", "balance", "saldors"]);

  return { delimiter, headers, dateIdx, amountIdx, creditIdx, debitIdx, balanceIdx };
}

function isHeaderInfo(info: ReturnType<typeof getHeaderInfo>) {
  return info.dateIdx >= 0 && (info.amountIdx >= 0 || (info.creditIdx >= 0 && info.debitIdx >= 0));
}

function parseSignedCents(cells: string[], amountIdx: number, creditIdx: number, debitIdx: number) {
  if (amountIdx >= 0) return parseBRLToCents(cells[amountIdx] ?? "");

  const credit = creditIdx >= 0 ? parseBRLToCents(cells[creditIdx] ?? "") : 0;
  const debit = debitIdx >= 0 ? parseBRLToCents(cells[debitIdx] ?? "") : 0;

  if (credit > 0) return credit;
  if (debit > 0) return -debit;
  return 0;
}

function parseCsv(content: string): ParseResult {
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { rows: [], errors: ["O arquivo precisa ter cabecalho e pelo menos uma transacao."], ignoredRows: 0, initialBalanceCents: null, finalBalanceCents: null };
  }

  const errors: string[] = [];
  const rows: ParsedTx[] = [];
  const balanceRows: Array<{ occurred_on: string; rawLine: number; signedCents: number; balanceCents: number }> = [];
  let ignoredRows = 0;
  let baselineBalanceCents: number | null = null;
  let explicitFinalBalanceCents: number | null = null;
  let current:
    | (ReturnType<typeof getHeaderInfo> & {
        noteIndexes: number[];
        typeIdx: number;
      })
    | null = null;
  let foundHeader = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const headerInfo = getHeaderInfo(line);

    if (isHeaderInfo(headerInfo)) {
      foundHeader = true;
      current = {
        ...headerInfo,
        noteIndexes: findColumns(headerInfo.headers, [
          "descricao",
          "descri",
          "historico",
          "histrico",
          "lancamento",
          "lanamento",
          "detalhes",
          "memo",
          "note",
          "titulo",
        ]),
        typeIdx: findColumn(headerInfo.headers, ["tipo", "tipolancamento", "tipolanamento", "type", "natureza"]),
      };
      return;
    }

    if (!current) return;

    const cells = splitCsvLine(line, current.delimiter);
    const occurred_on = parseDate(cells[current.dateIdx] ?? "");
    const signedCents = parseSignedCents(cells, current.amountIdx, current.creditIdx, current.debitIdx);
    const type = parseType(cells[current.typeIdx] ?? "", signedCents);
    const amount_cents = Math.abs(signedCents);
    const note =
      current.noteIndexes
        .map((idx) => cells[idx])
        .filter((cell) => cell?.trim())
        .join(" - ")
        .trim() || `Importado CSV linha ${lineNumber}`;
    const normalizedNote = normalizeHeader(note);
    const isAutomaticInvestment =
      normalizedNote.includes("bbrendefacil") ||
      normalizedNote.includes("rendefacil") ||
      normalizedNote.includes("rendefcil");
    const isBalanceLine =
      ["saldoanterior", "saldododia", "saldo"].includes(normalizedNote) ||
      normalizedNote.startsWith("saldo") ||
      normalizedNote.includes("saldododia");

    if (baselineBalanceCents === null && normalizedNote.includes("saldoanterior")) {
      baselineBalanceCents = signedCents;
      return;
    }

    if (isBalanceLine) {
      explicitFinalBalanceCents = signedCents;
      return;
    }

    if (isAutomaticInvestment) {
      ignoredRows += 1;
      return;
    }

    if (!occurred_on) {
      return;
    }

    if (current.balanceIdx >= 0) {
      balanceRows.push({
        occurred_on,
        rawLine: lineNumber,
        signedCents,
        balanceCents: parseBRLToCents(cells[current.balanceIdx] ?? ""),
      });
    }

    if (baselineBalanceCents === null && normalizedNote.includes("codlanc0") && signedCents === 0) {
      const balanceCell = current.balanceIdx >= 0 ? cells[current.balanceIdx] : cells.filter((cell) => cell?.trim()).at(-1);
      baselineBalanceCents = parseBRLToCents(balanceCell ?? "");
      return;
    }

    if (amount_cents <= 0) {
      return;
    }

    rows.push({
      key: `${lineNumber}-${occurred_on}-${amount_cents}-${note}`,
      occurred_on,
      note,
      amount_cents,
      type,
      rawLine: lineNumber,
    });
  });

  if (!foundHeader) {
    return {
      rows: [],
      errors: ["Nao encontrei o cabecalho do extrato. Procure colunas como data e valor, ou credito e debito."],
      ignoredRows,
      initialBalanceCents: null,
      finalBalanceCents: null,
    };
  }

  const sortedBalanceRows = balanceRows.sort((a, b) =>
    a.occurred_on === b.occurred_on ? a.rawLine - b.rawLine : a.occurred_on.localeCompare(b.occurred_on)
  );
  const firstBalanceRow = sortedBalanceRows[0];
  const initialBalanceCents = baselineBalanceCents ?? (firstBalanceRow
    ? firstBalanceRow.signedCents === 0
      ? firstBalanceRow.balanceCents
      : firstBalanceRow.balanceCents - firstBalanceRow.signedCents
    : null);
  const finalBalanceCents = explicitFinalBalanceCents;

  return { rows, errors, ignoredRows, initialBalanceCents, finalBalanceCents };
}

function formatFileSize(size?: number | null) {
  if (!size) return "Tamanho nao informado";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function SummaryPill({ label, value, tone }: { label: string; value: string; tone: "primary" | "good" | "bad" }) {
  const color = tone === "good" ? theme.colors.good : tone === "bad" ? theme.colors.bad : theme.colors.primary;
  const bg = tone === "good" ? theme.colors.goodSoft : tone === "bad" ? theme.colors.badSoft : theme.colors.primarySoft;
  const compactValue = value.length > 14;

  return (
    <View style={{ width: "48%", minWidth: 132, borderRadius: 14, backgroundColor: bg, padding: 12 }}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.86} style={{ color: theme.colors.muted, fontWeight: "800", fontSize: 11 }}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
        style={{ color, fontWeight: "900", fontSize: compactValue ? 13 : 15, marginTop: 4 }}
      >
        {value}
      </Text>
    </View>
  );
}

function PreviewRow({ row }: { row: ParsedTx }) {
  const isIncome = row.type === "income";

  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Row style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 13 }}>{row.note}</Text>
          <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 11, marginTop: 3 }}>
            Linha {row.rawLine} - {formatDateBRFromYMD(row.occurred_on)}
          </Text>
        </View>
        <Text style={{ color: isIncome ? theme.colors.good : theme.colors.bad, fontWeight: "900", fontSize: 13 }}>
          {isIncome ? "+" : "-"}{formatBRLFromCents(row.amount_cents)}
        </Text>
      </Row>
    </View>
  );
}

export default function ImportCsv() {
  const { userId } = useSession();
  const { householdId } = useHouseholdId(userId);
  const [csv, setCsv] = useState("");
  const [file, setFile] = useState<PickedFile | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAllPreview, setShowAllPreview] = useState(false);

  const result = useMemo(() => (csv ? parseCsv(csv) : { rows: [], errors: [], ignoredRows: 0, initialBalanceCents: null, finalBalanceCents: null }), [csv]);
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
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Nao foi possivel ler o arquivo CSV.");
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

  async function onImport() {
    if (!userId || !householdId) return Alert.alert("Atencao", "Entre em uma casa antes de importar.");
    if (!result.rows.length) return Alert.alert("Atencao", "Nao ha transacoes validas para importar.");
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

      emitTxChanged({ householdId });
      Alert.alert("Importacao concluida", `${result.rows.length} transacoes foram salvas.`);
      clearFile();
    } catch (e: any) {
      Alert.alert("Erro", e?.message ?? "Falha ao importar CSV.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <AppHeader title="Importar CSV" subtitle="Selecione o arquivo do banco e confira a previa antes de salvar" />

      <Card>
        <Pressable
          onPress={pickCsv}
          disabled={reading || busy}
          style={({ pressed }) => ({
            minHeight: 190,
            borderRadius: 18,
            borderWidth: 1.5,
            borderStyle: "dashed",
            borderColor: hasFile ? theme.colors.primary : "#93c5fd",
            backgroundColor: hasFile ? "rgba(219,234,254,0.58)" : "rgba(239,246,255,0.76)",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            opacity: pressed ? 0.86 : 1,
          })}
        >
          <View
            style={{
              width: 62,
              height: 62,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: hasFile ? theme.colors.primary : "#bfdbfe",
            }}
          >
            {reading ? (
              <ActivityIndicator color={hasFile ? "#fff" : theme.colors.primary} />
            ) : (
              <Ionicons name={hasFile ? "document-text-outline" : "cloud-upload-outline"} size={28} color={hasFile ? "#fff" : theme.colors.primary} />
            )}
          </View>

          <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 17, marginTop: 14, textAlign: "center" }}>
            {hasFile ? file?.name : "Selecionar arquivo CSV"}
          </Text>
          <Text style={{ color: theme.colors.muted, fontWeight: "700", fontSize: 12, lineHeight: 18, marginTop: 6, textAlign: "center" }}>
            {hasFile ? formatFileSize(file?.size) : "Use um arquivo com data, descricao, valor e tipo"}
          </Text>
        </Pressable>

        <Row style={{ gap: 10, flexWrap: "wrap" }}>
          <Button title={reading ? "Lendo..." : hasFile ? "Trocar arquivo" : "Escolher arquivo"} onPress={pickCsv} disabled={reading || busy} style={{ flex: 1 }} />
          {hasFile ? <Button title="Remover" onPress={clearFile} variant="ghost" disabled={busy} style={{ flex: 1 }} /> : null}
        </Row>
      </Card>

      {!hasFile ? (
        <Card intensity={14}>
          <Row style={{ gap: 12, alignItems: "flex-start" }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.primarySoft,
              }}
            >
              <Ionicons name="sparkles-outline" size={20} color={theme.colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontWeight: "900", fontSize: 14 }}>A previa aparece aqui</Text>
              <P muted style={{ marginTop: 4 }}>
                Depois de selecionar o CSV, o app mostra totais, linhas com erro e as primeiras movimentacoes encontradas.
              </P>
            </View>
          </Row>
        </Card>
      ) : (
        <>
          <Card>
            <Label>Resumo da leitura</Label>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <SummaryPill label="Validas" value={String(result.rows.length)} tone="primary" />
              <SummaryPill label="Entradas" value={formatBRLFromCents(income)} tone="good" />
              <SummaryPill label="Saidas" value={formatBRLFromCents(expense)} tone="bad" />
              <SummaryPill label="Saldo da conta" value={formatBRLFromCents(accountBalance)} tone={accountBalance < 0 ? "bad" : "good"} />
            </View>

            {result.ignoredRows ? (
              <P muted>
                {result.ignoredRows} lancamento(s) BB Rende Facil ignorado(s), pois sao aplicacao ou resgate automatico.
              </P>
            ) : null}

            {result.errors.length ? (
              <View style={{ gap: 6, marginTop: 4 }}>
                {result.errors.slice(0, 5).map((error) => (
                  <Row key={error} style={{ gap: 8, alignItems: "flex-start" }}>
                    <Ionicons name="alert-circle-outline" size={16} color={theme.colors.warn} style={{ marginTop: 1 }} />
                    <Text style={{ flex: 1, color: "#92400e", fontWeight: "800", fontSize: 12, lineHeight: 17 }}>{error}</Text>
                  </Row>
                ))}
                {result.errors.length > 5 ? <P muted>Mais {result.errors.length - 5} avisos encontrados.</P> : null}
              </View>
            ) : (
              <P muted>Tudo certo para importar.</P>
            )}
          </Card>

          <Card>
            <Row style={{ justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <Label>Previa do extrato</Label>
              {result.rows.length > 8 ? (
                <Pressable
                  onPress={() => setShowAllPreview((value) => !value)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: "rgba(255,255,255,0.74)",
                  }}
                >
                  <Text style={{ color: theme.colors.primary, fontWeight: "900", fontSize: 12 }}>
                    {showAllPreview ? "Ver menos" : "Ver tudo"}
                  </Text>
                </Pressable>
              ) : null}
            </Row>
            {previewRows.map((row) => (
              <PreviewRow key={row.key} row={row} />
            ))}
            {result.rows.length > 8 && !showAllPreview ? (
              <Pressable
                onPress={() => setShowAllPreview(true)}
                style={{
                  marginTop: 10,
                  paddingVertical: 11,
                  borderRadius: 14,
                  alignItems: "center",
                  backgroundColor: theme.colors.primarySoft,
                }}
              >
                <Text style={{ color: theme.colors.primary, fontWeight: "900" }}>
                  Ver mais {result.rows.length - 8} linhas
                </Text>
              </Pressable>
            ) : null}
            {showAllPreview && result.rows.length > 8 ? (
              <P muted>Mostrando todas as {result.rows.length} linhas validas.</P>
            ) : null}
            {!result.rows.length ? <P muted>Nenhuma linha valida encontrada neste arquivo.</P> : null}
          </Card>

          <Button title={busy ? "Importando..." : "Importar transacoes"} onPress={onImport} disabled={busy || !result.rows.length} />
        </>
      )}
    </Screen>
  );
}
