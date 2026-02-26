// src/lib/format.ts
export function formatBRLFromCents(cents: number) {
  const v = (cents || 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ✅ aceita "2400", "2400,50" e também "2400.50"
export function parseBRLToCents(input: string) {
  const s = (input || "").trim();
  if (!s) return 0;

  // remove símbolos e mantém só dígitos + separadores
  const cleaned = s.replace(/[^\d,.\-]/g, "");
  if (!cleaned) return 0;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;

  if (hasComma) {
    // padrão BR: ponto milhar, vírgula decimal
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    // padrão US: ponto decimal (se tiver vários pontos, o último é o decimal)
    const parts = cleaned.split(".");
    if (parts.length > 2) {
      const dec = parts.pop();
      normalized = parts.join("") + "." + dec;
    }
    normalized = normalized.replace(/,/g, "");
  } else {
    // inteiro
    normalized = cleaned;
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function formatDateBR(isoOrDate: string | Date) {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  return d.toLocaleDateString("pt-BR");
}

export function formatDateBRFromYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("pt-BR");
}
