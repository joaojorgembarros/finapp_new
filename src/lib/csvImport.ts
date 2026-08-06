import { parseBRLToCents } from "./format";
import type { TxType } from "./transactions";
import { detectStatementBank } from "./banks";
import type { BankId } from "./banks";

export type ParsedCsvTx = {
  key: string;
  occurred_on: string;
  note: string;
  amount_cents: number;
  type: TxType;
  rawLine: number;
};

export type CsvBalanceConfidence = "confirmed" | "derived" | "unavailable";

export type CsvParseResult = {
  rows: ParsedCsvTx[];
  errors: string[];
  ignoredRows: number;
  rejectedRows: number;
  initialBalanceCents: number | null;
  finalBalanceCents: number | null;
  finalBalanceConfidence: CsvBalanceConfidence;
  detectedBankId: BankId | null;
};

export type PickedCsvFile = {
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

export async function readCsvText(uri: string) {
  const FileSystem = await import("expo-file-system/legacy");
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

const explicitInitialBalanceLabels = [
  "initialbalance",
  "balanceinitial",
  "openingbalance",
  "beginningbalance",
  "saldoinicial",
  "saldoanterior",
];

const explicitFinalBalanceLabels = [
  "finalbalance",
  "balancefinal",
  "closingbalance",
  "endingbalance",
  "saldofinal",
  "saldodefechamento",
];

const postTransactionBalanceLabels = new Set([
  "balance",
  "balancers",
  "partialbalance",
  "runningbalance",
  "accountbalance",
  "saldo",
  "saldor",
  "saldors",
  "saldoparcial",
  "saldocorrente",
  "saldoaposlancamento",
]);

const standaloneBalanceLabels = new Set([
  "saldo",
  "saldoatual",
  "saldoconta",
  "saldodisponivel",
  "saldododia",
]);

function matchesBalanceLabel(value: string, labels: string[]) {
  const normalized = normalizeHeader(value);
  return labels.some((label) => normalized === label || normalized.startsWith(label));
}

function isExplicitInitialBalanceLabel(value: string) {
  return matchesBalanceLabel(value, explicitInitialBalanceLabels);
}

function isExplicitFinalBalanceLabel(value: string) {
  return matchesBalanceLabel(value, explicitFinalBalanceLabels);
}

function isPostTransactionBalanceHeader(value: string) {
  const normalized = normalizeHeader(value);
  if (isExplicitInitialBalanceLabel(normalized) || isExplicitFinalBalanceLabel(normalized)) return false;
  return postTransactionBalanceLabels.has(normalized);
}

function isTransactionBalanceHeader(value: string) {
  return isPostTransactionBalanceHeader(value) || isExplicitFinalBalanceLabel(value);
}

function isStandaloneBalanceLabel(value: string) {
  return standaloneBalanceLabels.has(normalizeHeader(value));
}

function parseOptionalCents(value: string | undefined) {
  if (!value || !/\d/.test(value)) return null;
  return parseBRLToCents(value);
}

function parseOptionalSignedCents(cells: string[], amountIdx: number, creditIdx: number, debitIdx: number) {
  if (amountIdx >= 0) return parseOptionalCents(cells[amountIdx]);

  const credit = creditIdx >= 0 ? parseOptionalCents(cells[creditIdx]) : null;
  const debit = debitIdx >= 0 ? parseOptionalCents(cells[debitIdx]) : null;

  if (credit !== null && credit > 0) return credit;
  if (debit !== null && debit > 0) return -debit;
  if (credit === 0 || debit === 0) return 0;
  return null;
}

function findExplicitBalanceSummary(lines: string[]) {
  let initialBalanceCents: number | null = null;
  let finalBalanceCents: number | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const delimiter = detectDelimiter(line);
    const cells = splitCsvLine(line, delimiter);
    const isDatedRow = cells.some((cell) => parseDate(cell) !== null);
    if (isDatedRow || isHeaderInfo(getHeaderInfo(line))) continue;
    const nextCells = lines[index + 1]
      ? splitCsvLine(lines[index + 1], delimiter)
      : [];

    cells.forEach((cell, cellIndex) => {
      const initialLabel = isExplicitInitialBalanceLabel(cell);
      const finalLabel = isExplicitFinalBalanceLabel(cell);
      if (!initialLabel && !finalLabel) return;

      const inlineValue = parseOptionalCents(cells[cellIndex + 1]);
      const columnValue = parseOptionalCents(nextCells[cellIndex]);
      const value = inlineValue ?? columnValue;
      if (value === null) return;

      if (initialLabel) initialBalanceCents = value;
      if (finalLabel) finalBalanceCents = value;
    });
  }

  return { initialBalanceCents, finalBalanceCents };
}

function parseDate(value: string) {
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    const date = new Date(year, month - 1, day);

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const br = raw.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})(?:$|[ T])/);
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
  const balanceIdx = headers.findIndex(isTransactionBalanceHeader);

  return { delimiter, headers, dateIdx, amountIdx, creditIdx, debitIdx, balanceIdx };
}

function isHeaderInfo(info: ReturnType<typeof getHeaderInfo>) {
  return info.dateIdx >= 0 && (info.amountIdx >= 0 || (info.creditIdx >= 0 && info.debitIdx >= 0));
}

export function parseCsv(content: string, options: { fileName?: string } = {}): CsvParseResult {
  const detectedBankId = detectStatementBank(content, options.fileName);
  const lines = content
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      rows: [],
      errors: ["O arquivo precisa ter cabeçalho e pelo menos uma transação."],
      ignoredRows: 0,
      rejectedRows: 0,
      initialBalanceCents: null,
      finalBalanceCents: null,
      finalBalanceConfidence: "unavailable",
      detectedBankId,
    };
  }

  const explicitBalanceSummary = findExplicitBalanceSummary(lines);
  const errors: string[] = [];
  const rows: ParsedCsvTx[] = [];
  const balanceRows: { occurred_on: string; rawLine: number; signedCents: number | null; balanceCents: number }[] = [];
  let ignoredRows = 0;
  let rejectedRows = 0;
  let baselineBalanceCents: number | null = explicitBalanceSummary.initialBalanceCents;
  let explicitFinalBalanceCents: number | null = explicitBalanceSummary.finalBalanceCents;
  let standaloneBalanceCents: number | null = null;
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
          "transactiontype",
        ]),
        typeIdx: findColumn(headerInfo.headers, ["tipo", "tipolancamento", "tipolanamento", "type", "natureza"]),
      };
      return;
    }

    if (!current) return;

    const cells = splitCsvLine(line, current.delimiter);
    const occurred_on = parseDate(cells[current.dateIdx] ?? "");
    const optionalSignedCents = parseOptionalSignedCents(cells, current.amountIdx, current.creditIdx, current.debitIdx);
    const signedCents = optionalSignedCents ?? 0;
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
    const isExplicitInitialBalanceLine = isExplicitInitialBalanceLabel(normalizedNote);
    const isExplicitFinalBalanceLine = isExplicitFinalBalanceLabel(normalizedNote);
    const isBalanceLine = isStandaloneBalanceLabel(normalizedNote);

    if (isExplicitInitialBalanceLine) {
      if (baselineBalanceCents === null && optionalSignedCents !== null) {
        baselineBalanceCents = optionalSignedCents;
      }
      return;
    }

    if (isExplicitFinalBalanceLine) {
      if (optionalSignedCents !== null) explicitFinalBalanceCents = optionalSignedCents;
      return;
    }

    if (isBalanceLine) {
      if (optionalSignedCents !== null) standaloneBalanceCents = optionalSignedCents;
      return;
    }

    if (
      occurred_on &&
      current.balanceIdx >= 0 &&
      isTransactionBalanceHeader(current.headers[current.balanceIdx] ?? "")
    ) {
      const balanceCents = parseOptionalCents(cells[current.balanceIdx]);
      if (balanceCents !== null) {
        balanceRows.push({
          occurred_on,
          rawLine: lineNumber,
          signedCents: optionalSignedCents,
          balanceCents,
        });
      }
    }

    if (isAutomaticInvestment) {
      ignoredRows += 1;
      return;
    }

    if (!occurred_on) {
      rejectedRows += 1;
      errors.push(`Linha ${lineNumber}: data ausente, inválida ou não reconhecida.`);
      return;
    }

    if (baselineBalanceCents === null && normalizedNote.includes("codlanc0") && signedCents === 0) {
      const balanceCell = current.balanceIdx >= 0 ? cells[current.balanceIdx] : cells.filter((cell) => cell?.trim()).at(-1);
      baselineBalanceCents = parseBRLToCents(balanceCell ?? "");
      return;
    }

    if (amount_cents <= 0) {
      rejectedRows += 1;
      errors.push(`Linha ${lineNumber}: valor ausente, zero ou inválido.`);
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
      errors: ["Não encontrei o cabeçalho do extrato. Procure colunas como data e valor, ou crédito e débito."],
      ignoredRows,
      rejectedRows,
      initialBalanceCents: null,
      finalBalanceCents: null,
      finalBalanceConfidence: "unavailable",
      detectedBankId,
    };
  }

  const sortedBalanceRows = balanceRows.sort((a, b) =>
    a.occurred_on === b.occurred_on ? a.rawLine - b.rawLine : a.occurred_on.localeCompare(b.occurred_on)
  );
  const firstBalanceRow = sortedBalanceRows.find((row) => row.signedCents !== null);
  const lastBalanceRow = sortedBalanceRows.at(-1);
  const initialBalanceCents = baselineBalanceCents ?? (firstBalanceRow
    ? firstBalanceRow.signedCents === 0
      ? firstBalanceRow.balanceCents
      : firstBalanceRow.balanceCents - (firstBalanceRow.signedCents ?? 0)
    : null);
  const movementResultCents = rows.reduce(
    (total, row) => total + (row.type === "income" ? row.amount_cents : -row.amount_cents),
    0
  );
  const finalBalanceCents = explicitFinalBalanceCents
    ?? standaloneBalanceCents
    ?? lastBalanceRow?.balanceCents
    ?? (initialBalanceCents === null ? null : initialBalanceCents + movementResultCents);
  const finalBalanceConfidence: CsvBalanceConfidence = explicitFinalBalanceCents !== null
    ? "confirmed"
    : finalBalanceCents !== null
      ? "derived"
      : "unavailable";

  return {
    rows,
    errors,
    ignoredRows,
    rejectedRows,
    initialBalanceCents,
    finalBalanceCents,
    finalBalanceConfidence,
    detectedBankId,
  };
}

export function formatFileSize(size?: number | null) {
  if (!size) return "Tamanho não informado";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
