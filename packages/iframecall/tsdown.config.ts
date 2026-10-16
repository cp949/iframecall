import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    host: "src/host/index.ts",
    iframe: "src/iframe/index.ts",
  },
  format: ["esm"],
  platform: "browser",
  target: ["chrome75", "firefox67"],
  dts: { sourcemap: false },
  sourcemap: false,
  clean: true,
  external: ["react", "react-dom"],
});
