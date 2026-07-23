import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
// Geist (Vercel) — self-hosted variable fonts, bundled so the standalone build
// stays offline-friendly. Sans for UI, Mono for tabular numbers.
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App";

// HashRouter when opened from file:// (standalone single-file release),
// BrowserRouter when served over http(s). This is the app entry file,
// not a hot-reloadable component module, so the fast-refresh rule
// doesn't apply to the `Router` const here.
const isFileProtocol =
  typeof window !== "undefined" && window.location.protocol === "file:";
// eslint-disable-next-line react-refresh/only-export-components
const Router = isFileProtocol ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>
);

// Register service worker only when served over http(s) in production.
if (
  "serviceWorker" in navigator &&
  import.meta.env.PROD &&
  !isFileProtocol
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // ignore registration failures
    });
  });
}
