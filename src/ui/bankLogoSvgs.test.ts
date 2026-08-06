import { describe, expect, it } from "vitest";
import { BANK_CATALOG } from "../lib/banks";
import { BANK_LOGO_SVGS } from "./bankLogoSvgs";

describe("BANK_LOGO_SVGS", () => {
  it("covers every real bank in the catalog with a local SVG", () => {
    expect(Object.keys(BANK_LOGO_SVGS).sort()).toEqual(
      BANK_CATALOG.map((bank) => bank.id).sort()
    );

    for (const bank of BANK_CATALOG) {
      expect(BANK_LOGO_SVGS[bank.id]).toMatch(/^<svg[\s\S]*<\/svg>$/);
    }
  });
});
