import { formatBRLFromCents } from "../../lib/format";

export const DREAMS_COPY = {
  heroTitle: "Seus sonhos",
  heroSubtitle: "Cada valor guardado deixa seu sonho mais perto.",
  heroProgressPrefix: "Você já avançou",
  inProgressTitle: "Sonhos em andamento",
  saveAction: "Guardar dinheiro",
  detailsAction: "Ver detalhes",
  savedWord: "guardados",
  ofTargetPrefix: "de",
  monthEyebrow: "Guardado neste mês",
  emptyTitle: "Qual sonho você quer conquistar?",
  emptyText: "Crie seu primeiro sonho e comece a transformar planos em metas.",
  emptyAction: "Criar meu primeiro sonho",
  addDreamAction: "Adicionar um sonho",
  allCompleted: "Você conquistou todos os sonhos atuais. Que tal começar um novo?",
  conqueredLabel: "Sonho conquistado",
  conqueredOnPrefix: "Conquistado em",
  achievementsTitle: "Sonhos conquistados",
  achievementSingular: "sonho conquistado",
  achievementPlural: "sonhos conquistados",
} as const;

export function clampDreamProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(100, progress));
}

export function dreamProgressPercent(contributedCents: number, targetCents: number) {
  return clampDreamProgress((contributedCents / Math.max(targetCents, 1)) * 100);
}

export function dreamProgressLabel(progress: number) {
  const pct = clampDreamProgress(progress);
  return pct > 0 && pct < 1 ? "<1%" : `${Math.round(pct)}%`;
}

export function formatDreamDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function isDreamCompleted(contributedCents: number, targetCents: number) {
  return contributedCents >= targetCents;
}

export function dreamSavedCopy(contributedCents: number) {
  return `${formatBRLFromCents(contributedCents)} ${DREAMS_COPY.savedWord}`;
}

export function dreamTargetCopy(targetCents: number) {
  return `${DREAMS_COPY.ofTargetPrefix} ${formatBRLFromCents(targetCents)}`;
}

export function dreamHeroProgressCopy(progress: number) {
  return `${DREAMS_COPY.heroProgressPrefix} ${dreamProgressLabel(progress)}.`;
}

export function dreamAchievementsCountCopy(count: number) {
  return `${count} ${count === 1 ? DREAMS_COPY.achievementSingular : DREAMS_COPY.achievementPlural}`;
}

export function dreamConqueredDateCopy(completedOn: string) {
  return `${DREAMS_COPY.conqueredOnPrefix} ${formatDreamDate(completedOn)}`;
}

export function visibleDreamCopyValues() {
  return Object.values(DREAMS_COPY);
}
