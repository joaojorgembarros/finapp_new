import { describe, expect, it } from "vitest";
import { observedHabitBasisLabel, observedHabitOutlierLabel } from "./observedHabitCopy";

describe("observed habit copy", () => {
  it("names only the months that entered the estimate", () => {
    expect(observedHabitBasisLabel(["2026-07", "2026-08"])).toBe("Baseado em julho e agosto");
    expect(observedHabitBasisLabel(["2026-07", "2026-08"])).not.toContain("setembro");
  });

  it("lists three estimate months when none was discarded", () => {
    expect(observedHabitBasisLabel(["2026-07", "2026-08", "2026-09"])).toBe(
      "Baseado em julho, agosto e setembro",
    );
    expect(observedHabitOutlierLabel(false)).toBeNull();
  });

  it("mentions a discarded month without putting it in the basis", () => {
    const basis = observedHabitBasisLabel(["2026-07", "2026-08"]);
    const note = observedHabitOutlierLabel(true);

    expect(basis).toBe("Baseado em julho e agosto");
    expect(note).toBe("Um mês atípico foi desconsiderado.");
    expect(`${basis} ${note}`).not.toContain("setembro");
  });
});
