package com.irtibat.ailetakibi;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BackgroundGeoPlugin.class);
        super.onCreate(savedInstanceState);
    }
}