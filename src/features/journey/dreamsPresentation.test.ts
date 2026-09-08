import { describe, expect, it } from "vitest";
import { DREAM_ICON_NAMES, resolveDreamIconName } from "./dreamIconCatalog";
import {
  DREAMS_COPY,
  clampDreamProgress,
  dreamAchievementsCountCopy,
  dreamConqueredDateCopy,
  dreamHeroProgressCopy,
  dreamProgressLabel,
  dreamProgressPercent,
  dreamSavedCopy,
  dreamTargetCopy,
  isDreamCompleted,
  visibleDreamCopyValues,
} from "./dreamsPresentation";

describe("dreamsPresentation", () => {
  it("keeps user-facing copy on guardar instead of aporte", () => {
    const copy = visibleDreamCopyValues().join(" ").toLocaleLowerCase("pt-BR");

    expect(copy).toContain("guardado");
    expect(copy).toContain("guardar");
    expect(copy).not.toMatch(/aporte/);
    expect(DREAMS_COPY.saveAction).toBe("Guardar dinheiro");
    expect(DREAMS_COPY.monthEyebrow).toBe("Guardado neste mês");
  });

  it("formats saved and target amounts with simple language", () => {
    expect(dreamSavedCopy(350_000)).toMatch(/3\.500,00/);
    expect(dreamSavedCopy(350_000)).toContain("guardados");
    expect(dreamTargetCopy(1_500_000)).toMatch(/^de /);
    expect(dreamTargetCopy(1_500_000)).toMatch(/15\.000,00/);
  });

  it("shows 0%, <1% and 100% without rounding surprises", () => {
    expect(dreamProgressLabel(0)).toBe("0%");
    expect(dreamProgressLabel(0.4)).toBe("<1%");
    expect(dreamProgressLabel(23.4)).toBe("23%");
    expect(dreamProgressLabel(100)).toBe("100%");
    expect(clampDreamProgress(140)).toBe(100);
    expect(dreamProgressPercent(0, 15_000_00)).toBe(0);
    expect(dreamProgressPercent(15_000_00, 15_000_00)).toBe(100);
  });

  it("preserves the existing completion rule", () => {
    expect(isDreamCompleted(14_999_00, 15_000_00)).toBe(false);
    expect(isDreamCompleted(15_000_00, 15_000_00)).toBe(true);
    expect(isDreamCompleted(16_000_00, 15_000_00)).toBe(true);
  });

  it("uses conquest language for completed dreams", () => {
    expect(dreamConqueredDateCopy("2026-03-12")).toBe("Conquistado em 12/03/2026");
    expect(dreamAchievementsCountCopy(1)).toBe("1 sonho conquistado");
    expect(dreamAchievementsCountCopy(3)).toBe("3 sonhos conquistados");
    expect(dreamHeroProgressCopy(23)).toBe("Você já avançou 23%.");
  });

  it.each([
    ["Reserva de emergência", "shield-checkmark-outline"],
    ["Reformar a casa", "home-outline"],
    ["Viajar", "airplane-outline"],
    ["Comprar um carro", "car-outline"],
    ["Estudos", "school-outline"],
    ["Ver a aurora boreal", "sparkles-outline"],
  ] as const)("maps %s to a consistent ionicon", (title, icon) => {
    expect(resolveDreamIconName(title)).toBe(icon);
  });

  it("keeps one icon family for every dream kind", () => {
    const names = Object.values(DREAM_ICON_NAMES);
    expect(names.every((name) => name.endsWith("-outline"))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
