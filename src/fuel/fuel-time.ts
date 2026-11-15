export const fuelTimeZone = 'Europe/Bratislava';

const calendar = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuelTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
});

export function localFuelTime(instant: string): string {
    const date = new Date(instant);

    if (!Number.isFinite(date.getTime())) return '';

    const parts = Object.fromEntries(calendar.formatToParts(date).map(({ type, value }) => [type, value]));

    return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function fuelTimeCandidates(local: string): string[] {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local)) return [];

    const wallClock = Date.parse(`${local}Z`);

    if (!Number.isFinite(wallClock) || new Date(wallClock).toISOString().slice(0, 19) !== local) return [];

    // Ask Intl for offsets on both sides of a transition, then verify each round trip.
    const offsets = new Set(
        [-86_400_000, 0, 86_400_000]
            .map((shift) => {
                const probe = wallClock + shift;

                return Date.parse(`${localFuelTime(new Date(probe).toISOString())}Z`) - probe;
            })
            .filter(Number.isFinite)
    );

    return [...offsets]
        .map((offset) => new Date(wallClock - offset).toISOString())
        .filter((instant) => localFuelTime(instant) === local)
        .sort();
}

export function resolveFuelTime(local: string, preferred: string): string | null {
    const candidates = fuelTimeCandidates(local);

    // Preserve an unchanged record's original instant, including its milliseconds/offset choice.
    if (candidates.length && preferred && localFuelTime(preferred) === local) return new Date(preferred).toISOString();

    return candidates.length === 1 ? candidates[0] : null;
}

export function displayFuelTime(instant: string): string {
    const local = localFuelTime(instant);

    return `${local.slice(8, 10)}.${local.slice(5, 7)}.${local.slice(0, 4)} ${local.slice(11)}`;
}
