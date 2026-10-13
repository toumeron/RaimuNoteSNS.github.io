import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';
import { setWorkerUrl } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { createLimeMapStyle, GSI_MAP_ATTRIBUTION } from '@/lib/limeMapStyle';
import './maps.css';
import { installHighwayLabels } from '@/lib/highwayLabels';
import {createMapPostIcon,updateMapPostIcon} from '@/lib/mapPostIcon';
import {groupMapPosts} from '@/lib/mapPostGroups';
import type { PostWithAuthor } from '@/types';
import type { ExternalMapPostDetail } from '@/api/external-map-posts';
import { normaliseMapLocation, type MapBounds, type MapLocation, type MapPostPin } from '@/lib/mapLocation';
// Bundle the module worker with Vite so dev and GitHub Pages base paths agree.
setWorkerUrl(mapWorkerUrl);

export default function LimeMap({ posts = [], initialLocation, onBounds, onPin, onPost, onSelect, onLoadPost }: {
    posts?: MapPostPin[];
    initialLocation?: MapLocation | null;
    onBounds?: (bounds: MapBounds) => void;
    onPin?: (point: MapLocation) => void;
    onPost?: (post: PostWithAuthor) => void;
    onLoadPost?: (pin: MapPostPin) => Promise<PostWithAuthor | ExternalMapPostDetail | null>;
    onSelect?: (point: MapLocation) => void;
}) {
    const element = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null);
    const postMarkers=useRef(new Map<string,{marker:L.Marker;signature:string;posts:MapPostPin[];retireTimer?:ReturnType<typeof setTimeout>;enterFrame?:number}>());
    const handlers = useRef({ onBounds, onPin, onPost, onSelect, onLoadPost });
    handlers.current = { onBounds, onPin, onPost, onSelect, onLoadPost };
    const renderer=useRef<L.Canvas|null>(null);
    const [viewRevision,setViewRevision]=useState(0);
    const [point, setPoint] = useState<MapLocation | null>(initialLocation ?? null);
    useEffect(() => {
        if (!element.current)
            return;
        const m = L.map(element.current, { worldCopyJump: false, minZoom: 5, maxZoom: 19, maxBounds: [[20,122],[46,154]], maxBoundsViscosity: 1, zoomControl: false, markerZoomAnimation:true, fadeAnimation:false }).setView(initialLocation ? [initialLocation.latitude, initialLocation.longitude] : [36.2, 138.25], initialLocation ? 13 : 5);
        if (!initialLocation) m.fitBounds([[24,123],[46,146]], {padding:[16,16],animate:false});
        map.current = m;
        renderer.current=L.canvas({padding:.25,tolerance:8});
        m.on('moveend',()=>setViewRevision(revision=>revision+1));
        let vector: L.MaplibreGL | null = null;
        let removeHighwayLabels: (() => void) | null = null;
        let dark = document.documentElement.classList.contains('dark');
        const theme=new MutationObserver(()=>{
            const nextDark = document.documentElement.classList.contains('dark');
            if (nextDark !== dark) { dark = nextDark; vector?.getMaplibreMap().setStyle(createLimeMapStyle(dark)); }
            setViewRevision(revision=>revision+1);
        });
        theme.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
        L.control.zoom({position:'bottomright',zoomInTitle:'拡大',zoomOutTitle:'縮小'}).addTo(m);
        const raster = L.tileLayer(import.meta.env.VITE_MAP_TILE_URL || 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
            maxZoom: 19, keepBuffer: 1, updateWhenIdle: true, referrerPolicy: 'strict-origin-when-cross-origin',
            attribution: import.meta.env.VITE_MAP_TILE_URL ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' : GSI_MAP_ATTRIBUTION,
        });
        const override = import.meta.env.VITE_MAP_TILE_URL;
        let vectorFailed = false;
        if (!override) {
            try {
                const context = document.createElement('canvas').getContext('webgl2');
                vectorFailed = !context;
                context?.getExtension('WEBGL_lose_context')?.loseContext();
            } catch { vectorFailed = true; }
        }
        const syncBasemap = () => {
            const useVector = !override && !vectorFailed;
            if (!useVector && vector) {
                vector.remove(); vector = null; m.attributionControl.removeAttribution(GSI_MAP_ATTRIBUTION);
            }
            if (useVector && !vector) {
                try {
                    vector = maplibreGL({style:createLimeMapStyle(dark), attributionControl:false, maxZoom:19}).addTo(m);
                    const gl = vector.getMaplibreMap();
                    removeHighwayLabels = installHighwayLabels(m, gl);
                    m.attributionControl.addAttribution(GSI_MAP_ATTRIBUTION);
                } catch { vectorFailed = true; vector?.remove(); vector = null; }
            }
            const showVector = useVector && !vectorFailed && vector;
            if (vector) vector.getContainer().style.visibility = showVector ? 'visible' : 'hidden';
            element.current?.classList.toggle('lime-map-vector', !!showVector);
            if (showVector) raster.remove(); else if (!m.hasLayer(raster)) raster.addTo(m);
        };
        m.on('moveend', syncBasemap);
        syncBasemap();
        let timer: ReturnType<typeof setTimeout>;
        const bounds = () => { clearTimeout(timer); timer = setTimeout(() => { if(map.current!==m)return; const b = m.getBounds(); const width = b.getEast() - b.getWest(); handlers.current.onBounds?.({ south: Math.max(-90, b.getSouth()), north: Math.min(90, b.getNorth()), west: width >= 360 ? -180 : normaliseMapLocation(0, b.getWest()).longitude, east: width >= 360 ? 180 : normaliseMapLocation(0, b.getEast()).longitude }); }, 250); };
        m.on('moveend', bounds);
        bounds();
        m.on('click', (e: L.LeafletMouseEvent) => { const selected = normaliseMapLocation(e.latlng.lat, e.latlng.lng); setPoint(selected); handlers.current.onSelect?.(selected); });
        const observer = new ResizeObserver(() => { if(map.current===m)m.invalidateSize({pan:true,animate:false}); });
        observer.observe(element.current);
        return () => { removeHighwayLabels?.(); clearTimeout(timer); observer.disconnect(); theme.disconnect(); renderer.current=null; for(const record of postMarkers.current.values()){clearTimeout(record.retireTimer);if(record.enterFrame)cancelAnimationFrame(record.enterFrame);}postMarkers.current.clear(); m.remove(); map.current = null; };
    }, []);
    useEffect(() => {
        if (!map.current || !point)
            return;
        const marker = L.marker([point.latitude, point.longitude], { draggable: true, icon: L.divIcon({ className: 'lime-map-pin lime-map-pin-selected', html: '<span></span>', iconSize: [28, 36], iconAnchor: [14, 36] }), title: 'この場所を選択', alt: 'この場所を選択' }).addTo(map.current);
        marker.on('click', () => handlers.current.onPin?.(point));
        marker.on('dragend', () => { const p = marker.getLatLng(), next = normaliseMapLocation(p.lat, p.lng); setPoint(next); handlers.current.onSelect?.(next); });
        return () => { marker.remove(); };
    }, [point]);
    useEffect(() => {
        if (!map.current)
            return;
        const m=map.current, visible=m.getBounds().pad(.15);
        const groups=groupMapPosts(posts,post=>{
            if(!visible.contains([post.mapLocation.latitude,post.mapLocation.longitude]))return null;
            return m.latLngToContainerPoint([post.mapLocation.latitude,post.mapLocation.longitude]);
        },48);

        const visibleIds=new Set(groups.map(group=>group.posts[0].id));
        for(const [id,record] of postMarkers.current){if(!visibleIds.has(id)&&!record.retireTimer){
            record.marker.setOpacity(0);record.retireTimer=setTimeout(()=>{if(postMarkers.current.get(id)===record){record.marker.remove();postMarkers.current.delete(id);}},200);
        }}
        groups.forEach(group => {
            const post=group.posts[0];
            if (!post.mapLocation)return;
            const location=m.containerPointToLatLng(L.point(group.point.x,group.point.y));
            const key=post.id;
            const signature=`${post.author?.avatarUrl}:${post.author?.displayName}:${group.posts.length}`;
            const existing=postMarkers.current.get(key);
            if(existing){
                clearTimeout(existing.retireTimer);existing.retireTimer=undefined;
                existing.posts=group.posts;existing.marker.setLatLng(location);existing.marker.setOpacity(1);
                if(existing.signature!==signature){updateMapPostIcon(existing.marker.getElement(),post,group.posts.length);existing.signature=signature;}
                return;
            }
            const marker = L.marker(location, {
                opacity:0,icon:createMapPostIcon(post,group.posts.length),title:group.posts.length>1?`${post.author?.displayName||'投稿者'}ほかのポスト ${group.posts.length}件`:`${post.author?.displayName||'投稿者'}のポストを開く`,alt:'投稿者のアイコンのポストピン',
            }).addTo(m);
            const record={marker,signature,posts:group.posts,enterFrame:0};
            record.enterFrame=requestAnimationFrame(()=>{record.enterFrame=0;if(map.current===m)marker.setOpacity(1);});
            marker.getElement()?.setAttribute('data-lime-map-post-id',post.id);
            const popup=document.createElement('div');popup.className='lime-map-preview';
            marker.bindPopup(popup,{className:'lime-map-post-popup',maxWidth:280,autoPan:true});
            let loading=false,loaded=false,index=0;
            const showPost=async()=>{
                if(loading||loaded)return;
                index=Math.min(index,record.posts.length-1);
                loading=true;marker.getPopup()?.getElement()?.classList.add('lime-map-popup-pending');
                try {
                    const detail=await handlers.current.onLoadPost?.(record.posts[index]);
                    if(!map.current || !marker.isPopupOpen()){loading=false;return;}
                    popup.replaceChildren();
                    if(!detail){marker.closePopup();return;}
                    const header=document.createElement('div');header.className='lime-map-preview-author';
                    const avatar=document.createElement('img');avatar.alt='';avatar.width=32;avatar.height=32;avatar.src=detail.author.avatarUrl||'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="16" fill="#aaa"/></svg>');avatar.referrerPolicy='no-referrer';
                    const identity=document.createElement('div'),name=document.createElement('strong'),time=document.createElement('time');
                    name.textContent=detail.author.displayName;time.dateTime=detail.createdAt;time.textContent=new Date(detail.createdAt).toLocaleString('ja-JP');identity.append(name,time);header.append(avatar,identity);
                    const content=document.createElement('p');content.textContent=detail.content.slice(0,220)||'画像のポスト';
                    const open=document.createElement('button');open.type='button';open.textContent='originalUrl' in detail?'Flickrで見る':'ポストを見る';open.onclick=()=>{if('originalUrl' in detail)window.open(detail.originalUrl,'_blank','noopener,noreferrer');else handlers.current.onPost?.(detail);};
                    popup.append(header,content,open);
                    if(record.posts.length>1){const next=document.createElement('button');next.type='button';next.className='lime-map-preview-next';next.textContent=`次のポスト（${index+1}/${record.posts.length}）`;next.onclick=()=>{index=(index+1)%record.posts.length;loaded=false;void showPost();};popup.append(next);}
                    loaded=true;marker.getPopup()?.getElement()?.classList.remove('lime-map-popup-pending');marker.getPopup()?.update();
                } catch {marker.closePopup();}
                finally{loading=false;}
            };
            marker.on('popupopen',showPost);
            postMarkers.current.set(key,record);
        });

        element.current?.setAttribute('data-lime-map-renderer','avatar-pins');
        element.current?.setAttribute('data-lime-map-post-count',String(posts.length));
        element.current?.setAttribute('data-lime-map-group-count',String(groups.length));
    }, [posts,viewRevision]);
    return <div className="lime-map-wrap"><div ref={element} className="lime-map" aria-label="LimeMapsの地図"/></div>;
}
