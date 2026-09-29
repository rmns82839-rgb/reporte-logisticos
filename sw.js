const CACHE_NAME = "reporte-logisticos-v133";
const ASSETS = [
  "./",
  "./index.html",
  "./auxiliar.html",
  "./exams.js",
  "./papeleria.js",
  "./chat.js",
  "./style.css",
  "./script.js",
  "./sync.js",
  "./people.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
  "./icons/favicon-32.png",
  "./icons/apple-touch-icon.png",
  "./icons/loading-moto.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  // Antes hacía self.skipWaiting() aquí, y la versión nueva tomaba control
  // sola apenas terminaba de instalarse — si alguien tenía la app abierta
  // a mitad de una tarjeta de paciente, se le recargaba la pantalla sin
  // avisar. Ahora se queda "esperando" y solo activa cuando la página le
  // manda el mensaje SKIP_WAITING (banner "Hay una versión nueva" en la
  // app), para que el auxiliar decida cuándo recargar.
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // Solo controlamos los archivos propios de la app (mismo origen).
  // Las peticiones a Firebase/Firestore/Google Fonts deben ir directo
  // a la red sin pasar por este caché — si las interceptáramos, se
  // podría romper la sincronización en tiempo real del coordinador.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Antes esto era "cache-first": si el archivo ya estaba guardado, lo
  // servía SIN revisar si había una versión nueva en el servidor. Eso
  // significa que cada mejora que se sube a Vercel se queda invisible
  // hasta que alguien note el banner "Hay una versión nueva" y lo toque —
  // y si no lo toca, sigue viendo la app vieja indefinidamente (fue lo que
  // pasó con las notificaciones del chat).
  // Ahora es "network-first": siempre intenta traer la versión más nueva
  // de internet primero, y solo si no hay conexión usa lo que quedó
  // guardado (para que la app siga funcionando sin señal).
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});