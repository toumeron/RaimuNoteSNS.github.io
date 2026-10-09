export type MapLocation = {
    latitude: number;
    longitude: number;
};
export type MapBounds = {
    south: number;
    north: number;
    west: number;
    east: number;
};
export function validMapLocation(value: MapLocation): boolean {
    return Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
}
export function normaliseMapLocation(latitude: number, longitude: number): MapLocation {
    return { latitude: Number(latitude.toFixed(6)), longitude: Number((((longitude + 180) % 360 + 360) % 360 - 180).toFixed(6)) };
}

// Only explicit destination coordinates qualify; a map viewport or a profile
// address is not evidence that a post was made at that location.
export function extractPostMapLocation(text: string): MapLocation | null {
    const pair = (value: string | null): MapLocation | null => {
        const match = value?.trim().match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:,[-\d.]+)?$/);
        if (!match) return null;
        const point = { latitude: Number(match[1]), longitude: Number(match[2]) };
        return validMapLocation(point) ? point : null;
    };
    for (const token of text.match(/(?:https?:\/\/|geo:)[^\s<>"\[\]]+/gi) ?? []) {
        const clean = token.replace(/[。）、)]+$/, '');
        if (clean.toLowerCase().startsWith('geo:')) {
            const point = pair(clean.slice(4).split(/[;?]/)[0]);
            if (point) return point;
            continue;
        }
        try {
            const url = new URL(clean);
            let point: MapLocation | null = null;
            if (/^(?:www\.|maps\.)?google\.(?:com|co\.jp)$/.test(url.hostname) && (url.hostname.startsWith('maps.') || url.pathname.startsWith('/maps'))) {
                point = pair(url.searchParams.get('query')) ?? pair(url.searchParams.get('q'));
                const destination = url.pathname.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
                if (!point && destination) point = pair(`${destination[1]},${destination[2]}`);
            } else if (url.hostname === 'maps.apple.com') {
                point = pair(url.searchParams.get('ll')) ?? pair(url.searchParams.get('q'));
            } else if (/^(?:www\.)?openstreetmap\.org$/.test(url.hostname)) {
                const lat = url.searchParams.get('mlat'), lon = url.searchParams.get('mlon');
                point = lat !== null && lon !== null ? pair(`${lat},${lon}`) : null;
            }
            if (point) return point;
        } catch { /* Ordinary text and malformed links have no location. */ }
    }
    return null;
}

export function mapBoundsContain(bounds: MapBounds, point: MapLocation): boolean {
    return validMapLocation(point) && point.latitude >= bounds.south && point.latitude <= bounds.north &&
        (bounds.west <= bounds.east ? point.longitude >= bounds.west && point.longitude <= bounds.east : point.longitude >= bounds.west || point.longitude <= bounds.east);
}

export function expandedMapBounds(bounds: MapBounds): MapBounds {
    const latitudeSpan = Math.max(1, bounds.north - bounds.south);
    const longitudeSpan = bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
    const padding = Math.max(1, longitudeSpan / 2);
    return {
        south: Math.max(-90, bounds.south - latitudeSpan / 2), north: Math.min(90, bounds.north + latitudeSpan / 2),
        west: longitudeSpan + padding * 2 >= 360 ? -180 : normaliseMapLocation(0, bounds.west - padding).longitude,
        east: longitudeSpan + padding * 2 >= 360 ? 180 : normaliseMapLocation(0, bounds.east + padding).longitude,
    };
}

export type MapPostPin = { id: string; createdAt: string; mapLocation: MapLocation; source?: 'lime' | 'bluesky' | 'misskey' | 'flickr' };

export function mapAreaContains(outer:MapBounds,inner:MapBounds):boolean {
    const outerWidth=outer.west<=outer.east?outer.east-outer.west:360-outer.west+outer.east;
    const innerWidth=inner.west<=inner.east?inner.east-inner.west:360-inner.west+inner.east;
    return outerWidth>=innerWidth && [inner.south,inner.north].every(latitude=>[inner.west,inner.east].every(longitude=>mapBoundsContain(outer,{latitude,longitude})));
}
