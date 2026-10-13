import L from 'leaflet';
import type {MapPostPin} from './mapLocation';

export function createMapPostIcon(post: MapPostPin, count=1): L.DivIcon {
    const root=document.createElement('div');root.className='lime-map-avatar-pin-body';
    const outline=document.createElementNS('http://www.w3.org/2000/svg','svg');outline.setAttribute('viewBox','0 0 40 48');outline.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M14 36.97 A18 18 0 1 1 26 36.97 L20 46 Z');path.setAttribute('fill','white');path.setAttribute('stroke','white');path.setAttribute('stroke-width','2');path.setAttribute('stroke-linejoin','round');outline.append(path);root.append(outline);
    const face=document.createElement('span');face.className='lime-map-avatar-pin-face';
    const fallback=document.createElement('span');fallback.className='lime-map-avatar-pin-fallback';
    fallback.textContent=Array.from(post.author?.displayName?.trim()||'人')[0];
    face.append(fallback);
    const url=post.author?.avatarUrl;
    if(url){
        try{
            const parsed=new URL(url,location.origin);
            if(['https:','http:'].includes(parsed.protocol)){
                const avatar=document.createElement('img');avatar.alt='';avatar.width=36;avatar.height=36;avatar.src=parsed.href;avatar.referrerPolicy='no-referrer';avatar.loading='lazy';avatar.decoding='async';
                avatar.onerror=()=>avatar.remove();face.append(avatar);
            }
        }catch{ /* Preserve the fallback for malformed profile image URLs. */ }
    }
    root.append(face);
    const rim=document.createElementNS('http://www.w3.org/2000/svg','svg');rim.classList.add('lime-map-avatar-pin-rim');rim.setAttribute('viewBox','0 0 40 48');rim.setAttribute('aria-hidden','true');
    const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');circle.setAttribute('cx','20');circle.setAttribute('cy','20');circle.setAttribute('r','18');circle.setAttribute('fill','none');circle.setAttribute('stroke','white');circle.setAttribute('stroke-width','2');rim.append(circle);root.append(rim);
    if(count>1){const badge=document.createElement('span');badge.className='lime-map-avatar-pin-count';badge.textContent=count>99?'99+':String(count);root.append(badge);}
    return L.divIcon({className:'lime-map-avatar-pin',html:root,iconSize:[40,48],iconAnchor:[20,47],popupAnchor:[0,-45]});
}

/** Keep the existing image node when a cluster count changes during zoom. */
export function updateMapPostIcon(element: HTMLElement | null, post: MapPostPin, count: number): void {
    if(!element)return;
    const body=element.querySelector('.lime-map-avatar-pin-body'),face=element.querySelector('.lime-map-avatar-pin-face');
    if(!body||!face)return;
    const replacement=createMapPostIcon(post,count).options.html as HTMLElement;
    const nextImage=replacement.querySelector('img'),oldImage=face.querySelector('img');
    if(nextImage&&nextImage.src!==oldImage?.src){
        nextImage.loading='eager';
        nextImage.onload=()=>{if(element.isConnected){oldImage?.remove();face.append(nextImage);}};
        if(nextImage.complete&&nextImage.naturalWidth){oldImage?.remove();face.append(nextImage);}
    }else if(!nextImage)oldImage?.remove();
    const fallback=face.querySelector('.lime-map-avatar-pin-fallback');if(fallback)fallback.textContent=Array.from(post.author?.displayName?.trim()||'人')[0];
    const countNode=body.querySelector('.lime-map-avatar-pin-count'),nextCount=replacement.querySelector('.lime-map-avatar-pin-count');
    if(countNode&&nextCount)countNode.textContent=nextCount.textContent;
    else if(countNode)countNode.remove();else if(nextCount)body.append(nextCount);
}
