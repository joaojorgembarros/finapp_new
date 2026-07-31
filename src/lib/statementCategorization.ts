import type { Category } from "./categories";
import type { ParsedCsvTx } from "./csvImport";
import type { StatementCategoryRule } from "./statementCategoryRules";

export type StatementCategorySuggestion = {
  categoryId: string;
  categoryName: string;
  reason: string;
  confidence: "high" | "medium";
  learned: boolean;
};

type SuggestionRule = {
  flow: ParsedCsvTx["type"];
  categoryAliases: string[];
  keywords: string[];
};

const rules: SuggestionRule[] = [
  {
    flow: "income",
    categoryAliases: ["salario"],
    keywords: ["pagamento salario", "credito salario", "folha pagamento", "salario", "provento"],
  },
  {
    flow: "income",
    categoryAliases: ["plr", "bonus"],
    keywords: ["participacao lucros", "bonificacao", "bonus", "plr"],
  },
  {
    flow: "income",
    categoryAliases: ["pix recebido"],
    keywords: ["transferencia recebida", "pix recebido", "ted recebida"],
  },
  {
    flow: "income",
    categoryAliases: ["extra", "bico"],
    keywords: ["trabalho extra", "freelance", "freela", "bico"],
  },
  {
    flow: "expense",
    categoryAliases: ["aluguel", "financiamento"],
    keywords: ["financiamento imobiliario", "prestacao imovel", "aluguel", "condominio"],
  },
  {
    flow: "expense",
    categoryAliases: ["internet", "celular"],
    keywords: ["internet", "telefonia", "celular", "vivo", "claro", "tim"],
  },
  {
    flow: "expense",
    categoryAliases: ["energia", "agua"],
    keywords: ["energia eletrica", "conta de agua", "saneamento", "sabesp", "enel", "cemig", "copel"],
  },
  {
    flow: "expense",
    categoryAliases: ["assinaturas"],
    keywords: ["amazon prime", "prime video", "youtube premium", "netflix", "spotify", "disney", "hbo"],
  },
  {
    flow: "expense",
    categoryAliases: ["alimentacao"],
    keywords: ["supermercado", "restaurante", "lanchonete", "padaria", "acougue", "ifood", "mercado"],
  },
  {
    flow: "expense",
    categoryAliases: ["transporte"],
    keywords: ["posto combustivel", "estacionamento", "combustivel", "gasolina", "etanol", "pedagio", "metro", "onibus", "uber", "99app"],
  },
  {
    flow: "expense",
    categoryAliases: ["saude"],
    keywords: ["laboratorio", "drogaria", "farmacia", "hospital", "clinica", "medico"],
  },
  {
    flow: "expense",
    categoryAliases: ["lazer"],
    keywords: ["ingresso", "cinema", "teatro", "show", "steam", "game"],
  },
  {
    flow: "expense",
    categoryAliases: ["compras"],
    keywords: ["mercado livre", "magazine luiza", "shopping", "amazon", "shopee"],
  },
];

const similarityStopWords = new Set([
  "pix",
  "enviado",
  "enviada",
  "recebido",
  "recebida",
  "pagamento",
  "compra",
  "cartao",
  "debito",
  "credito",
  "transferencia",
  "ted",
  "doc",
  "via",
  "para",
  "de",
]);

function normalize(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function compact(value: string) {
  return normalize(value).replace(/\s+/g, "");
}

function containsPhrase(value: string, phrase: string) {
  return ` ${normalize(value)} `.includes(` ${normalize(phrase)} `);
}

function findRuleCategory(rule: SuggestionRule, categories: Category[]) {
  return categories.find((category) => {
    if (category.flow !== rule.flow) return false;
    const categoryName = compact(category.name);
    return rule.categoryAliases.some((alias) => categoryName.includes(compact(alias)));
  });
}

export function suggestStatementCategory(
  row: ParsedCsvTx,
  categories: Category[],
  learnedRules: StatementCategoryRule[] = []
): StatementCategorySuggestion | null {
  const sameFlow = categories.filter((category) => category.flow === row.type);
  const compactNote = compact(row.note);
  const learnedRule = learnedRules.find(
    (rule) =>
      rule.flow === row.type &&
      rule.match_key === statementSimilarityKey(row.note)
  );
  const learnedCategory = learnedRule
    ? sameFlow.find((category) => category.id === learnedRule.category_id)
    : null;

  if (learnedCategory) {
    return {
      categoryId: learnedCategory.id,
      categoryName: learnedCategory.name,
      reason: "Regra aprendida nesta casa",
      confidence: "high",
      learned: true,
    };
  }

  const direct = sameFlow.find((category) => {
    const categoryName = compact(category.name);
    return categoryName.length >= 4 && compactNote.includes(categoryName);
  });

  if (direct) {
    return {
      categoryId: direct.id,
      categoryName: direct.name,
      reason: `A descrição contém “${direct.name}”`,
      confidence: "high",
      learned: false,
    };
  }

  for (const rule of rules.filter((candidate) => candidate.flow === row.type)) {
    const matchedKeyword = rule.keywords.find((keyword) => containsPhrase(row.note, keyword));
    if (!matchedKeyword) continue;

    const category = findRuleCategory(rule, sameFlow);
    if (!category) continue;

    return {
      categoryId: category.id,
      categoryName: category.name,
      reason: `Reconhecido por “${matchedKeyword}”`,
      confidence: "high",
      learned: false,
    };
  }

  return null;
}

export function statementSimilarityKey(note: string) {
  const words = normalize(note)
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .filter((word) => !similarityStopWords.has(word))
    .filter((word) => !/^\d+$/.test(word));

  return (words.slice(0, 3).join(" ") || normalize(note).slice(0, 32)).slice(0, 160);
}
