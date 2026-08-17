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
public class BackgroundGeoPlugin: CAPPlugin, CLLocationManagerDelegate, URLSessionDelegate {

    private let locationManager = CLLocationManager()
    private var isTracking = false
    private var pendingStartCall: CAPPluginCall?
    private var sendTimer: Timer?
    private var backgroundSession: URLSession?
    private var backgroundCompletionHandler: (() -> Void)?

    private var botToken = ""
    private var chatId = ""
    private var intervalMs = 5000
    private var lastSendAt: TimeInterval = 0

    override public func load() {
        // Background URLSession: delegate ile tutulur, arka planda tamamlanır
        let config = URLSessionConfiguration.background(withIdentifier: "com.irtibat.ailetakibi.telegram")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 60
        backgroundSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)

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
        sendTimer?.invalidate()
        sendTimer = nil
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
        // Sürekli konum akışı: uygulamayı arka planda uyanık tutar
        locationManager.startUpdatingLocation()
        startSendTimer()
    }

    // Timer: konum güncellemesi gelmese bile son bilinen konumu gönderir
    private func startSendTimer() {
        sendTimer?.invalidate()
        let interval = max(Double(intervalMs) / 1000.0, 1.0)
        let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            guard let self = self, self.isTracking else { return }
            if let loc = self.locationManager.location {
                self.sendLocation(loc)
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        sendTimer = timer
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
        sendLocation(loc)
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

    private func sendLocation(_ loc: CLLocation) {
        guard isTracking else { return }
        let now = Date().timeIntervalSince1970
        let interval = Double(intervalMs) / 1000.0
        guard (now - lastSendAt) >= interval else { return }
        lastSendAt = now
        let timestamp = Int(loc.timestamp.timeIntervalSince1970 * 1000)
        sendToTelegram(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude, timestamp: timestamp)
    }

    // MARK: - Telegram gönderimi (native, arka planda çalışır)

    private func batteryInfo() -> (level: Int, charging: Bool) {
        let level = Int(UIDevice.current.batteryLevel * 100)
        let state = UIDevice.current.batteryState
        return (level == -1 ? 100 : level, state == .charging || state == .full)
    }

    private func sendToTelegram(lat: Double, lng: Double, timestamp: Int) {
        guard !botToken.isEmpty, !chatId.isEmpty, let session = backgroundSession else { return }

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

        let task = session.dataTask(with: request)
        task.resume()
    }

    private func dateString(from timestampMs: Int) -> String {
        let date = Date(timeIntervalSince1970: TimeInterval(timestampMs) / 1000)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "tr_TR")
        formatter.dateFormat = "dd.MM.yyyy HH:mm:ss"
        return formatter.string(from: date)
    }

    // MARK: - URLSessionDelegate (background session tamamlanması)

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        // Hata durumunda sessizce geç; bir sonraki aralıkta yeni gönderim dener
        if let error = error {
            NSLog("AileTakibi Telegram gönderim hatası: %@", error.localizedDescription)
        }
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletionHandler?()
            self.backgroundCompletionHandler = nil
        }
    }
}