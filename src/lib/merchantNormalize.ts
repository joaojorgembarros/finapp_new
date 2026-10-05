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
