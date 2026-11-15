import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { icon, map, marker, tileLayer, type Marker } from 'leaflet';
import markerUrl from 'leaflet/dist/images/marker-icon.png';
import markerRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';
import 'leaflet/dist/leaflet.css';
import type { FuelLocation } from '../fuel/fuel-location-schema';

export default function LocationMap({
    location,
    onMove
}: {
    location: FuelLocation;
    onMove: (latitude: number, longitude: number) => void;
}) {
    const { t } = useTranslation('fuel');
    const element = useRef<HTMLDivElement>(null);
    const initialLocation = useRef(location);
    const pinRef = useRef<Marker | null>(null);
    const moved = useEffectEvent((latitude: number, longitude: number) => onMove(latitude, longitude));
    const [unavailable, setUnavailable] = useState(false);

    useEffect(() => {
        if (!element.current) return;
        const view = map(element.current).setView([initialLocation.current.latitude, initialLocation.current.longitude], 16);
        const tiles = tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });
        tiles.on('tileerror', () => setUnavailable(true));
        tiles.addTo(view);
        const pin = marker([initialLocation.current.latitude, initialLocation.current.longitude], {
            draggable: true,
            autoPan: true,
            icon: icon({
                iconUrl: markerUrl,
                iconRetinaUrl: markerRetinaUrl,
                shadowUrl,
                iconSize: [25, 41],
                iconAnchor: [12, 41],
                shadowSize: [41, 41]
            }),
            alt: t('location.pin')
        }).addTo(view);
        pinRef.current = pin;
        pin.on('dragend', () => {
            const point = pin.getLatLng().wrap();
            moved(point.lat, point.lng);
        });
        return () => {
            pinRef.current = null;
            view.remove();
        };
    }, [t]);

    useEffect(() => {
        pinRef.current?.setLatLng([location.latitude, location.longitude]);
    }, [location.latitude, location.longitude]);

    return (
        <>
            <div
                ref={element}
                role='region'
                aria-label={t('location.map')}
                className='relative isolate z-0 h-[280px] w-full rounded-sm border border-default'
            />
            {unavailable && <p className='text-sm'>{t('location.mapUnavailable')}</p>}
        </>
    );
}
