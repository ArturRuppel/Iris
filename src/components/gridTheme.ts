import { themeQuartz } from "ag-grid-community";

/* Shared AG Grid theme for the Data view and the workbench node tables — matches
   the app shell and keeps the two grids visually identical (they used to carry
   byte-identical copies of this block). */
/* Colours reference the app's design tokens (var(--…)) so the grid re-themes
   with the rest of the UI, light and dark, from src/index.css. */
export const gridTheme = themeQuartz.withParams({
  accentColor: "var(--primary)",
  fontFamily: "inherit",
  fontSize: 12,
  headerFontSize: 12,
  headerFontWeight: 500,
  backgroundColor: "var(--panel)",
  foregroundColor: "var(--ink)",
  borderColor: "var(--line)",
  headerBackgroundColor: "var(--panel2)",
  headerTextColor: "var(--dim)",
  rowVerticalPaddingScale: 0.7,
  wrapperBorder: false,
});
