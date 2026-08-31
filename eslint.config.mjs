import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    // React Compiler is not enabled for this application. These rules target
    // compiler eligibility and reject established effect-driven loading flows.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    // These adapters bridge Babylon/runtime geometry APIs that do not expose
    // stable application-level types. Keep the exception local to the bridge.
    files: ["app/components/splat-viewer.tsx", "app/lib/floorplan-geometry.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  globalIgnores([
    ".next/**",
    ".vercel/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party generated WebAssembly workers, committed for runtime use.
    "public/aholo/**",
  ]),
]);
