/**
 * Web (tarayıcı/PWA) geri dönüşü: native yoksa standart Geolocation API kullanılır.
 */
const webImpl = {
  async start() {
    if (!('geolocation' in navigator)) throw new Error('Geolocation desteklenmiyor');
    return { started: true };
  },
  async stop() {
    return { stopped: true };
  },
  async getCurrentPosition() {
    if (!('geolocation' in navigator)) throw new Error('Geolocation desteklenmiyor');
    const pos = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      })
    );
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy
    };
  }
};

export default webImpl;