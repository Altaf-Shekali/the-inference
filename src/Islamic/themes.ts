export interface ColorTheme {
  id: string;
  name: string;
  backgroundGradient: string;
  accent: string;
  accentGlow: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  beadActive: string;
  beadInactive: string;
  border: string;
  cardBg: string;
}

export const THEMES: Record<string, ColorTheme> = {
  midnight: {
    id: "midnight",
    name: "Midnight Blue",
    backgroundGradient: "radial-gradient(circle at 50% 15%, #0f2744 0%, #081326 45%, #040812 100%)",
    accent: "#f59e0b",
    accentGlow: "rgba(245, 158, 11, 0.4)",
    textPrimary: "#f8fafc",
    textSecondary: "#cbd5e1",
    textMuted: "#64748b",
    beadActive: "#fbbf24",
    beadInactive: "rgba(255, 255, 255, 0.18)",
    border: "rgba(245, 158, 11, 0.3)",
    cardBg: "rgba(15, 23, 42, 0.65)",
  },
  golden: {
    id: "golden",
    name: "Golden Light",
    backgroundGradient: "radial-gradient(circle at 50% 20%, #2e200c 0%, #171006 50%, #0a0702 100%)",
    accent: "#fbbf24",
    accentGlow: "rgba(251, 191, 36, 0.45)",
    textPrimary: "#fffbeb",
    textSecondary: "#fef3c7",
    textMuted: "#92400e",
    beadActive: "#f59e0b",
    beadInactive: "rgba(251, 191, 36, 0.2)",
    border: "rgba(251, 191, 36, 0.35)",
    cardBg: "rgba(30, 20, 8, 0.7)",
  },
  emerald: {
    id: "emerald",
    name: "Emerald Serenity",
    backgroundGradient: "radial-gradient(circle at 50% 15%, #0d281e 0%, #061812 50%, #020b08 100%)",
    accent: "#34d399",
    accentGlow: "rgba(52, 211, 153, 0.4)",
    textPrimary: "#f0fdf4",
    textSecondary: "#bbf7d0",
    textMuted: "#065f46",
    beadActive: "#10b981",
    beadInactive: "rgba(52, 211, 153, 0.2)",
    border: "rgba(52, 211, 153, 0.3)",
    cardBg: "rgba(6, 24, 18, 0.7)",
  },
  minimal: {
    id: "minimal",
    name: "Obsidian Minimal",
    backgroundGradient: "radial-gradient(circle at 50% 30%, #18181b 0%, #09090b 60%, #000000 100%)",
    accent: "#e2e8f0",
    accentGlow: "rgba(255, 255, 255, 0.25)",
    textPrimary: "#fafafa",
    textSecondary: "#a1a1aa",
    textMuted: "#52525b",
    beadActive: "#f4f4f5",
    beadInactive: "rgba(255, 255, 255, 0.15)",
    border: "rgba(255, 255, 255, 0.2)",
    cardBg: "rgba(24, 24, 27, 0.6)",
  },
};
