import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: "frontend",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(rootDir, "frontend/index.html"),
        admin: resolve(rootDir, "frontend/admin/index.html"),
        spots: resolve(rootDir, "frontend/spots/index.html")
      }
    }
  }
});
