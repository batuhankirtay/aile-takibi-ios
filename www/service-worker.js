const CACHE_NAME = "aile-takibi-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isJsOrManifest = url.pathname.endsWith(".js") || url.pathname.endsWith(".json");
  if (isJsOrManifest || event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

const DB_NAME = "aile-takibi-db";
const DB_STORE = "queue";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteFromQueue(ids) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    const store = tx.objectStore(DB_STORE);
    ids.forEach((id) => store.delete(id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function sendToTelegram(payload) {
  const settings = await self.settingsStore.get();
  const token = settings.botToken;
  const chatId = settings.chatId;
  if (!token || !chatId) throw new Error("Telegram ayarları eksik");

  const text =
    "📍 Aile Takibi\n" +
    `⏰ ${new Date(payload.timestamp).toLocaleString("tr-TR")}\n` +
    `🛰 Konum: ${payload.location.lat.toFixed(6)}, ${payload.location.lng.toFixed(6)}\n` +
    `🔗 Google Maps: https://www.google.com/maps?q=${payload.location.lat},${payload.location.lng}\n` +
    `📶 Bağlantı: ${payload.connection || "bilinmiyor"}\n` +
    `🔋 Pil: %${payload.battery}\n` +
    `⚡ Şarj: ${payload.charging ? "Evet" : "Hayır"}`;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  });
  if (!res.ok) throw new Error("Telegram API hatası: " + res.status);
}

self.settingsStore = {
  get() {
    return new Promise((resolve) => {
      self.clients.matchAll().then((clients) => {
        if (clients.length) {
          clients[0].postMessage({ type: "GET_SETTINGS" });
        }
      });
      const cached = self.settingsCache;
      resolve(
        cached || {
          botToken: "",
          chatId: "",
          enabled: false
        }
      );
    });
  },
  cache: null
};

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SET_SETTINGS") {
    self.settingsCache = event.data.settings;
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag === "location-sync") {
    event.waitUntil(flushQueue());
  }
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "location-periodic") {
    event.waitUntil(flushQueue());
  }
});

async function flushQueue() {
  try {
    const items = await readQueue();
    if (!items.length) return;
    for (const item of items) {
      try {
        await sendToTelegram(item.payload);
        await deleteFromQueue([item.id]);
      } catch (err) {
        // İlk hata diğerlerinin de aynı nedenden başarısız olacağını gösterir
        throw err;
      }
    }
  } catch (err) {
    console.warn("Queue gönderilemedi:", err);
    throw err;
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      if (clients.length) {
        clients[0].focus();
      } else {
        self.clients.openWindow("./");
      }
    })
  );
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Aile Takibi", body: "Bilgi" };
  event.waitUntil(
    self.registration.showNotification(data.title || "Aile Takibi", {
      body: data.body || "",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: "aile-takibi-push"
    })
  );
});