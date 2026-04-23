import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const logger = createLogger();
const loggerWarn = logger.warn;

logger.warn = (msg, options) => {
  if (
    msg.includes("contains an annotation that Rollup cannot interpret due to the position of the comment") ||
    msg.includes("Circular chunk:")
  ) {
    return;
  }

  loggerWarn(msg, options);
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  customLogger: logger,
  optimizeDeps: {
    include: ["wagmi", "viem", "ox"],
  },
  server: {
    host: "::",
    port: 8081,
    strictPort: false,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.message.includes("contains an annotation that Rollup cannot interpret due to the position of the comment") ||
          warning.message.includes("Circular chunk:")
        ) {
          return;
        }

        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("/@walletconnect/")) {
            return "walletconnect";
          }

          if (id.includes("/@reown/")) {
            return "reown";
          }

          if (id.includes("/wagmi/") || id.includes("/@wagmi/")) {
            return "wagmi";
          }

          if (id.includes("/viem/") || id.includes("/ox/")) {
            return "viem";
          }

          if (id.includes("/ethers/")) {
            return "ethers";
          }

          if (id.includes("/framer-motion/")) {
            return "motion";
          }

          if (id.includes("/react-router") || id.includes("@remix-run/router")) {
            return "router";
          }

          if (id.includes("/@radix-ui/")) {
            return "radix";
          }

          return undefined;
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
      "wagmi",
      "viem",
    ],
  },
}));
