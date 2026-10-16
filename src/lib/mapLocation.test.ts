import { describe, expect, it } from "vitest";
import { extractPostMapLocation, mapBoundsContain, mapAreaContains, expandedMapBounds } from "@/lib/mapLocation";
import { groupMapPosts, createMapPostIcon, updateMapPostIcon } from "@/lib/mapPostIcon";
import { mapBlueskyFeedItemToPost } from "@/lib/bluesky";
import { mapMisskeyNote } from "@/lib/misskey";
import { highwayIdentity, highwayAnnotationName, highwayAnnotationNumber } from "@/lib/highwayLabels";
import { validateStyleMin, featureFilter } from "@maplibre/maplibre-gl-style-spec";
import { createLimeMapStyle } from "@/lib/limeMapStyle";

describe("mapLocation", () => {
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
});

describe("mapPostIcon", () => {
const post={id:'p',createdAt:'2026-10-14',mapLocation:{latitude:35,longitude:139},author:{displayName:'作者',avatarUrl:'https://images.example/avatar.png'}};
describe('map avatar pin',()=>{
 it('uses the author image without injecting profile text into HTML',()=>{
  const icon=createMapPostIcon(post),node=icon.options.html as HTMLElement;
  expect(node.querySelector('img')?.src).toBe(post.author.avatarUrl);
  expect(icon.options.iconSize).toEqual([40,48]);
  expect(node.querySelector('.lime-map-avatar-pin-rim circle')?.getAttribute('stroke-width')).toBe('2');
  expect(node.querySelector('.lime-map-avatar-pin-rim circle')?.getAttribute('r')).toBe('18');
  expect(node.querySelector('img')?.referrerPolicy).toBe('no-referrer');
 });
 it('keeps a simple fallback for missing or failed icons and rejects unsafe URLs',()=>{
  const node=createMapPostIcon({...post,author:{displayName:'<script>',avatarUrl:'javascript:alert(1)'}}).options.html as HTMLElement;
  expect(node.querySelector('img')).toBeNull();expect(node.querySelector('script')).toBeNull();expect(node.textContent).toBe('<');
  const imageNode=createMapPostIcon(post).options.html as HTMLElement;
  imageNode.querySelector('img')!.dispatchEvent(new Event('error'));expect(imageNode.querySelector('img')).toBeNull();expect(imageNode.textContent).toBe('作');
 });
 it('retains the image node when zoom changes the cluster count',()=>{
  const root=document.createElement('div');root.append(createMapPostIcon(post,2).options.html as HTMLElement);const image=root.querySelector('img');
  updateMapPostIcon(root,post,1);expect(root.querySelector('img')).toBe(image);expect(root.querySelector('.lime-map-avatar-pin-count')).toBeNull();
  updateMapPostIcon(root,post,3);expect(root.querySelector('img')).toBe(image);expect(root.querySelector('.lime-map-avatar-pin-count')?.textContent).toBe('3');
 });
 it('adds only a small count when posts overlap',()=>{
  expect((createMapPostIcon(post).options.html as HTMLElement).querySelector('.lime-map-avatar-pin-count')).toBeNull();
  expect((createMapPostIcon(post,5).options.html as HTMLElement).querySelector('.lime-map-avatar-pin-count')?.textContent).toBe('5');
 });
});
});

describe("highwayLabels", () => {
describe('combined highway labels',()=>{
    it('reads complete names and numbers from coarse split-character annotations',()=>{
        expect(highwayAnnotationName({annoChar:'阪和自動車道',knj:'自'})).toBe('阪和自動車道');
        expect(highwayAnnotationName({knj:'中国自動車道'})).toBe('中国自動車道');
        expect(highwayAnnotationNumber({ftCode:2904,nRNo:'E26'})).toBe('E26');
        expect(highwayAnnotationNumber({uRNo:'',nRNo:'E2A'})).toBe('E2A');
        expect(highwayAnnotationNumber({nRNo:163})).toBeNull();
        expect(highwayAnnotationNumber({ftCode:2903,uRNo:'11'})).toBe('11');
        expect(highwayIdentity('阪神高速１１号池田線')).toEqual({number:'11',name:'池田線'});
        expect(highwayIdentity(highwayAnnotationName({annoChar:'京奈和自動車道',knj:'動'}),['E24'])).toEqual({number:'E24',name:'京奈和道'});
    });
    it('pairs actual road names with the official route number and concise display name',()=>{
        expect(highwayIdentity('中国自動車道',['E2A'])).toEqual({number:'E2A',name:'中国道'});
        expect(highwayIdentity('山陽自動車道')).toEqual({number:'E2',name:'山陽道'});
        expect(highwayIdentity('播磨自動車道')).toEqual({number:'E29',name:'播磨道'});
        expect(highwayIdentity('第二京阪道路')).toEqual({number:'E89',name:'第二京阪'});
        expect(highwayIdentity('名神高速道路')).toEqual({number:'E1',name:'名神'});
    });
    it('does not invent a number for unrecognised road names',()=>{
        expect(highwayIdentity('商店街通り',['E2A'])).toBeNull();
        expect(highwayIdentity('阪神高速湾岸線',['E2'])).toBeNull();
    });
    it('uses nearby actual numbering for routes with section-dependent numbers',()=>{
        expect(highwayIdentity('松山自動車道')).toBeNull();
        expect(highwayIdentity('松山自動車道',['E2','E56'])).toEqual({number:'E56',name:'松山道'});
    });
});
});

describe("limeMapStyle", () => {
const matches = (id: string, properties: Record<string, unknown>) => {
    const layer = createLimeMapStyle(false).layers.find(layer => layer.id === id);
    return featureFilter('filter' in layer ? layer.filter : undefined, 'layers[0].filter').filter({zoom:13}, {type:1, properties});
};
describe('LimeMaps transport style', () => {
    it('validates light and dark styles without remote style files or paid credentials', () => {
        for(const dark of [false,true]) expect(validateStyleMin(createLimeMapStyle(dark))).toEqual([]);
    });
    it('keeps highways, ordinary roads and railways while excluding closed tracks', () => {
        expect(matches('highway',{ftCode:2701,motorway:1})).toBe(true);
        expect(matches('highway',{ftCode:52703})).toBe(true);
        expect(matches('highway',{ftCode:2701,motorway:0,rdCtg:2})).toBe(false);
        expect(matches('ordinary-roads',{ftCode:2701,motorway:0,rdCtg:2})).toBe(true);
        expect(matches('highway-facilities',{ftCode:2941,name:'吹田IC'})).toBe(true);
        expect(matches('railway',{ftCode:8201,railState:0,opeState:0})).toBe(true);
        expect(matches('railway',{ftCode:8201,railState:100,opeState:1})).toBe(false);
    });
    it('places station dots on station track geometry rather than annotation positions',()=>{
        const layer=createLimeMapStyle(false).layers.find(layer=>layer.id==='station-points');
        expect(layer['source-layer']).toBe('railway');
        expect(layer.layout['symbol-placement']).toBe('line-center');
        expect(matches('station-points',{annoCtg:422})).toBe(false);
        expect(matches('station-points',{ftCode:8201,staCode:'123',opeState:0})).toBe(true);
        expect(matches('station-points',{ftCode:8201,staCode:'0',opeState:0})).toBe(false);
    });
    it('keeps city, station and major facility names without residential labels or shops', () => {
        expect(matches('cities',{annoCtg:110})).toBe(true);
        expect(matches('cities',{annoCtg:210})).toBe(false);
        expect(matches('stations',{annoCtg:422})).toBe(true);
        expect(matches('major-facilities',{annoCtg:681})).toBe(true);
        expect(matches('major-facilities',{annoCtg:671})).toBe(false);

    });
});
});
