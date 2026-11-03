const colors = Object.freeze({
  background: "#ffffff",
  ink: "#0f172a",
  muted: "#334155",
  green: "#03543f",
  greenLight: "#bbf7d0",
  amber: "#f59e0b",
  redLight: "#fecdd3",
  border: "#64748b"
});

export const POS_THEME = Object.freeze({
  color: colors,
  type: { body: "1rem", heading: "1.5rem", display: "2.75rem" },
  space: { page: "1rem", control: "0.75rem" },
  radius: { card: "1.25rem", control: "1rem" },
  border: "2px",
  cssVariables: Object.freeze({
    "--pos-background": colors.background,
    "--pos-ink": colors.ink,
    "--pos-muted": colors.muted,
    "--pos-green": colors.green,
    "--pos-border": colors.border,
    "--pos-font": "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
  })
});
