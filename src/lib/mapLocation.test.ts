import { describe, expect, it } from 'vitest';
import { extractPostMapLocation, mapBoundsContain } from './mapLocation';

describe('external post locations', () => {
  it.each([
    ['ここにいます geo:35.1,139.2', 35.1, 139.2],
    ['https://www.google.com/maps/search/?api=1&query=35.1%2C139.2', 35.1, 139.2],
    ['https://maps.apple.com/?ll=35.1,139.2', 35.1, 139.2],
    ['https://maps.google.com/?q=35.1,139.2', 35.1, 139.2],
    ['https://www.google.com/maps/place/example/data=!3d35.1!4d139.2', 35.1, 139.2],
    ['https://www.openstreetmap.org/?mlat=35.1&mlon=139.2', 35.1, 139.2],
  ])('reads explicitly shared coordinates: %s', (text, latitude, longitude) => {
    expect(extractPostMapLocation(text)).toEqual({ latitude, longitude });
  });
  it.each([
    '東京にいます', 'https://maps.app.goo.gl/abc',
    'https://www.google.com/maps/@35,139,10z',
    'https://evil.example/?q=35,139', 'geo:91,139', 'geo:35,181',
    'https://www.google.com/maps/search/?api=1&query=東京',
  ])('does not invent a location from %s', text => expect(extractPostMapLocation(text)).toBeNull());
  it('includes both sides of the date line and excludes invalid coordinates', () => {
    const bounds = { south: 30, north: 40, west: 170, east: -170 };
    expect(mapBoundsContain(bounds, { latitude: 35, longitude: 175 })).toBe(true);
    expect(mapBoundsContain(bounds, { latitude: 35, longitude: -175 })).toBe(true);
    expect(mapBoundsContain(bounds, { latitude: 35, longitude: 139 })).toBe(false);
    expect(mapBoundsContain(bounds, { latitude: NaN, longitude: 175 })).toBe(false);
  });
});

import {mapAreaContains,expandedMapBounds} from './mapLocation';
it('reuses a loaded area when zooming inward and detects leaving it',()=>{
 const original={south:34,north:37,west:138,east:141},loaded=expandedMapBounds(original);
 expect(mapAreaContains(loaded,{south:35,north:36,west:139,east:140})).toBe(true);
 expect(mapAreaContains(loaded,{south:43,north:44,west:140,east:141})).toBe(false);
});
it('does not treat a wider date-line crossing area as contained',()=>{
 expect(mapAreaContains({south:-80,north:80,west:170,east:-170},{south:0,north:20,west:175,east:-175})).toBe(true);
 expect(mapAreaContains({south:-80,north:80,west:170,east:-170},{south:0,north:20,west:170,east:180})).toBe(true);
});
