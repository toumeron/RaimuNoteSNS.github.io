import rows from './data/mapPlaces.json' with {type:'json'};
import stations from './data/mapStations.json' with {type:'json'};
import {mapBoundsContain,type MapBounds,type MapLocation} from '../../../src/lib/mapLocation.ts';
type Place={name:string;point:MapLocation;population:number;country:string;aliases:string[];station?:boolean};
const places:Place[]=rows.map(([name,lat,lon,population,country,aliases])=>({name:String(name),point:{latitude:Number(lat),longitude:Number(lon)},population:Number(population),country:String(country),aliases:aliases as string[]}));
places.push(...stations.map(([name,latitude,longitude,aliases])=>({name:String(name),point:{latitude:Number(latitude),longitude:Number(longitude)},population:0,country:'JP',aliases:aliases as string[],station:true})));
const names=new Map<string,Place>();
for(const place of [...places].sort((a,b)=>b.population-a.population))for(const name of place.aliases)if(name.length>1&&!names.has(name.toLowerCase()))names.set(name.toLowerCase(),place);
let matcher:RegExp|undefined;
const regions=new Set(['東京','東京都','Tokyo','东京','神奈川','埼玉','千葉','茨城','栃木','群馬']);
export function inferPostPlace(text:string):MapLocation|null {
 // Never use URLs, attached pages, author profiles, or quoted posts as evidence.
 const plain=text.replace(/https?:\/\/[^\s<>]+|geo:[^\s<>]+/gi,' ').replace(/@[\w.:-]+/g,' ');
 matcher??=new RegExp([...names.keys()].sort((a,b)=>b.length-a.length).map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'giu');
 matcher.lastIndex=0;
 const candidates:{place:Place;specificity:number;index:number}[]=[];
 for(const match of plain.matchAll(matcher)){
  const name=match[0],before=plain.slice(0,match.index),after=plain.slice(match.index!+name.length);
  if(/^[a-z\s.'-]+$/i.test(name)){
   if(/[a-z]$/i.test(before)||/^[a-z]/i.test(after))continue;
   if(name===name.toLowerCase()&&!/(?:#|\b(?:in|at|from|to)\s+)$/i.test(before))continue;
  }else if(/^[一-龥]{2,}/.test(after)&&! /^(?:都|府|県|市|区|町|村|駅|空港|旅行|観光|出張|方面|到着|滞在)/.test(after))continue;
  const place=names.get(name.toLowerCase())!;
  const regional=(regions.has(place.name)||place.aliases.some(alias=>['東京','東京都','Tokyo'].includes(alias)))&&!/^市/.test(after)&&name!=='千葉市';
  if(regional)continue;
  // A city/district in the same sentence is more useful than its prefecture.
  candidates.push({place,specificity:place.station?2:1,index:match.index!});
 }
 if(!candidates.length)return null;
 candidates.sort((a,b)=>b.specificity-a.specificity || a.place.population-b.place.population || a.index-b.index);
 return candidates[0].place.point;
}
export function mapPlaceSearchTerms(bounds:MapBounds):string[] {
 const visible=places.filter(place=>mapBoundsContain(bounds,place.point));
 const kanto=['東京駅','新宿駅','渋谷駅','品川駅','上野駅','池袋駅','秋葉原駅','横浜駅','大宮駅','千葉駅','東京','神奈川','埼玉','千葉','茨城','栃木','群馬','渋谷','新宿','池袋','秋葉原','横浜','川崎','さいたま','船橋','八王子','町田','柏'];
 const priority=kanto.filter(name=>visible.some(place=>place.aliases.includes(name)));
 const remaining=visible.sort((a,b)=>b.population-a.population).map(place=>place.name);
 return [...new Set([...priority,...remaining])].slice(0,48);
}
