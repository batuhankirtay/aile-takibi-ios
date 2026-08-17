import Foundation
import Capacitor
import CoreLocation

/**
 * Aile Takibi - Arka plan GPS izleme eklentisi.
 * Core Location ile gerçek arka plan takibi sağlar.
 */
@objc(BackgroundGeoPlugin)
public class BackgroundGeoPlugin: CAPPlugin, CLLocationManagerDelegate {

    private let locationManager = CLLocationManager()
    private var isTracking = false
    private var pendingStartCall: CAPPluginCall?

    override public func load() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = kCLDistanceFilterNone
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.showsBackgroundLocationIndicator = true
    }

    @objc func start(_ call: CAPPluginCall) {
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
        locationManager.startUpdatingLocation()
        // Başlangıçta hemen bir konum iste
        locationManager.requestLocation()
    }

    // MARK: - CLLocationManagerDelegate

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let payload: PluginCallResultData = [
            "lat": loc.coordinate.latitude,
            "lng": loc.coordinate.longitude,
            "accuracy": loc.horizontalAccuracy,
            "timestamp": Int(loc.timestamp.timeIntervalSince1970 * 1000)
        ]
        notifyListeners("location", data: payload)
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let nsError = error as NSError
        if nsError.code == CLError.locationUnknown.rawValue {
            // GPS henüz fix almadı, beklemeye devam
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
}