const VERSION = "2026-08-08-reliability-1";
const APP_CACHE = `mirror-2-app-${VERSION}`;
const ASSET_CACHE = `mirror-2-assets-${VERSION}`;
const CACHE_PREFIX = "mirror-2-";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.svg", "./icons/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          fetch(new Request(url, { cache: "reload" })).then((response) => {
            if (response.ok) return cache.put(url, response);
            return undefined;
          }).catch(() => undefined)
        )
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== APP_CACHE && key !== ASSET_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  if (isHtmlRequest(request)) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  if (isImmutableBuildAsset(request, url)) {
    event.respondWith(cacheFirstAsset(request));
    return;
  }

  if (isStaticShellAsset(request)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function isHtmlRequest(request) {
  return request.headers.get("accept")?.includes("text/html") || new URL(request.url).pathname.endsWith(".html");
}

function isImmutableBuildAsset(request, url) {
  return ["script", "style", "font", "image"].includes(request.destination) && /\/assets\/.+-[A-Za-z0-9_-]+\./.test(url.pathname);
}

function isStaticShellAsset(request) {
  return ["manifest", "image"].includes(request.destination) || APP_SHELL.some((path) => new URL(path, self.location.href).href === request.url);
}

async function networkFirstHtml(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || cache.match("./index.html") || Response.error();
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  if (cached) return cached;
  return (await fresh) || Response.error();
}
