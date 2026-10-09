import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './maps.css';
import {groupMapPosts} from '@/lib/mapPostGroups';
import type { PostWithAuthor } from '@/types';
import type { ExternalMapPostDetail } from '@/api/external-map-posts';
import { normaliseMapLocation, type MapBounds, type MapLocation, type MapPostPin } from '@/lib/mapLocation';
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
    const postMarkers=useRef(new Map<string,{marker:L.Marker|L.CircleMarker;signature:string}>());
    const handlers = useRef({ onBounds, onPin, onPost, onSelect, onLoadPost });
    handlers.current = { onBounds, onPin, onPost, onSelect, onLoadPost };
    const renderer=useRef<L.Canvas|null>(null);
    const [viewRevision,setViewRevision]=useState(0);
    const [point, setPoint] = useState<MapLocation | null>(initialLocation ?? null);
    useEffect(() => {
        if (!element.current)
            return;
        const m = L.map(element.current, { worldCopyJump: true, zoomControl: false, markerZoomAnimation:false, fadeAnimation:false }).setView(initialLocation ? [initialLocation.latitude, initialLocation.longitude] : [36.2, 138.25], initialLocation ? 13 : 5);
        map.current = m;
        renderer.current=L.canvas({padding:.25,tolerance:8});
        m.on('moveend',()=>setViewRevision(revision=>revision+1));
        const theme=new MutationObserver(()=>setViewRevision(revision=>revision+1));
        theme.observe(document.documentElement,{attributes:true,attributeFilter:['class']});
        L.control.zoom({position:'bottomright',zoomInTitle:'拡大',zoomOutTitle:'縮小'}).addTo(m);
        L.tileLayer(import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, keepBuffer: 1, updateWhenIdle: true, referrerPolicy: 'strict-origin-when-cross-origin',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &middot; <a href="https://www.geonames.org/">GeoNames</a>',
        }).addTo(m);
        let timer: ReturnType<typeof setTimeout>;
        const bounds = () => { clearTimeout(timer); timer = setTimeout(() => { if(map.current!==m)return; const b = m.getBounds(); const width = b.getEast() - b.getWest(); handlers.current.onBounds?.({ south: Math.max(-90, b.getSouth()), north: Math.min(90, b.getNorth()), west: width >= 360 ? -180 : normaliseMapLocation(0, b.getWest()).longitude, east: width >= 360 ? 180 : normaliseMapLocation(0, b.getEast()).longitude }); }, 250); };
        m.on('moveend', bounds);
        bounds();
        m.on('click', (e: L.LeafletMouseEvent) => { const selected = normaliseMapLocation(e.latlng.lat, e.latlng.lng); setPoint(selected); handlers.current.onSelect?.(selected); });
        const observer = new ResizeObserver(() => { if(map.current===m)m.invalidateSize({pan:true,animate:false}); });
        observer.observe(element.current);
        return () => { clearTimeout(timer); observer.disconnect(); theme.disconnect(); renderer.current=null; postMarkers.current.clear(); m.remove(); map.current = null; };
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
        });
        const dense=posts.length>250||groups.some(group=>group.posts.length>1);
        const visibleIds=new Set(groups.map(group=>group.key));
        for(const [id,record] of postMarkers.current){if(!visibleIds.has(id)){record.marker.remove();postMarkers.current.delete(id);}}
        const color=document.documentElement.classList.contains('dark')?'#ffed64':'#d59500';
        groups.forEach(group => {
            const post=group.posts[0];
            if (!post.mapLocation)return;
            const location=m.containerPointToLatLng(L.point(group.point.x,group.point.y));
            const signature=`${location.lat}:${location.lng}:${dense}:${color}:${group.posts.map(post=>post.id).join(',')}:${post.mapLocation.latitude}:${post.mapLocation.longitude}`;
            const existing=postMarkers.current.get(group.key);
            if(existing?.signature===signature)return;
            existing?.marker.remove();
            const marker:L.Marker|L.CircleMarker=dense?
                L.circleMarker(location,{renderer:renderer.current!,radius:Math.min(13,3.5+Math.log2(group.posts.length)),stroke:false,fillColor:color,fillOpacity:.9,bubblingMouseEvents:false}).addTo(m):
                L.marker(location, {
                    icon: L.divIcon({className:'lime-map-dot',html:'<span></span>',iconSize:[18,18],iconAnchor:[9,9]}),title:'ポストを開く',alt:'ポストを開く',
                }).addTo(m);
            marker.getElement()?.setAttribute('data-lime-map-post-id',post.id);
            const popup=document.createElement('div');popup.className='lime-map-preview';
            marker.bindPopup(popup,{className:'lime-map-post-popup',maxWidth:280,autoPan:true});
            let loading=false,loaded=false,index=0;
            const showPost=async()=>{
                if(loading||loaded)return;
                loading=true;marker.getPopup()?.getElement()?.classList.add('lime-map-popup-pending');
                try {
                    const detail=await handlers.current.onLoadPost?.(group.posts[index]);
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
                    if(group.posts.length>1){const next=document.createElement('button');next.type='button';next.className='lime-map-preview-next';next.textContent=`次のポスト（${index+1}/${group.posts.length}）`;next.onclick=()=>{index=(index+1)%group.posts.length;loaded=false;void showPost();};popup.append(next);}
                    loaded=true;marker.getPopup()?.getElement()?.classList.remove('lime-map-popup-pending');marker.getPopup()?.update();
                } catch {marker.closePopup();}
                finally{loading=false;}
            };
            marker.on('popupopen',showPost);
            postMarkers.current.set(group.key,{marker,signature});
        });

        element.current?.setAttribute('data-lime-map-renderer',dense?'canvas':'markers');
        element.current?.setAttribute('data-lime-map-post-count',String(posts.length));
        element.current?.setAttribute('data-lime-map-group-count',String(groups.length));
    }, [posts,viewRevision]);
    return <div className="lime-map-wrap"><div ref={element} className="lime-map" aria-label="LimeMapsの地図"/></div>;
}
