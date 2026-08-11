export type MainTab = "controle" | "jornada" | "movimentacoes" | "desafios";
export type AndroidBackAction = "close-menu" | "go-home" | "warn-exit" | "confirm-exit";

export function getAndroidBackAction(opts: {
  menuOpen: boolean;
  tab: MainTab;
  isSecondPress: boolean;
}): AndroidBackAction {
  if (opts.menuOpen) return "close-menu";
  if (opts.tab !== "jornada") return "go-home";
  return opts.isSecondPress ? "confirm-exit" : "warn-exit";
}
