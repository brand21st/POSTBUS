import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The Shopify embedded app renders with Polaris web components only (Built for Shopify, small
    // bundle). Keep the dashboard's shadcn/Radix kit and app-specific UI out of it.
    files: ["app/shopify/**/*.{ts,tsx}", "components/shopify-app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["@radix-ui/*"], message: "Use Polaris web components (s-*) in the Shopify app." },
            {
              group: ["@/components/*", "!@/components/shopify-app", "!@/components/shopify-app/*"],
              message: "The Shopify app may only import from components/shopify-app.",
            },
          ],
          paths: [
            { name: "lucide-react", message: "Use Polaris icons (s-icon) in the Shopify app." },
            { name: "sonner", message: "Use App Bridge toasts (showToast) in the Shopify app." },
            { name: "motion", message: "Keep the Shopify app bundle lean." },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    "node_modules/**",
    ".cursor/**",
    ".next/**",
    ".next-verify/**",
    ".next-staging/**",
    ".worktrees/**",
    "dist/**",
    "coverage/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "print-agent/**",
    "print-agent-desktop/**",
    "public/pdf.worker.min.mjs",
    "testsprite_tests/**",
  ]),
]);

export default eslintConfig;
