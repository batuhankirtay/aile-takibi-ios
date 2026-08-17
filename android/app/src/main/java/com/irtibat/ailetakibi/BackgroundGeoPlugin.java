package com.irtibat.ailetakibi;

import android.Manifest;

import androidx.core.content.ContextCompat;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationServices;

/**
 * Aile Takibi - Arka plan GPS izleme eklentisi (Android).
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
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
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
}