// src/ui/theme.ts
export const theme = {
  colors: {
    bg0: "#070a12",
    bg1: "#0b1122",
    card: "rgba(255,255,255,0.06)",
    card2: "rgba(255,255,255,0.04)",
    border: "rgba(231,234,243,0.14)",
    text: "#e7eaf3",
    muted: "rgba(231,234,243,0.72)",
    muted2: "rgba(231,234,243,0.52)",

    primary: "#00f0ff",
    secondary: "#4b00ff",
    pink: "#ff2df0",

    good: "#00ffa3",
    warn: "#ff9c00",
    bad: "#ff4d6d",
  },
  radii: { r12: 12, r16: 16, r20: 20, r28: 28 },
  spacing: { s8: 8, s12: 12, s16: 16, s20: 20, s24: 24 },
  text: {
    h1: { fontSize: 24, fontWeight: "800" as const },
    h2: { fontSize: 18, fontWeight: "700" as const },
    body: { fontSize: 14, fontWeight: "600" as const },
    small: { fontSize: 12, fontWeight: "700" as const },
  },
};
