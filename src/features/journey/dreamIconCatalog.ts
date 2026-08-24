export type DreamIconKind =
  | "emergency"
  | "home"
  | "travel"
  | "car"
  | "motorcycle"
  | "wedding"
  | "education"
  | "business"
  | "health"
  | "retirement"
  | "debt"
  | "investment"
  | "family"
  | "relocation"
  | "freedom"
  | "other";

export function normalizeDreamTitle(title: string) {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const PRESET_DREAM_KINDS: Readonly<Record<string, DreamIconKind>> = {
  "quitar dividas": "debt",
  "reserva de emergencia": "emergency",
  "comprar um carro": "car",
  "comprar uma moto": "motorcycle",
  "abrir um negocio": "business",
  "investir mais": "investment",
  "reformar a casa": "home",
  "mudar de cidade": "relocation",
  "fazer faculdade": "education",
  viajar: "travel",
  "liberdade financeira": "freedom",
  casar: "wedding",
  "ter filhos": "family",
  "estudar fora": "education",
};

const DREAM_KIND_RULES: readonly {
  kind: DreamIconKind;
  terms: readonly string[];
}[] = [
  { kind: "debt", terms: ["divida", "dividas", "quitar", "financiamento", "emprestimo"] },
  { kind: "motorcycle", terms: ["moto", "motos", "motocicleta", "motocicletas"] },
  { kind: "car", terms: ["carro", "carros", "automovel", "automoveis", "veiculo", "veiculos"] },
  { kind: "wedding", terms: ["casar", "casamento", "bodas", "alianca"] },
  { kind: "education", terms: ["estudar", "estudo", "estudos", "faculdade", "graduacao", "curso", "cursos", "escola", "formacao"] },
  { kind: "business", terms: ["negocio", "negocios", "empresa", "empresas", "empreender", "empreendimento", "loja", "lojas"] },
  { kind: "health", terms: ["saude", "tratamento", "cirurgia", "bem estar", "medico"] },
  { kind: "retirement", terms: ["aposentadoria", "aposentar"] },
  { kind: "freedom", terms: ["liberdade financeira", "independencia financeira"] },
  { kind: "investment", terms: ["investir", "investimento", "patrimonio"] },
  { kind: "home", terms: ["casa", "casas", "reforma", "reformas", "reformar", "apartamento", "apartamentos", "imovel", "imoveis", "moradia"] },
  { kind: "travel", terms: ["viajar", "viagem", "viagens", "ferias", "turismo", "intercambio"] },
  { kind: "family", terms: ["filho", "filhos", "familia", "bebe"] },
  { kind: "relocation", terms: ["mudar", "mudanca", "cidade nova"] },
  { kind: "emergency", terms: ["emergencia", "imprevisto", "reserva", "seguranca financeira"] },
];

function containsTerm(title: string, term: string) {
  return ` ${title} `.includes(` ${term} `);
}

export function resolveDreamIconKind(title: string): DreamIconKind {
  const normalized = normalizeDreamTitle(title);
  const preset = PRESET_DREAM_KINDS[normalized];
  if (preset) return preset;

  for (const rule of DREAM_KIND_RULES) {
    if (rule.terms.some((term) => containsTerm(normalized, term))) return rule.kind;
  }

  return "other";
}
