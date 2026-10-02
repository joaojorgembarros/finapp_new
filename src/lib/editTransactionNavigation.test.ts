import { describe, expect, it } from "vitest";
import {
  EDIT_TRANSACTION_PATH,
  firstSearchParam,
  getEditTransactionHref,
  getEditTransactionSafeAreaEdges,
  getEditTransactionStackOptions,
} from "./editTransactionNavigation";

describe("getEditTransactionHref", () => {
  it("passes only the transaction id in the route params", () => {
    expect(getEditTransactionHref("tx-casa-aluguel")).toEqual({
      pathname: EDIT_TRANSACTION_PATH,
      params: { transactionId: "tx-casa-aluguel" },
    });
  });
});

describe("firstSearchParam", () => {
  it("reads a scalar, the first array value, or an empty string", () => {
    expect(firstSearchParam("tx-1")).toBe("tx-1");
    expect(firstSearchParam(["tx-1", "tx-2"])).toBe("tx-1");
    expect(firstSearchParam("  tx-1  ")).toBe("tx-1");
    expect(firstSearchParam(undefined)).toBe("");
  });
});

describe("getEditTransactionStackOptions", () => {
  it("uses a native page sheet on iOS instead of React Native Modal", () => {
    const options = getEditTransactionStackOptions("ios");
    expect(options.presentation).toBe("pageSheet");
    expect(options.headerShown).toBe(false);
    expect(options.gestureEnabled).toBe(true);
    expect(options.sheetGrabberVisible).toBe(true);
    expect(options.sheetAllowedDetents).toEqual([1]);
  });

  it("keeps Android on a normal card in the same activity", () => {
    const options = getEditTransactionStackOptions("android");
    expect(options.presentation).toBe("card");
    expect(options.headerShown).toBe(false);
    expect(options.gestureEnabled).toBe(true);
    expect("sheetGrabberVisible" in options).toBe(false);
  });
});

describe("getEditTransactionSafeAreaEdges", () => {
  it("avoids double-padding the status bar inside the iOS sheet", () => {
    expect(getEditTransactionSafeAreaEdges("ios")).toEqual(["bottom"]);
  });

  it("uses the activity safe area on Android", () => {
    expect(getEditTransactionSafeAreaEdges("android")).toEqual(["top", "bottom"]);
  });
});
