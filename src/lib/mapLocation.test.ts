import { describe, expect, it } from "vitest";
import { extractPostMapLocation, mapBoundsContain, mapAreaContains, expandedMapBounds } from "./mapLocation";
import { groupMapPosts } from "./mapPostGroups";
import { mapBlueskyFeedItemToPost } from "./bluesky";
import { mapMisskeyNote } from "./misskey";

describe("mapLocation", () => {
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
it('reuses a loaded area when zooming inward and detects leaving it',()=>{
 const original={south:34,north:37,west:138,east:141},loaded=expandedMapBounds(original);
 expect(mapAreaContains(loaded,{south:35,north:36,west:139,east:140})).toBe(true);
 expect(mapAreaContains(loaded,{south:43,north:44,west:140,east:141})).toBe(false);
});
it('does not treat a wider date-line crossing area as contained',()=>{
 expect(mapAreaContains({south:-80,north:80,west:170,east:-170},{south:0,north:20,west:175,east:-175})).toBe(true);
 expect(mapAreaContains({south:-80,north:80,west:170,east:-170},{south:0,north:20,west:170,east:180})).toBe(true);
});
});

describe("mapPostGroups", () => {
it('groups 10,000 dense posts without dropping any and skips offscreen projections',()=>{
 const posts=Array.from({length:10000},(_,i)=>({id:String(i),createdAt:'2026-10-10T00:00:00Z',mapLocation:{latitude:35.68,longitude:139.76}}));
 const groups=groupMapPosts(posts,()=>({x:100,y:100}));expect(groups).toHaveLength(1);expect(groups[0].posts).toHaveLength(10000);
 expect(groupMapPosts(posts,()=>null)).toHaveLength(0);
});
it('keeps separate cells separately selectable',()=>{
 const posts=[0,1,2].map(i=>({id:String(i),createdAt:'2026-10-10T00:00:00Z',mapLocation:{latitude:i,longitude:139}}));
 const groups=groupMapPosts(posts,p=>({x:p.mapLocation.latitude*25,y:0}));expect(groups).toHaveLength(3);expect(groups.flatMap(g=>g.posts)).toEqual(posts);
});


it('keeps coincident posts in one marker at their original position',()=>{
 const posts=['one','two'].map(id=>({id,createdAt:'2026-10-10T00:00:00Z',mapLocation:{latitude:35.68113,longitude:139.76706}}));
 const groups=groupMapPosts(posts,()=>({x:120,y:80}));
 expect(groups).toHaveLength(1);expect(groups[0].point).toEqual({x:120,y:80});expect(groups[0].posts).toEqual(posts);
});
});

describe("externalMapMapping", () => {
it('retains a Bluesky destination hidden behind rich text facets', () => {
  const post = mapBlueskyFeedItemToPost({ post: {
    uri: 'at://did:plc:test/app.bsky.feed.post/location', author: { did: 'did:plc:test', handle: 'map.bsky.social' },
    record: { text: '地図', facets: [{ index: { byteStart: 0, byteEnd: 6 }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://maps.apple.com/?ll=35,139' }] }] },
  } });
  expect(post?.mapLocation).toEqual({ latitude: 35, longitude: 139 });
});
it('uses a Misskey note destination and never a private note or quoted location', () => {
  const note = { id: 'test', text: 'geo:35,139', createdAt: '2026-10-09T00:00:00Z', visibility: 'public', user: { id: 'author', username: 'author' } };
  expect(mapMisskeyNote(note)?.mapLocation).toEqual({ latitude: 35, longitude: 139 });
  expect(mapMisskeyNote({ ...note, visibility: 'followers' })).toBeNull();
  expect(mapMisskeyNote({ ...note, text: '引用へのコメント', renote: note })?.mapLocation).toBeNull();
});
});
