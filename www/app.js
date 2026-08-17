const CONFIG = {
  HIGH_ACCURACY: true,
  MAX_AGE: 0,
  TIMEOUT: 5000,
  SEND_INTERVAL_MS: 5 * 1000,
  LOW_BATTERY_INTERVAL_MS: 15 * 60 * 1000,
  LOW_BATTERY_THRESHOLD: 20,
  MOVEMENT_THRESHOLD_METERS: 100
};

const DB_NAME = "aile-takibi-db";
const DB_STORE = "queue";
const SETTINGS_KEY = "aile-takibi-settings";

const $ = (id) => document.getElementById(id);

// ---------- Native (Capacitor) tespiti ----------
const IS_NATIVE = typeof window !== "undefined" && !!window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
const NATIVE_GEO = IS_NATIVE && window.Capacitor.Plugins && window.Capacitor.Plugins.BackgroundGeo;

let tracking = false;
let timerId = null;
let watchId = null;
let lastSentPosition = null;
let currentBattery = { level: 1, charging: false };
let currentPosition = null;
let sendSeq = 0;
let lastError = null;

// ---------- Ayarlar ----------
function loadSettings() {
  const defaults = { botToken: "", chatId: "" };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      botToken: saved.botToken || defaults.botToken,
      chatId: saved.chatId || defaults.chatId
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function pushSettingsToSW() {
  const settings = loadSettings();
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: "SET_SETTINGS", settings });
  }
}

// ---------- IndexedDB kuyruğu ----------
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE, { keyPath: "id", autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function enqueue(payload) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).add({ payload, createdAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function queueCount() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readonly");
      const req = tx.objectStore(DB_STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

// ---------- Telegram ----------
function fetchWithTimeout(url, options, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function sendToTelegram(payload) {
  const settings = loadSettings();
  if (!settings.botToken || !settings.chatId) {
    throw new Error("Bot token veya chat id tanımlı değil");
  }
  const text =
    `📍 Aile Takibi #${payload.seq || "?"}\n` +
    `⏰ ${new Date(payload.timestamp).toLocaleString("tr-TR")}\n` +
    `🛰 Konum: ${payload.location.lat.toFixed(6)}, ${payload.location.lng.toFixed(6)}\n` +
    `🔗 Google Maps: https://www.google.com/maps?q=${payload.location.lat},${payload.location.lng}\n` +
    `📶 Bağlantı: ${payload.connection || "bilinmiyor"}\n` +
    `🔋 Pil: %${payload.battery}\n` +
    `⚡ Şarj: ${payload.charging ? "Evet" : "Hayır"}`;

  const res = await fetchWithTimeout(
    `https://api.telegram.org/bot${settings.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: settings.chatId, text, disable_web_page_preview: true })
    }
  );
  if (!res.ok) {
    throw new Error("Telegram API hatası: " + res.status);
  }
}

// ---------- Veri toplama ----------
function getPosition() {
  if (NATIVE_GEO) {
    return NATIVE_GEO.getCurrentPosition().then((pos) => ({
      lat: pos.lat,
      lng: pos.lng,
      accuracy: pos.accuracy
    }));
  }
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation desteklenmiyor"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
      (err) => reject(err),
      {
        enableHighAccuracy: CONFIG.HIGH_ACCURACY,
        maximumAge: CONFIG.MAX_AGE,
        timeout: CONFIG.TIMEOUT
      }
    );
  });
}

let nativeListener = null;

function startWatch() {
  if (!navigator.geolocation && !NATIVE_GEO) return;

  if (NATIVE_GEO) {
    stopWatch();
    NATIVE_GEO.start().then(() => {
      logEvent("native konum servisi başladı");
    }).catch((err) => updateStatus("Native konum hatası: " + err.message));

    nativeListener = NATIVE_GEO.addListener("location", (data) => {
      currentPosition = {
        lat: data.lat,
        lng: data.lng,
        accuracy: data.accuracy
      };
      const loc = document.getElementById("last-location");
      if (loc) loc.textContent = `${currentPosition.lat.toFixed(5)}, ${currentPosition.lng.toFixed(5)}`;
      updateStatus(`Konum güncellendi: ${currentPosition.lat.toFixed(5)}, ${currentPosition.lng.toFixed(5)}`);
    });
    return;
  }

  stopWatch();
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      currentPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      };
      const loc = document.getElementById("last-location");
      if (loc) loc.textContent = `${currentPosition.lat.toFixed(5)}, ${currentPosition.lng.toFixed(5)}`;
      updateStatus(`Konum güncellendi: ${currentPosition.lat.toFixed(5)}, ${currentPosition.lng.toFixed(5)}`);
    },
    (err) => updateStatus("Konum izleme hatası: " + err.message),
    {
      enableHighAccuracy: CONFIG.HIGH_ACCURACY,
      maximumAge: CONFIG.MAX_AGE,
      timeout: CONFIG.TIMEOUT
    }
  );
}

function stopWatch() {
  if (NATIVE_GEO) {
    if (nativeListener) {
      nativeListener.remove();
      nativeListener = null;
    }
    NATIVE_GEO.stop().catch(() => {});
    return;
  }
  if (watchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

async function getBattery() {
  try {
    if (!navigator.getBattery) return { level: 100, charging: false };
    const battery = await navigator.getBattery();
    const level = battery.level * 100;
    battery.addEventListener("levelchange", () => {
      currentBattery = { level: battery.level * 100, charging: battery.charging };
      onBatteryChange();
    });
    battery.addEventListener("chargingchange", () => {
      currentBattery = { level: battery.level * 100, charging: battery.charging };
      onBatteryChange();
    });
    return { level, charging: battery.charging };
  } catch {
    return { level: 100, charging: false };
  }
}

function getConnection() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return "bilinmiyor";
  const type = conn.type === "wifi" ? "WiFi" : conn.type || conn.effectiveType || "bilinmiyor";
  return type;
}

function getSSID() {
  // Tarayıcıda SSID'ye doğrudan erişim yoktur. Mevcut bağlantı tipi ile bilgi verilir.
  return getConnection();
}

// ---------- Mesafe ----------
function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Gönderim ----------
async function captureAndSend(reason) {
  try {
    if (!currentPosition) {
      currentPosition = await getPosition();
    }
    const battery = await getBattery();
    currentBattery = { level: battery.level, charging: battery.charging };

    sendSeq++;
    const payload = {
      seq: sendSeq,
      location: { lat: currentPosition.lat, lng: currentPosition.lng },
      ssid: getSSID(),
      connection: getConnection(),
      battery: Math.round(currentBattery.level),
      charging: currentBattery.charging,
      timestamp: Date.now()
    };

    await enqueue(payload);
    lastSentPosition = { lat: currentPosition.lat, lng: currentPosition.lng };

    try {
      await sendToTelegram(payload);
      lastError = null;
    } catch (err) {
      lastError = err.message || String(err);
      console.warn("Anında gönderim başarısız, kuyruğa alındı:", err);
      registerSync();
    }

    const errText = lastError ? ` · HATA: ${lastError}` : "";
    updateStatus(`Gönderim #${sendSeq} ${reason}${errText}`);
    renderQueueCount();
    return payload;
  } catch (err) {
    lastError = err.message || String(err);
    updateStatus("Hata: " + lastError);
  }
}

// ---------- Zamanlayıcı ----------
let tickCount = 0;
let lastTickEl = null;

function getIntervalMs() {
  if (currentBattery.level <= CONFIG.LOW_BATTERY_THRESHOLD) {
    return CONFIG.LOW_BATTERY_INTERVAL_MS;
  }
  return CONFIG.SEND_INTERVAL_MS;
}

function updateTickUI() {
  tickCount++;
  if (!lastTickEl) lastTickEl = document.getElementById("tick-info");
  if (lastTickEl) {
    lastTickEl.textContent = `Sayaç: ${tickCount} · son tik: ${new Date().toLocaleTimeString("tr-TR")}`;
  }
  const ind = document.getElementById("running-text");
  if (ind && tracking) ind.textContent = `Takip Aktif · gönderim #${sendSeq} · tik ${tickCount}`;
}

function tick() {
  if (!tracking) return;
  // Bir sonraki tik ÖNCE planlanır; gönderim asılı kalırsa döngü yine de sürer.
  timerId = setTimeout(tick, getIntervalMs());
  updateTickUI();
  captureAndSend("zamanlayıcı");
}

function startLoop() {
  stopLoop();
  timerId = setTimeout(tick, getIntervalMs());
}

function stopLoop() {
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
}

// ---------- Wake Lock (ekran uyanık kalır) ----------
let wakeLock = null;

async function acquireWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        if (tracking) acquireWakeLock();
      });
    }
  } catch (err) {
    console.warn("Wake Lock alınamadı:", err);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

function onBatteryChange() {
  if (tracking) {
    startLoop();
  }
  $("battery-status").textContent =
    `Pil: %${Math.round(currentBattery.level)} ${currentBattery.charging ? "⚡ (şarjda)" : ""}`;
}

// ---------- Background Sync ----------
async function registerSync() {
  if (!navigator.serviceWorker || !navigator.serviceWorker.ready) return;
  const reg = await navigator.serviceWorker.ready;
  if ("sync" in reg) {
    try {
      await reg.sync.register("location-sync");
    } catch (err) {
      console.warn("Background Sync kaydedilemedi:", err);
    }
  }
  if ("periodicSync" in reg && "PeriodicSyncManager" in window) {
    try {
      const status = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (status.state === "granted") {
        await reg.periodicSync.register("location-periodic", {
          minInterval: 15 * 60 * 1000
        });
      }
    } catch (err) {
      console.warn("Periodic Sync kullanılamıyor:", err);
    }
  }
}

// ---------- Bildirimler (şeffaf) ----------
async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

function showTransparentNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  navigator.serviceWorker.ready.then((reg) => {
    reg.showNotification(title, {
      body,
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: "aile-takibi-active",
      renotify: false
    });
  });
}

// ---------- Service Worker ----------
async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register("./service-worker.js");
    await navigator.serviceWorker.ready;
    pushSettingsToSW();
    return reg;
  } catch (err) {
    console.warn("Service Worker kaydedilemedi:", err);
  }
}

navigator.serviceWorker.addEventListener("message", (event) => {
  if (event.data && event.data.type === "GET_SETTINGS") {
    navigator.serviceWorker.controller.postMessage({ type: "SET_SETTINGS", settings: loadSettings() });
  }
});

// ---------- UI / Durum ----------
function updateStatus(text) {
  $("status").textContent = text;
}

async function renderQueueCount() {
  const count = await queueCount();
  $("queue-info").textContent =
    count > 0 ? `Bekleyen gönderim: ${count} (internet gelince iletilecek)` : "Tüm veriler gönderildi";
}

function setUI(state) {
  tracking = state;
  $("btn-start").disabled = state;
  $("btn-stop").disabled = !state;
  $("app-body").style.display = state ? "none" : "block";
  $("running-indicator").style.display = state ? "flex" : "none";
}

async function startTracking() {
  const settings = loadSettings();
  if (!settings.botToken || !settings.chatId) {
    alert("Önce ayarlardan Telegram bot token ve chat id girin.");
    $("settings-panel").open = true;
    return;
  }

  if (!navigator.geolocation && !NATIVE_GEO) {
    alert("Bu cihaz konum servisini desteklemiyor.");
    return;
  }

  try {
    await navigator.permissions.query({ name: "geolocation" });
  } catch {}

setUI(true);
  startWatch();
  acquireWakeLock();
  await captureAndSend("başlatma");
  await registerSync();
  startLoop();

  updateStatus("Takip aktif.");
}

function stopTracking() {
  setUI(false);
  stopLoop();
  stopWatch();
  releaseWakeLock();
  if (document.hidden || !document.hidden) {
    showTransparentNotification("Aile Takibi", "Konum paylaşımı durduruldu.");
  }
  updateStatus("Takip durduruldu.");
  renderQueueCount();
}

// ---------- Ayarlar formu ----------
function initSettings() {
  const settings = loadSettings();
  $("bot-token").value = settings.botToken || "";
  $("chat-id").value = settings.chatId || "";

  $("settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettings({
      botToken: $("bot-token").value.trim(),
      chatId: $("chat-id").value.trim()
    });
    pushSettingsToSW();
    $("settings-panel").open = false;
    updateStatus("Ayarlar kaydedildi.");
  });
}

// ---------- Görünürlük ----------
function logEvent(msg) {
  const el = document.getElementById("event-log");
  if (el) {
    el.textContent = `${new Date().toLocaleTimeString("tr-TR")} ${msg} · ` + el.textContent.slice(0, 300);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && tracking) {
    logEvent("arka plana geçti (iOS burada dondurur)");
  } else if (!document.hidden && tracking) {
    logEvent("geri geldi, gönderim yapılıyor");
    acquireWakeLock();
    if (!currentPosition) {
      getPosition().then((pos) => { currentPosition = pos; }).catch(() => {});
    }
    startLoop();
    captureAndSend("geri-dönüş");
  }
});

window.addEventListener("online", () => {
  updateStatus("İnternet bağlandı. Kuyruk gönderiliyor...");
  registerSync();
  renderQueueCount();
});

window.addEventListener("offline", () => {
  updateStatus("İnternet yok. Veriler cihazda tutuluyor.");
});

window.addEventListener("beforeunload", () => {
  if (tracking) {
    navigator.sendBeacon("./", new Blob(["ping"]));
  }
});

// ---------- Başlat ----------
(async function init() {
  initSettings();
  setUI(false);

  const battery = await getBattery();
  currentBattery = { level: battery.level, charging: battery.charging };
  $("battery-status").textContent =
    `Pil: %${Math.round(currentBattery.level)} ${currentBattery.charging ? "⚡ (şarjda)" : ""}`;
  $("conn-status").textContent = getConnection();

  await registerSW();
  await renderQueueCount();

  $("btn-start").addEventListener("click", startTracking);
  $("btn-stop").addEventListener("click", stopTracking);
})();