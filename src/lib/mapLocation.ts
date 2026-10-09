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
