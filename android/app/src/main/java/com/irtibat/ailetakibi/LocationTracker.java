package com.irtibat.ailetakibi;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.location.Location;

/**
 * Foreground Service'in yayınladığı konum güncellemelerini plugin'e iletir.
 */
public class LocationTracker {

    public interface Listener {
        void onLocation(Location location);
    }

    public static final String ACTION_LOCATION = "com.irtibat.ailetakibi.LOCATION_UPDATE";

    private final Context context;
    private Listener listener;
    private BroadcastReceiver receiver;

    public LocationTracker(Context context) {
        this.context = context.getApplicationContext();
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    public void start() {
        if (receiver != null) return;
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                if (!ACTION_LOCATION.equals(intent.getAction())) return;
                Location loc = intent.getParcelableExtra("location");
                if (loc != null && listener != null) listener.onLocation(loc);
            }
        };
        context.registerReceiver(receiver, new IntentFilter(ACTION_LOCATION));
        BackgroundLocationService.start(context);
    }

    public void stop() {
        if (receiver != null) {
            context.unregisterReceiver(receiver);
            receiver = null;
        }
        BackgroundLocationService.stop(context);
    }

    public Location getLastLocation() {
        return null;
    }
}