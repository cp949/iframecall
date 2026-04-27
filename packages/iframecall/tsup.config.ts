import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    host: "src/host/index.ts",
    iframe: "src/iframe/index.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom"],
});
