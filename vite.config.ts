import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  worker: { format: "es" },
  server: { port: 5173, strictPort: true },
});
