import Foundation
import Capacitor
import CoreLocation
import UIKit

/**
 * Aile Takibi - Arka plan GPS izleme eklentisi.
 * Core Location ile gerçek arka plan takibi sağlar ve
 * konum verilerini arka planda doğrudan Telegram'a gönderir.
 */
@objc(BackgroundGeoPlugin)
public class BackgroundGeoPlugin: CAPPlugin, CLLocationManagerDelegate {

    private let locationManager = CLLocationManager()
    private var isTracking = false
    private var pendingStartCall: CAPPluginCall?

    private var botToken = ""
    private var chatId = ""
    private var intervalMs = 5000
    private var lastSendAt: TimeInterval = 0

    override public func load() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.showsBackgroundLocationIndicator = true

        UIDevice.current.isBatteryMonitoringEnabled = true
    }

    @objc func start(_ call: CAPPluginCall) {
        botToken = call.getString("botToken") ?? ""
        chatId = call.getString("chatId") ?? ""
        intervalMs = call.getInt("intervalMs", 5000) ?? 5000

        DispatchQueue.main.async {
            let status = CLLocationManager.authorizationStatus()
            switch status {
            case .authorizedAlways, .authorizedWhenInUse:
                self.beginTracking()
                call.resolve(["started": true])
            case .notDetermined:
                self.pendingStartCall = call
                self.locationManager.requestAlwaysAuthorization()
            case .denied, .restricted:
                call.reject("Konum izni reddedildi. Ayarlar'dan 'Her Zaman İzin Ver' seçin.")
            @unknown default:
                call.reject("Bilinmeyen izin durumu")
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        isTracking = false
        locationManager.stopUpdatingLocation()
        call.resolve(["stopped": true])
    }

    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        if let loc = locationManager.location {
            call.resolve([
                "lat": loc.coordinate.latitude,
                "lng": loc.coordinate.longitude,
                "accuracy": loc.horizontalAccuracy
            ])
        } else {
            call.reject("Konum henüz alınamadı")
        }
    }

    private func beginTracking() {
        isTracking = true
        lastSendAt = 0
        locationManager.startUpdatingLocation()
        locationManager.requestLocation()
    }

    // MARK: - CLLocationManagerDelegate

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let timestamp = Int(loc.timestamp.timeIntervalSince1970 * 1000)
        let payload: PluginCallResultData = [
            "lat": loc.coordinate.latitude,
            "lng": loc.coordinate.longitude,
            "accuracy": loc.horizontalAccuracy,
            "timestamp": timestamp
        ]
        notifyListeners("location", data: payload)

        // Aralık dolmuşsa arka planda da Telegram'a gönder
        let now = Date().timeIntervalSince1970
        let interval = Double(intervalMs) / 1000.0
        if isTracking && (now - lastSendAt) >= interval {
            lastSendAt = now
            sendToTelegram(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude, timestamp: timestamp)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let nsError = error as NSError
        if nsError.code == CLError.locationUnknown.rawValue {
            return
        }
        notifyListeners("error", data: ["message": error.localizedDescription])
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = CLLocationManager.authorizationStatus()
        if status == .authorizedAlways || status == .authorizedWhenInUse {
            if let call = pendingStartCall {
                pendingStartCall = nil
                beginTracking()
                call.resolve(["started": true])
            }
        } else if status == .denied {
            if let call = pendingStartCall {
                pendingStartCall = nil
                call.reject("Konum izni reddedildi")
            }
        }
    }

    // MARK: - Telegram gönderimi (native, arka planda çalışır)

    private func batteryInfo() -> (level: Int, charging: Bool) {
        let level = Int(UIDevice.current.batteryLevel * 100)
        let state = UIDevice.current.batteryState
        return (level == -1 ? 100 : level, state == .charging || state == .full)
    }

    private func sendToTelegram(lat: Double, lng: Double, timestamp: Int) {
        guard !botToken.isEmpty, !chatId.isEmpty else { return }

        let battery = batteryInfo()
        let dateStr = dateString(from: timestamp)
        let text =
            "📍 Aile Takibi\n" +
            "⏰ \(dateStr)\n" +
            String(format: "🛰 Konum: %.6f, %.6f\n", lat, lng) +
            "🔗 Google Maps: https://www.google.com/maps?q=\(lat),\(lng)\n" +
            "📶 Bağlantı: bilinmiyor\n" +
            "🔋 Pil: %\(battery.level)\n" +
            "⚡ Şarj: \(battery.charging ? "Evet" : "Hayır")"

        guard let url = URL(string: "https://api.telegram.org/bot\(botToken)/sendMessage") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "chat_id": chatId,
            "text": text,
            "disable_web_page_preview": true
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        request.timeoutInterval = 15

        let task = URLSession.shared.dataTask(with: request) { _, _, _ in }
        task.resume()
    }

    private func dateString(from timestampMs: Int) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(timestampMs) / 1000)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.dateFormat = "dd.MM.yyyy HH:mm:ss"
        return formatter.string(from: date)
    }
}