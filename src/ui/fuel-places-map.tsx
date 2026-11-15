import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import type { FuelPlace } from '../statistics/statistics.types';
import { FuelType } from '../generated/prisma/enums';
import { fuelUnits } from '../fuel/fuel-values';
import { displayFuelTime } from '../fuel/fuel-time';
import { displayNumber } from '../common/number';

const fuelColors = {
    [FuelType.PETROL]: 'var(--color-primary)',
    [FuelType.DIESEL]: 'var(--color-secondary-dark)',
    [FuelType.LPG]: 'var(--color-warning)',
    [FuelType.CNG]: 'var(--color-danger)',
    [FuelType.ELECTRIC]: 'var(--color-success)'
} satisfies Record<FuelType, string>;

export default function FuelPlacesMap({ places }: { places: FuelPlace[] }) {
    const { t } = useTranslation('statistics');
    const router = useRouter();
    const element = useRef<HTMLDivElement>(null);
    const [unavailable, setUnavailable] = useState(false);

    useEffect(() => {
        if (!element.current || !places.length) return;
        const view = L.map(element.current, { maxZoom: 19, scrollWheelZoom: false }).setView([places[0].latitude, places[0].longitude], 16);
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });
        tiles.on('tileerror', () => setUnavailable(true));
        tiles.addTo(view);
        const group = L.markerClusterGroup({
            maxClusterRadius: 50,
            showCoverageOnHover: false,
            iconCreateFunction: (cluster) => {
                const label = document.createElement('span');
                label.className = 'fuel-place-cluster';
                label.textContent = String(cluster.getChildCount());
                return L.divIcon({ html: label, className: 'fuel-place-cluster-icon', iconSize: [36, 36] });
            }
        });
        for (const place of places) {
            const dot = document.createElement('span');
            dot.className = 'fuel-place-dot';
            dot.style.backgroundColor = fuelColors[place.fuelType];
            const pin = L.marker([place.latitude, place.longitude], {
                icon: L.divIcon({ html: dot, className: 'fuel-place-icon', iconSize: [24, 28], iconAnchor: [12, 26] }),
                title: t(`vehicles:fuels.${place.fuelType}`),
                alt: t(`vehicles:fuels.${place.fuelType}`)
            });
            const popup = document.createElement('div');
            for (const text of [
                t(`vehicles:fuels.${place.fuelType}`),
                displayFuelTime(place.occurredAt),
                `${displayNumber(place.quantity, 0, 3)} ${fuelUnits[place.fuelType]} · ${displayNumber(place.totalPrice, 2)} €`
            ]) {
                const line = document.createElement('p');
                line.textContent = text;
                popup.append(line);
            }
            const open = document.createElement('button');
            open.type = 'button';
            open.className = 'text-primary underline';
            open.textContent = t('places.openRecord');
            open.addEventListener('click', () => {
                void router.navigate({ to: '/fuel/$recordId', params: { recordId: place.id } });
            });
            popup.append(open);
            pin.bindPopup(popup);
            group.addLayer(pin);
        }
        group.addTo(view);
        view.fitBounds(group.getBounds(), { padding: [30, 30], maxZoom: 16 });
        return () => {
            view.remove();
        };
    }, [places, router, t]);

    return (
        <>
            <div
                className='flex flex-wrap gap-lg'
                aria-label={t('places.legend')}
            >
                {[...new Set(places.map((place) => place.fuelType))].map((type) => (
                    <span
                        key={type}
                        className='flex items-center gap-sm'
                    >
                        <span
                            className='size-md rounded-full'
                            style={{ backgroundColor: fuelColors[type] }}
                        />
                        {t(`vehicles:fuels.${type}`)}
                    </span>
                ))}
            </div>
            <div
                ref={element}
                role='region'
                aria-label={t('places.map')}
                className='relative isolate z-0 h-[400px] w-full rounded-sm border border-default'
            />
            {unavailable && <p className='text-sm'>{t('places.mapUnavailable')}</p>}
        </>
    );
}
