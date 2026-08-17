package com.irtibat.ailetakibi;

import android.Manifest;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.BatteryManager;
import android.os.Build;
import android.location.Location;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Aile Takibi - Arka plan GPS izleme eklentisi (Android).
 * Foreground Service üzerinden konum alır ve arka planda doğrudan Telegram'a gönderir.
 */
@CapacitorPlugin(
    name = "BackgroundGeo",
    permissions = {
        @Permission(alias = "location", strings = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        })
    }
)
public class BackgroundGeoPlugin extends Plugin {

    private LocationTracker tracker;
    private String botToken = "";
    private String chatId = "";
    private long intervalMs = 5000;
    private long lastSendAt = 0;

    @Override
    public void load() {
        tracker = new LocationTracker(getContext());
        tracker.setListener((location) -> {
            JSObject payload = new JSObject();
            payload.put("lat", location.getLatitude());
            payload.put("lng", location.getLongitude());
            payload.put("accuracy", location.getAccuracy());
            payload.put("timestamp", location.getTime());
            notifyListeners("location", payload);

            long now = System.currentTimeMillis();
            if (now - lastSendAt >= intervalMs) {
                lastSendAt = now;
                sendToTelegram(location.getLatitude(), location.getLongitude(), location.getTime());
            }
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
        botToken = call.getString("botToken", "");
        chatId = call.getString("chatId", "");
        intervalMs = call.getInt("intervalMs", 5000);
        lastSendAt = 0;

        if (!hasLocationPermission()) {
            requestPermissionForAlias("location", call, "locationPermsCallback");
            return;
        }
        beginTracking(call);
    }

    @PermissionCallback
    private void locationPermsCallback(PluginCall call) {
        if (hasLocationPermission()) {
            beginTracking(call);
        } else {
            call.reject("Konum izni verilmedi");
        }
    }

    private void beginTracking(PluginCall call) {
        if (tracker != null) tracker.start();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tracker != null) tracker.stop();
        call.resolve();
    }

    @PluginMethod
    public void getCurrentPosition(PluginCall call) {
        FusedLocationProviderClient client = LocationServices.getFusedLocationProviderClient(getContext());
        try {
            client.getLastLocation().addOnSuccessListener(loc -> {
                if (loc == null) {
                    call.reject("Konum henüz alınamadı");
                    return;
                }
                JSObject result = new JSObject();
                result.put("lat", loc.getLatitude());
                result.put("lng", loc.getLongitude());
                result.put("accuracy", loc.getAccuracy());
                result.put("timestamp", loc.getTime());
                call.resolve(result);
            }).addOnFailureListener(e -> call.reject("Konum alınamadı: " + e.getMessage()));
        } catch (SecurityException e) {
            call.reject("Konum izni yok");
        }
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    // MARK: - Telegram gönderimi (native, arka planda çalışır)

    private int[] batteryInfo() {
        IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        Intent status = getContext().registerReceiver(null, filter);
        int level = -1;
        int scale = -1;
        boolean charging = false;
        if (status != null) {
            level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            int plugged = status.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            charging = plugged != 0;
        }
        int pct = (scale > 0) ? (int)((level * 100) / scale) : 100;
        return new int[]{ pct, charging ? 1 : 0 };
    }

    private void sendToTelegram(double lat, double lng, long timestampMs) {
        if (botToken.isEmpty() || chatId.isEmpty()) return;

        int[] battery = batteryInfo();
        SimpleDateFormat sdf = new SimpleDateFormat("dd.MM.yyyy HH:mm:ss", Locale.forLanguageTag("tr"));
        String dateStr = sdf.format(new Date(timestampMs));
        String text = "📍 Aile Takibi\n" +
            "⏰ " + dateStr + "\n" +
            String.format(Locale.US, "🛰 Konum: %.6f, %.6f\n", lat, lng) +
            "🔗 Google Maps: https://www.google.com/maps?q=" + lat + "," + lng + "\n" +
            "📶 Bağlantı: bilinmiyor\n" +
            "🔋 Pil: %" + battery[0] + "\n" +
            "⚡ Şarj: " + (battery[1] == 1 ? "Evet" : "Hayır");

        final String body = "{\"chat_id\":\"" + chatId + "\",\"text\":\"" + escapeJson(text) + "\",\"disable_web_page_preview\":true}";

        new Thread(() -> {
            try {
                URL url = new URL("https://api.telegram.org/bot" + botToken + "/sendMessage");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                OutputStream os = conn.getOutputStream();
                os.write(body.getBytes(StandardCharsets.UTF_8));
                os.flush();
                os.close();
                conn.getInputStream().close();
                conn.disconnect();
            } catch (Exception ignored) {}
        }).start();
    }

    private String escapeJson(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "");
    }
}