import L from 'leaflet';
import type { Map as MapLibreMap, GeoJSONFeature } from 'maplibre-gl';
import { highwayNumbering } from './highwayNumbering';

const normalise = (name: string) => name.normalize('NFKC').replace(/\s/g,'').replace(/高速道路|自動車道|道路|高速$|道$/g,'');
const roadNumbers = new Map<string, string[]>();
for (const [name, codes] of Object.entries(highwayNumbering)) {
    const key = normalise(name), old = roadNumbers.get(key) ?? [];
    roadNumbers.set(key, [...new Set([...old, ...codes])]);
}
export function highwayIdentity(name: string, nearbyNumbers: string[] = []): {number:string;name:string} | null {
    const codes = roadNumbers.get(normalise(name));
    if (!codes?.length) {
        const urban=name.normalize('NFKC').match(/高速(?:道路)?(\d+[A-Z]?)号(.+)/);
        if(urban)return {number:urban[1],name:urban[2]};
        return null;
    }
    const number = codes.length === 1 ? codes[0] : nearbyNumbers.find(code=>codes.includes(code));
    if (!number) return null;
    return {number, name:name.normalize('NFKC').replace(/自動車道$/,'道').replace(/高速道路$|道路$/,'')};
}

/** GSI splits some annotations into glyph points: knj can be just one
 * character, while annoChar retains the complete road name. Coarse tiles
 * also use nRNo for expressway codes rather than uRNo. */
export function highwayAnnotationName(properties: Record<string,unknown>): string | null {
    for(const key of ['annoChar','knj','name']){
        const value=properties[key];if(typeof value==='string'&&value.trim())return value.trim();
    }
    return null;
}
export function highwayAnnotationNumber(properties: Record<string,unknown>): string | null {
    for(const key of ['uRNo','eRNo','nRNo']){
        const value=String(properties[key]??'').normalize('NFKC').trim();
        if(/^[EC]\d+[A-Z]?$/.test(value))return value;
        if(Number(properties.ftCode)===2903&&/^[1-9]\d*[A-Z]?$/.test(value))return value;
    }
    return null;
}

/** One native-text pill instead of two WebGL glyph/sprite layers.
 * DOM text keeps numbers visible even when map glyphs have not loaded.
 * Coordinates and road names come from GSI; numbering is checked against MLIT.
 */
export function installHighwayLabels(map: L.Map, gl: MapLibreMap): () => void {
    const pane = map.getPane('lime-highway-labels') ?? map.createPane('lime-highway-labels');
    pane.style.zIndex='350';pane.style.pointerEvents='none';
    const markers = new Map<string,{marker:L.Marker;signature:string}>();
    const textCanvas = document.createElement('canvas').getContext('2d');
    if(textCanvas)textCanvas.font='400 20px LimeMapGothic, sans-serif';
    const featurePoint = (feature:GeoJSONFeature):[number,number]|null => feature.geometry.type==='Point' ? feature.geometry.coordinates as [number,number] : null;
    const numberAnchors = new Map<string,{coords:[number,number];number:string}>();
    let frame = 0, disposed=false, fontsReady=!document.fonts;
    const fonts=document.fonts?Promise.allSettled([document.fonts.load('400 20px LimeMapGothic','中国道'),document.fonts.load('700 20px LimeMapGothic','E2A')]):Promise.resolve([]);
    const update = () => {
        frame=0;if(disposed||!fontsReady||!gl.isStyleLoaded())return;
        const active=new Set<string>(), occupied:{x:number;y:number;w:number}[]=[], usedRoads=new Map<string,L.Point[]>();
        if(gl.getZoom()>=8){
            const numbers=gl.querySourceFeatures('gsi',{sourceLayer:'transp'}).filter(f=>[2903,2904].includes(Number(f.properties.ftCode)));
            const names=gl.querySourceFeatures('gsi',{sourceLayer:'label'}).filter(f=>Number(f.properties.annoCtg)===411);
            const candidates=new Map<string,{latlng:L.LatLng;number:string;name:string}>();
            const namedPoints=names.map(f=>({feature:f,coords:featurePoint(f)})).filter(item=>item.coords&&highwayAnnotationName(item.feature.properties)!==null);
            const currentNumbers=numbers.map(f=>({coords:featurePoint(f),number:highwayAnnotationNumber(f.properties)})).filter(item=>item.coords&&item.number);
            // Detailed GSI tiles omit route-number points; retain already observed
            // anchors when zooming in, rather than losing the paired road label.
            for(const point of currentNumbers)numberAnchors.set(point.number+':'+point.coords.join(','),point);
            while(numberAnchors.size>500)numberAnchors.delete(numberAnchors.keys().next().value);
            const numberedPoints=[...numberAnchors.values()];
            const add=(coords:[number,number],identity:{number:string;name:string})=>{
                const latlng=L.latLng(coords[1],coords[0]);if(!map.getBounds().contains(latlng))return;
                const key=`${identity.number}:${identity.name}:${coords[0].toFixed(5)}:${coords[1].toFixed(5)}`;
                candidates.set(key,{latlng,...identity});
            };
            // Prefer the official number anchor. Names may be intentionally printed
            // outside the viewport; pair only names authorised for that same code.
            for(const point of numberedPoints){
                const latlng=L.latLng(point.coords[1],point.coords[0]);if(!map.getBounds().contains(latlng))continue;
                const matching=namedPoints.map(item=>({identity:highwayIdentity(highwayAnnotationName(item.feature.properties),[point.number]),distance:latlng.distanceTo([item.coords[1],item.coords[0]])})).filter(item=>item.identity?.number===point.number&&item.distance<20000).sort((a,b)=>a.distance-b.distance);
                if(matching[0])add(point.coords,matching[0].identity);
            }
            for(const {feature,coords} of namedPoints){
                const latlng=L.latLng(coords[1],coords[0]);if(!map.getBounds().contains(latlng))continue;
                const nearby=numberedPoints.map(point=>({number:point.number,distance:latlng.distanceTo([point.coords[1],point.coords[0]])})).filter(item=>item.distance<15000).sort((a,b)=>a.distance-b.distance).map(item=>item.number);
                const fullName=highwayAnnotationName(feature.properties);
                const identity=highwayIdentity(fullName,nearby);
                if(identity)add(coords,identity);
                else if(/高速|自動車道|バイパス/.test(fullName))add(coords,{number:'',name:fullName.normalize('NFKC').replace(/自動車道$/,'道').replace(/道路$/,'')});
            }
            // Stable priority and viewport collision checks keep wide-area views readable.
            for(const [key,candidate] of [...candidates.entries()].sort(([a],[b])=>a.localeCompare(b))){
                const p=map.latLngToContainerPoint(candidate.latlng),size=map.getSize();
                if(textCanvas)textCanvas.font='700 20px LimeMapGothic, sans-serif';
                const numberWidth=textCanvas?.measureText(candidate.number).width??candidate.number.length*12;
                if(textCanvas)textCanvas.font='400 20px LimeMapGothic, sans-serif';
                const width=Math.ceil(numberWidth+(textCanvas?.measureText(candidate.name).width??candidate.name.length*20)+(candidate.number?24:12));
                if(p.x<width/2||p.x>size.x-width/2||p.y<13||p.y>size.y-13)continue;
                const roadKey=candidate.number+candidate.name;
                if(usedRoads.get(roadKey)?.some(old=>old.distanceTo(p)<280))continue;
                if(occupied.some(r=>Math.abs(r.y-p.y)<34&&Math.abs(r.x-p.x)<(r.w+width)/2+12))continue;
                occupied.push({x:p.x,y:p.y,w:width});usedRoads.set(roadKey,[...(usedRoads.get(roadKey)??[]),p]);active.add(key);
                const signature=candidate.number+':'+candidate.name;
                if(markers.get(key)?.signature===signature)continue;
                markers.get(key)?.marker.remove();
                const pill=document.createElement('div');pill.className='lime-map-highway-pill';
                const number=document.createElement('span');number.className='lime-map-highway-number';number.textContent=candidate.number;
                const name=document.createElement('span');name.className='lime-map-highway-name';name.textContent=candidate.name;
                if(candidate.number)pill.append(number);
                pill.append(name);pill.setAttribute('aria-label',`${candidate.number} ${candidate.name}`);
                const marker=L.marker(candidate.latlng,{pane:'lime-highway-labels',interactive:false,keyboard:false,icon:L.divIcon({className:'lime-map-highway-badge',html:pill,iconSize:[width,26],iconAnchor:[width/2,13]})}).addTo(map);
                markers.set(key,{marker,signature});if(active.size>=24)break;
            }
        }
        for(const [key,record] of markers){if(!active.has(key)){record.marker.remove();markers.delete(key);}}
    };
    const schedule=()=>{if(!disposed&&!frame)frame=requestAnimationFrame(update);};
    gl.on('idle',schedule);map.on('moveend resize',schedule);fonts.then(()=>{fontsReady=true;schedule();});schedule();
    return ()=>{disposed=true;cancelAnimationFrame(frame);gl.off('idle',schedule);map.off('moveend resize',schedule);for(const {marker} of markers.values())marker.remove();markers.clear();};
}
