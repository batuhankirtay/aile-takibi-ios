import { registerPlugin } from '@capacitor/core';

/**
 * Aile Takibi özel Background Geolocation eklentisi.
 * - start(config): arka plan GPS izlemeyi başlatır
 * - stop(): durdurur
 * - getCurrentPosition(): anlık konum ister
 * - Konum güncellemeleri "location" olayı ile webview'e akar
 */
const BackgroundGeo = registerPlugin('BackgroundGeo', {
  web: () => import('./web'),
});

export default BackgroundGeo;