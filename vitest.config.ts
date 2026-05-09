import { defineConfig } from "vitest/config";
import path from "path";

const alias = { "@": path.resolve(__dirname, ".") };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          include: ["lib/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "jsdom",
          include: ["components/**/*.test.tsx", "app/**/*.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
