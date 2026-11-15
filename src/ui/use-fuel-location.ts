import { useEffect, useState } from 'react';
import { fuelLocationSchema, type FuelLocation } from '../fuel/fuel-location-schema';

export const LocationStatus = { IDLE: 'idle', LOADING: 'loading', AVAILABLE: 'available', UNAVAILABLE: 'unavailable' } as const;

export function useFuelLocation(enabled: boolean) {
    const [location, setLocation] = useState<FuelLocation | null>(null);
    const [status, setStatus] = useState<(typeof LocationStatus)[keyof typeof LocationStatus]>(LocationStatus.IDLE);

    useEffect(() => {
        if (!enabled) return;
        let active = true;
        // No watchPosition: capture only once for this new record and ignore late callbacks after leaving.
        const request = new Promise<GeolocationPosition>((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation is unavailable.'));
                return;
            }
            navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        });
        void request.then(
            (position) => {
                if (!active) return;
                const timestamp = new Date(position.timestamp);
                const result = fuelLocationSchema.safeParse({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    capturedAt: Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString()
                });
                if (result.success) {
                    setLocation(result.data);
                    setStatus(LocationStatus.AVAILABLE);
                } else setStatus(LocationStatus.UNAVAILABLE);
            },
            () => {
                if (active) setStatus(LocationStatus.UNAVAILABLE);
            }
        );
        return () => {
            active = false;
        };
    }, [enabled]);

    return {
        location: enabled ? location : null,
        status: enabled ? (status === LocationStatus.IDLE ? LocationStatus.LOADING : status) : LocationStatus.IDLE
    };
}
