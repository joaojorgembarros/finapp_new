// src/ui/theme.ts
export const theme = {
  colors: {
    bg0: "#f8fafc",
    bg1: "#eff6ff",
    bg2: "#faf5ff",
    card: "rgba(255,255,255,0.88)",
    card2: "rgba(255,255,255,0.76)",
    border: "rgba(148,163,184,0.28)",
    text: "#1e293b",
    muted: "#64748b",
    muted2: "#94a3b8",

    primary: "#2563eb",
    secondary: "#9333ea",
    pink: "#ec4899",

    good: "#16a34a",
    warn: "#f59e0b",
    bad: "#dc2626",

    goodSoft: "#dcfce7",
    badSoft: "#fee2e2",
    primarySoft: "#dbeafe",
    secondarySoft: "#f3e8ff",
  },
  radii: { r12: 12, r16: 16, r20: 20, r28: 28, r32: 32 },
  spacing: { s8: 8, s12: 12, s16: 16, s20: 20, s24: 24 },
  text: {
    h1: { fontSize: 30, fontWeight: "900" as const, lineHeight: 36 },
    h2: { fontSize: 18, fontWeight: "800" as const, lineHeight: 24 },
    body: { fontSize: 14, fontWeight: "600" as const, lineHeight: 20 },
    small: { fontSize: 12, fontWeight: "700" as const, lineHeight: 16 },
  },
  shadow: {
    shadowColor: "#64748b",
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  gradient: {
    brand: ["#2563eb", "#9333ea", "#ec4899"] as const,
    success: ["#10b981", "#16a34a"] as const,
    page: ["#f8fafc", "#eff6ff", "#faf5ff"] as const,
  },
};
