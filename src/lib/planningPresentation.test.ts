import { describe, expect, it } from "vitest";
import { formatBRLFromCents } from "./format";
import {
  cycleTimeProgress,
  formatCycleSpan,
  planningCommitmentSummary,
  planningPlanSummary,
} from "./planningPresentation";
import { disclosureInitiallyOpen } from "../ui/disclosureState";
import { planningReviewNeedsAttention } from "../features/planning/planningCycleActions";
import { PRESENTATION_MOTION } from "../ui/presentationMotion";

describe("planning presentation", () => {
  it("formats the cycle from its inclusive start and exclusive end", () => {
    expect(formatCycleSpan("2026-10-08", "2026-11-08")).toBe("08 OUT → 07 NOV");
    expect(formatCycleSpan("2026-10-01", "2026-11-01")).toBe("01 OUT → 31 OUT");
    expect(formatCycleSpan("ruim", "2026-11-01")).toBeNull();
  });

  it("measures calendar progress without turning it into a money forecast", () => {
    const progress = cycleTimeProgress({
      start: "2026-10-01",
      end: "2026-11-01",
      referenceDate: "2026-10-08",
    });
    expect(progress?.caption).toBe("Andamento do período");
    expect(progress?.ratio).toBeCloseTo(7 / 31, 5);
    expect(JSON.stringify(progress)).not.toMatch(/previsto|projeção|vai sobrar|saldo/i);
    expect(cycleTimeProgress({
      start: "2026-10-01",
      end: "2026-11-01",
      referenceDate: "2026-09-01",
    })?.ratio).toBe(0);
    expect(cycleTimeProgress({
      start: "2026-10-01",
      end: "2026-11-01",
      referenceDate: "2026-12-01",
    })?.ratio).toBe(1);
  });
});

describe("planning disclosure summaries", () => {
  it("summarizes the plan and the commitments without opening them", () => {
    expect(planningPlanSummary({
      span: "08 OUT → 07 NOV",
      reserveCents: 150000,
    })).toBe(`08 OUT → 07 NOV · Reserva ${formatBRLFromCents(150000)}`);
    expect(planningPlanSummary({ span: null, reserveCents: null })).toBe("Ciclo, renda e reserva");
    expect(planningCommitmentSummary(4, 182000)).toBe(`4 itens · ${formatBRLFromCents(182000)}`);
    expect(planningCommitmentSummary(0, 0)).toBe("Nenhum item");
  });

  it("starts secondary sections closed and shows payment review only when something is pending", () => {
    expect(disclosureInitiallyOpen()).toBe(false);
    expect(disclosureInitiallyOpen(true)).toBe(true);
    expect(planningReviewNeedsAttention(0)).toBe(false);
    expect(planningReviewNeedsAttention(2)).toBe(true);
  });
});

describe("presentation motion", () => {
  it("uses one short native fade and a small rise", () => {
    expect(PRESENTATION_MOTION.useNativeDriver).toBe(true);
    expect(PRESENTATION_MOTION.durationMs).toBeLessThanOrEqual(320);
    expect(PRESENTATION_MOTION.translateY).toBeLessThanOrEqual(12);
    expect(PRESENTATION_MOTION).not.toHaveProperty("spring");
  });
});
