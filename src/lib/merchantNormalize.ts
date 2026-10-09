export type MerchantStrength = "strong" | "weak";

export type NormalizedMerchant = {
  key: string;
  displayName: string;
  confidence: MerchantStrength;
};

const PAYMENT_PREFIXES = [
  "pagseguro",
  "paypal",
  "ebanx",
  "stripe",
  "picpay",
  "pag",
  "pg",
  "mp",
] as const;

const GENERIC_PAYMENT_TOKENS = new Set([
  "pix",
  "ted",
  "doc",
  "pagamento",
  "pagamentos",
  "compra",
  "compras",
  "transferencia",
  "transferencias",
  "enviado",
  "enviada",
  "recebido",
  "recebida",
  "debito",
  "credito",
  "cartao",
  "via",
]);

const CANONICAL_MERCHANTS: { token: string; key: string; displayName: string }[] = [
  { token: "netflix", key: "netflix", displayName: "Netflix" },
  { token: "spotify", key: "spotify", displayName: "Spotify" },
  { token: "cemig", key: "cemig", displayName: "Cemig" },
  { token: "copel", key: "copel", displayName: "Copel" },
  { token: "enel", key: "enel", displayName: "Enel" },
  { token: "sabesp", key: "sabesp", displayName: "Sabesp" },
  { token: "disney", key: "disney", displayName: "Disney" },
  { token: "hbo", key: "hbo", displayName: "HBO" },
  { token: "ifood", key: "ifood", displayName: "iFood" },
  { token: "uber", key: "uber", displayName: "Uber" },
  { token: "salario", key: "salario", displayName: "Salário" },
  { token: "provento", key: "salario", displayName: "Salário" },
  { token: "folha", key: "salario", displayName: "Salário" },
];

const SALARY_MARKERS = new Set(["salario", "folha", "provento"]);
const LEGAL_SUFFIXES = new Set(["ltda", "eireli", "epp", "mei", "sa"]);
const PORTUGUESE_CONNECTORS = new Set(["de", "da", "do", "das", "dos"]);
const INCOME_WRAPPER_TOKENS = new Set([
  ...GENERIC_PAYMENT_TOKENS,
  "pagto",
  "pg",
  "recebimento",
]);

function cleanedTokens(note: string) {
  const cleaned = cleanMerchantText(note);
  if (!cleaned) return null;
  const tokens = cleaned.split(" ").filter(Boolean);
  return tokens.length ? tokens : null;
}

function incomePayerTokens(tokens: string[], extraDropped: Set<string> = new Set()) {
  return tokens.filter((token) => (
    !extraDropped.has(token)
    && !INCOME_WRAPPER_TOKENS.has(token)
    && !LEGAL_SUFFIXES.has(token)
    && !PORTUGUESE_CONNECTORS.has(token)
  ));
}

/**
 * Income-only payer key. Expense grouping keeps using normalizeMerchant.
 * `salario` when the description has a salary word and no identifiable payer.
 * `salario:<payer>` when payer words remain after removing salary markers,
 * generic payment words, legal suffixes and Portuguese connectors.
 */
export function incomeSalaryCounterpartyKey(note: string): string | null {
  const tokens = cleanedTokens(note);
  if (!tokens || !tokens.some((token) => SALARY_MARKERS.has(token))) return null;

  const payer = incomePayerTokens(tokens, SALARY_MARKERS).join(" ");
  if (payer.length < 3) return "salario";
  return `salario:${payer}`;
}

/**
 * Non-salary income payer. Null when fewer than two identifying words remain,
 * so PIX JOAO and TED RECEBIDA stay on the weak merchant path.
 * Key is the remaining words, for example `empresa beta`.
 */
export function incomeCounterpartyKey(note: string): string | null {
  const tokens = cleanedTokens(note);
  if (!tokens || tokens.some((token) => SALARY_MARKERS.has(token))) return null;

  const payerTokens = incomePayerTokens(tokens);
  if (payerTokens.length < 2) return null;
  const payer = payerTokens.join(" ");
  return payer.length < 3 ? null : payer;
}

export function normalizeMerchant(input: string): NormalizedMerchant {
  const cleaned = cleanMerchantText(input);
  if (!cleaned) {
    return { key: "", displayName: "", confidence: "weak" };
  }

  const canonical = matchCanonicalMerchant(cleaned);
  if (canonical) {
    return { ...canonical, confidence: "strong" };
  }

  const tokens = cleaned.split(" ").filter(Boolean);
  const meaningful = tokens.filter((token) => !GENERIC_PAYMENT_TOKENS.has(token));
  if (!meaningful.length) {
    return {
      key: cleaned,
      displayName: titleCase(cleaned),
      confidence: "weak",
    };
  }

  const key = meaningful.join(" ");
  const hadGenericPayment = tokens.some((token) => GENERIC_PAYMENT_TOKENS.has(token));
  const looksLikePersonPayee = hadGenericPayment && meaningful.length <= 2 && meaningful.every((token) => token.length <= 18);

  return {
    key,
    displayName: titleCase(key),
    confidence: looksLikePersonPayee || key.length < 3 ? "weak" : "strong",
  };
}

function cleanMerchantText(input: string) {
  let value = (input || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\//g, " ")
    .replace(/\bwww\./g, " ")
    .replace(/\.(com|br|net|org)\b/g, " ")
    .replace(/[*^#]+/g, " ");

  value = stripLeadingPrefixes(value);
  value = value.replace(/[0-9]{4,}/g, " ");
  value = value.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return value;
}

function stripLeadingPrefixes(value: string) {
  let current = value.replace(/\s+/g, " ").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of PAYMENT_PREFIXES) {
      if (current === prefix) {
        current = "";
        changed = true;
        break;
      }
      if (current.startsWith(`${prefix} `)) {
        current = current.slice(prefix.length).trim();
        changed = true;
        break;
      }
    }
  }
  return current;
}

function matchCanonicalMerchant(cleaned: string) {
  const tokens = cleaned.split(" ").filter(Boolean);
  for (const alias of CANONICAL_MERCHANTS) {
    if (tokens.includes(alias.token) || cleaned === alias.token) {
      return { key: alias.key, displayName: alias.displayName };
    }
  }
  return null;
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}
