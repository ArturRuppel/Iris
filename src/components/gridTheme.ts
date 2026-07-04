import { themeQuartz } from "ag-grid-community";

/* Shared AG Grid theme for the Data view and the workbench node tables — matches
   the app shell and keeps the two grids visually identical (they used to carry
   byte-identical copies of this block). */
export const gridTheme = themeQuartz.withParams({
  accentColor: "#0e7490",
  fontFamily: "inherit",
  fontSize: 12,
  headerFontSize: 12,
  headerFontWeight: 500,
  borderColor: "#e2e8f0",
  headerBackgroundColor: "#f8fafc",
  rowVerticalPaddingScale: 0.7,
  wrapperBorder: false,
});
