import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";

// App version — single source of truth is package.json. Injected via `define`
// and surfaced in the footer + «История изменений» help section.
const pkgVersion = (
  createRequire(import.meta.url)("./package.json") as { version: string }
).version;

// STANDALONE=1 → single self-contained index.html for "double-click to run" releases.
// Default build remains the regular multi-file output for hosting.
const standalone = process.env.STANDALONE === "1";

/**
 * Dev-only sink for app logs. Mounts `POST /_devlog` on the Vite dev
 * server: the browser sends JSON `{ scope, level, message }` entries
 * to it, the plugin appends one line per entry to `dev-logs/app.log`
 * on disk (gitignored). Makes it possible to grep/tail the log from
 * outside the browser — handy for debugging server-side push errors
 * that don't have a fixed point of failure.
 *
 * Production build never runs this plugin — it's gated to `apply:
 * "serve"`.
 */
function devLogSink(): Plugin {
  return {
    name: "dev-log-sink",
    apply: "serve",
    configureServer(server) {
      const logPath = resolve(server.config.root, "dev-logs", "app.log");
      mkdirSync(dirname(logPath), { recursive: true });
      server.middlewares.use("/_devlog", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf8");
        });
        req.on("end", () => {
          try {
            const entries = JSON.parse(body) as
              | { scope?: string; level?: string; message?: string }
              | { scope?: string; level?: string; message?: string }[];
            const arr = Array.isArray(entries) ? entries : [entries];
            const now = new Date().toISOString();
            const lines = arr
              .map(
                (e) =>
                  `${now} [${e.level || "info"}] ${e.scope || "app"}: ${e.message || ""}`
              )
              .join("\n");
            appendFileSync(logPath, lines + "\n", "utf8");
            res.statusCode = 204;
            res.end();
          } catch {
            res.statusCode = 400;
            res.end("bad json");
          }
        });
      });
    },
  };
}

// For standalone builds: inline all favicon/icon references as data URIs so the
// browser tab shows the app icon when index.html is opened directly via file://
// (no sibling files exist in the single-file release). Also strips the manifest
// link since manifests cannot load from file://.
function inlineStandaloneAssets(): Plugin {
  const pngDataUri = (path: string): string => {
    const buf = readFileSync(resolve(path));
    return `data:image/png;base64,${buf.toString("base64")}`;
  };

  return {
    name: "inline-standalone-assets",
    apply: "build",
    transformIndexHtml(html) {
      // Each item: matcher regex in the source HTML → replacement href.
      const replacements: Array<[RegExp, string]> = [
        [/href="\.\/favicon-48\.png"/g, `href="${pngDataUri("public/favicon-48.png")}"`],
        [/href="\.\/favicon-16\.png"/g, `href="${pngDataUri("public/favicon-16.png")}"`],
        [/href="\.\/favicon-32\.png"/g, `href="${pngDataUri("public/favicon-32.png")}"`],
        [
          /href="\.\/apple-touch-icon\.png"/g,
          `href="${pngDataUri("public/apple-touch-icon.png")}"`,
        ],
      ];
      let out = html;
      for (const [re, val] of replacements) out = out.replace(re, val);
      // The PWA manifest cannot load from file:// — strip it.
      out = out.replace(/<link rel="manifest"[^>]*>\s*/g, "");
      return out;
    },
  };
}

export default defineConfig({
  base: standalone ? "./" : "/",
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    // Однофайловая сборка: адреса разделов — после «#», service worker не нужен.
    __STANDALONE__: JSON.stringify(standalone),
  },
  plugins: [
    react(),
    devLogSink(),
    ...(standalone ? [inlineStandaloneAssets(), viteSingleFile()] : []),
  ],
  build: standalone
    ? {
        // single-file build settings
        assetsInlineLimit: 100_000_000,
        cssCodeSplit: false,
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : undefined,
  server: {
    port: 3030,
    strictPort: false,
    host: "127.0.0.1",
  },
});
