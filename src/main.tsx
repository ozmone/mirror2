import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import "./styles.css";

declare global {
  interface Window {
    __mirrorThemeReady?: Promise<void>;
    __mirrorRecovering?: boolean;
    __mirrorRecoverFromStaleAsset?: () => void;
  }
}

async function boot() {
  await window.__mirrorThemeReady;
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  sessionStorage.removeItem(RECOVERY_FLAG);
}

void boot();

const RECOVERY_FLAG = "mirror-2-stale-recovery-attempted";

function showRecoveryScreen(message = "Mirror could not load this app version.") {
  const root = document.getElementById("root");
  if (!root) return;
  root.innerHTML = `
    <main style="min-height:100dvh;display:grid;place-items:center;padding:24px;background:#030303;color:#e7e1d7;font-family:Inter,system-ui,sans-serif;">
      <section style="width:min(440px,100%);border:1px solid rgba(235,231,222,.18);background:rgba(18,18,18,.9);padding:18px;">
        <h1 style="margin:0 0 8px;font-size:20px;">Update Needed</h1>
        <p style="margin:0 0 14px;line-height:1.45;color:#b7b0a5;">${message} Your local projects, chats, characters, archives, images, and settings are still stored in IndexedDB.</p>
        <button id="mirror-recovery-reload" style="min-height:42px;padding:0 14px;border:1px solid rgba(235,231,222,.18);background:transparent;color:#e7e1d7;">Reload current version</button>
      </section>
    </main>
  `;
  document.getElementById("mirror-recovery-reload")?.addEventListener("click", () => location.reload());
}

async function recoverFromStaleAsset() {
  if (window.__mirrorRecoverFromStaleAsset) {
    window.__mirrorRecoverFromStaleAsset();
    return;
  }
  if (window.__mirrorRecovering) return;
  window.__mirrorRecovering = true;
  if (sessionStorage.getItem(RECOVERY_FLAG)) {
    showRecoveryScreen("Automatic recovery already tried once.");
    return;
  }
  sessionStorage.setItem(RECOVERY_FLAG, "1");
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations ?? []).map((registration) => registration.update()));
  } finally {
    location.reload();
  }
}

window.addEventListener(
  "error",
  (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.tagName === "SCRIPT" || target?.tagName === "LINK") void recoverFromStaleAsset();
  },
  true
);

window.addEventListener("unhandledrejection", (event) => {
  const reason = String(event.reason?.message ?? event.reason ?? "");
  if (/Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|dynamically imported/i.test(reason)) {
    void recoverFromStaleAsset();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((registration) => {
        const notifyUpdate = () => window.dispatchEvent(new CustomEvent("mirror:update-available"));
        if (registration.waiting) notifyUpdate();
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) notifyUpdate();
          });
        });
        return registration.update();
      })
      .catch(() => undefined);
  });
}
