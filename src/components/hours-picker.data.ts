/**
 * Day labels for the shared opening-hours editor — split out of
 * hours-picker.tsx into its own file
 * (react-refresh/only-export-components cleanup, remediation 07) so that
 * component file only exports the component. No behavior change.
 */
export const HOURS_DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Lendi" },
  { key: "tue", label: "Madi" },
  { key: "wed", label: "Mèkredi" },
  { key: "thu", label: "Jedi" },
  { key: "fri", label: "Vandredi" },
  { key: "sat", label: "Samdi" },
  { key: "sun", label: "Dimanch" },
];
