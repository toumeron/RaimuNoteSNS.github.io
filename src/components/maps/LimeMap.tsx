import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './maps.css';
import type { PostWithAuthor } from '@/types';
import { normaliseMapLocation, type MapBounds, type MapLocation } from '@/lib/mapLocation';
export default function LimeMap({ posts = [], initialLocation, onBounds, onPin, onPost, onSelect }: {
    posts?: PostWithAuthor[];
    initialLocation?: MapLocation | null;
    onBounds?: (bounds: MapBounds) => void;
    onPin?: (point: MapLocation) => void;
    onPost?: (post: PostWithAuthor) => void;
    onSelect?: (point: MapLocation) => void;
}) {
    const element = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null);
    const postMarkers=useRef(new Map<string,{marker:L.Marker;signature:string}>());
    const handlers = useRef({ onBounds, onPin, onPost, onSelect });
    handlers.current = { onBounds, onPin, onPost, onSelect };
    const [point, setPoint] = useState<MapLocation | null>(initialLocation ?? null);
    const [tileFailed, setTileFailed] = useState(false);
    useEffect(() => {
        if (!element.current)
            return;
        const m = L.map(element.current, { worldCopyJump: true, zoomControl: false }).setView(initialLocation ? [initialLocation.latitude, initialLocation.longitude] : [36.2, 138.25], initialLocation ? 13 : 5);
        map.current = m;
        L.control.zoom({position:'bottomright',zoomInTitle:'拡大',zoomOutTitle:'縮小'}).addTo(m);
        const tiles = L.tileLayer(import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, keepBuffer: 1, updateWhenIdle: true, referrerPolicy: 'strict-origin-when-cross-origin',
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(m);
        tiles.on('tileerror', () => setTileFailed(true));
        tiles.on('load', () => { if (tiles.getContainer()?.querySelector('img.leaflet-tile-loaded'))
            setTileFailed(false); });
        let timer: ReturnType<typeof setTimeout>;
        const bounds = () => { clearTimeout(timer); timer = setTimeout(() => { if(map.current!==m)return; const b = m.getBounds(); const width = b.getEast() - b.getWest(); handlers.current.onBounds?.({ south: Math.max(-90, b.getSouth()), north: Math.min(90, b.getNorth()), west: width >= 360 ? -180 : normaliseMapLocation(0, b.getWest()).longitude, east: width >= 360 ? 180 : normaliseMapLocation(0, b.getEast()).longitude }); }, 250); };
        m.on('moveend', bounds);
        bounds();
        m.on('click', (e: L.LeafletMouseEvent) => { const selected = normaliseMapLocation(e.latlng.lat, e.latlng.lng); setPoint(selected); handlers.current.onSelect?.(selected); });
        const observer = new ResizeObserver(() => { if(map.current===m)m.invalidateSize({pan:false}); });
        observer.observe(element.current);
        return () => { clearTimeout(timer); observer.disconnect(); postMarkers.current.clear(); m.remove(); map.current = null; };
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
        const visibleIds=new Set(posts.map(post=>post.id));
        for(const [id,record] of postMarkers.current){if(!visibleIds.has(id)){record.marker.remove();postMarkers.current.delete(id);}}
        posts.forEach(post => {
            if (!post.mapLocation)
                return;
            const signature=JSON.stringify([post.mapLocation,post.author.displayName,post.author.avatarUrl,post.createdAt,post.content]);
            const existing=postMarkers.current.get(post.id);
            if(existing?.signature===signature)return;
            existing?.marker.remove();
            const marker = L.marker([post.mapLocation.latitude, post.mapLocation.longitude], {
                icon: L.divIcon({className:'lime-map-dot',html:'<span></span>',iconSize:[18,18],iconAnchor:[9,9]}),
                title:`${post.author.displayName}のポスト`,alt:`${post.author.displayName}のポスト`,
            }).addTo(map.current!);
            const popup = document.createElement('div'); popup.className='lime-map-preview';
            const header=document.createElement('div');header.className='lime-map-preview-author';
            const avatar=document.createElement('img');avatar.alt='';avatar.width=32;avatar.height=32;
            avatar.src=post.author.avatarUrl || 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="16" fill="#555"/><circle cx="16" cy="12" r="6" fill="#aaa"/><path d="M5 30a11 11 0 0 1 22 0" fill="#aaa"/></svg>');
            avatar.referrerPolicy='no-referrer';
            const identity=document.createElement('div');
            const name=document.createElement('strong');name.textContent=post.author.displayName;
            const time=document.createElement('time');time.dateTime=post.createdAt;time.textContent=new Date(post.createdAt).toLocaleString('ja-JP');
            identity.append(name,time);header.append(avatar,identity);
            const content=document.createElement('p');content.textContent=post.content.slice(0,220) || '画像のポスト';
            const detail=document.createElement('button');detail.type='button';detail.textContent='ポストを見る';detail.onclick=()=>handlers.current.onPost?.(post);
            popup.append(header,content,detail);
            postMarkers.current.set(post.id,{marker,signature});
            marker.bindPopup(popup,{className:'lime-map-post-popup',maxWidth:280,autoPan:true});

        });

    }, [posts]);
    return <div className="lime-map-wrap"><div ref={element} className="lime-map" aria-label="LimeMapsの地図"/>{tileFailed && <p className="lime-map-error">地図画像を読み込めませんでした。通信状況を確認してください。</p>}</div>;
}
