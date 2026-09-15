// Service worker: de app werkt offline op de telefoon.
// Bij een nieuwe versie hieronder het versienummer ophogen.
const VERSION = "v3";
const SHELL_CACHE = "wst-shell-" + VERSION;
const RUNTIME_CACHE = "wst-runtime-" + VERSION;

const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./storage.js",
  "./ocr.js",
  "./words.js",
  "./sound.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // Eén ontbrekend bestand mag de hele installatie niet blokkeren.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith("wst-") && n !== SHELL_CACHE && n !== RUNTIME_CACHE)
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // De pagina zelf: altijd eerst het netwerk, zodat een update meteen landt.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // De OCR-bestanden veranderen nooit en zijn groot: eerst uit de cache.
  // Zo werkt het herkennen van screenshots ook offline, na één keer gebruiken.
  if (url.pathname.includes("/vendor/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // Overige bestanden: meteen uit de cache, op de achtergrond verversen.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
