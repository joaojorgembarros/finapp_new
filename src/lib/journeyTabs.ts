export const JOURNEY_TABS = ["jornada", "movimentacoes", "controle", "planejamento"] as const;

export type JourneyTab = (typeof JOURNEY_TABS)[number];

export const DEFAULT_JOURNEY_TAB: JourneyTab = "jornada";

const LEGACY_CHALLENGE_TAB = "desafios";

export function parseRequestedTab(
  raw: string | undefined,
  options?: { showControle?: boolean },
): JourneyTab {
  const showControle = options?.showControle ?? true;
  if (!raw || raw === LEGACY_CHALLENGE_TAB) return DEFAULT_JOURNEY_TAB;
  if (raw === "controle") return showControle ? "controle" : DEFAULT_JOURNEY_TAB;
  return JOURNEY_TABS.find((tab) => tab === raw) ?? DEFAULT_JOURNEY_TAB;
}
