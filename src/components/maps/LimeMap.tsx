import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { maplibreGL } from "@maplibre/maplibre-gl-leaflet";
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl, type Map as MapLibreMap, type GeoJSONFeature, type ExpressionSpecification, type FilterSpecification, type LineLayerSpecification, type SymbolLayerSpecification, type StyleSpecification } from "maplibre-gl";
import mapWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { type PostWithAuthor } from "@/types/index";
import { type ExternalMapPostDetail } from "@/api/external-posts";
import { normaliseMapLocation, type MapBounds, type MapLocation, type MapPostPin } from "@/lib/mapLocation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle, Button } from "@/components/ui/button";
import { setPostMapLocation } from "@/api/posts";
import { toast } from "sonner";

// mapPostIcon
function createMapPostIcon(post: MapPostPin, count=1): L.DivIcon {
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
function updateMapPostIcon(element: HTMLElement | null, post: MapPostPin, count: number): void {
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

// mapPostGroups
type MapPostGroup={key:string;posts:MapPostPin[];point:{x:number;y:number}};
// Only visible points are projected. A crowded cell shares one avatar pin, while
// every original post remains selectable from its popup.
function groupMapPosts(posts:MapPostPin[],project:(post:MapPostPin)=>{x:number;y:number}|null,cellSize=24):MapPostGroup[]{
 const groups=new Map<string,MapPostGroup>();
 for(const post of posts){const point=project(post);if(!point)continue;const key=`${Math.floor(point.x/cellSize)}:${Math.floor(point.y/cellSize)}`;const group=groups.get(key);if(group){const n=group.posts.length;group.point={x:(group.point.x*n+point.x)/(n+1),y:(group.point.y*n+point.y)/(n+1)};group.posts.push(post);}else groups.set(key,{key,posts:[post],point:{...point}});}
 return [...groups.values()];
}

// limeMapStyle
const GSI_MAP_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/vector/" target="_blank" rel="noopener noreferrer">国土地理院</a>';

/** A small transport map, using GSI's documented vector feature categories.
 * Keep the geographic geometry: this is a simplified map, not a distorted route diagram.
 * https://maps.gsi.go.jp/help/pdf/vector/dataspec.pdf
 */
function createLimeMapStyle(dark: boolean): StyleSpecification {
    const land = dark ? '#25282a' : '#e2e1dd';
    const water = dark ? '#171b1e' : '#f5f6f5';
    const ink = dark ? '#e1e3e1' : '#333936';
    const muted = dark ? '#a7aca8' : '#6e756f';
    const highway = dark ? '#7dad6a' : '#588847';
    const station = dark ? '#c995e5' : '#9552b5';
    const casing = dark ? '#4d554e' : '#bbc1b8';
    const source = 'gsi';
    const highwayFilter: FilterSpecification = ['any', ['==', 'motorway', 1], ['in', 'ftCode', 52703, 52704]];
    const railFilter: FilterSpecification = ['any', ['in', 'ftCode', 58201, 58203, 58204], ['all', ['==', 'ftCode', 8201], ['in', 'railState', 0, 1, 2, 3, 5, 100, 200, 300, 500], ['!=', 'opeState', 1]]];
    const line = (id: string, sourceLayer: string, filter: FilterSpecification, color: string, width: number, minzoom: number): LineLayerSpecification => ({
        id, type: 'line', source, 'source-layer': sourceLayer, filter, minzoom,
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, width * .45, 10, width, 16, width * 1.8]},
    });
    const label = (id: string, sourceLayer: string, filter: FilterSpecification, size: number, color: string, minzoom: number, maxzoom?: number): SymbolLayerSpecification => ({
        id, type: 'symbol', source, 'source-layer': sourceLayer, filter, minzoom, ...(maxzoom ? {maxzoom} : {}),
        layout: {'text-field': ['get', 'knj'], 'text-font': ['NotoSansCJKjp-Regular'], 'text-size': size,
            'text-max-width': 9, 'text-padding': 5, 'symbol-sort-key': ['coalesce',['get','ftCode'],0], 'text-allow-overlap': false, 'text-ignore-placement': false},
        paint: {'text-color': color, 'text-halo-color': land, 'text-halo-width': 1.5},
    });
    const restArea: ExpressionSpecification = ['any', ...['SA','PA','ＳＡ','ＰＡ','サービスエリア','パーキングエリア'].map(name => ['in', name, ['get','knj']]) ] as ExpressionSpecification;
    const facilityColor: ExpressionSpecification = ['case', restArea, highway, ink];
    const offsetLabel = (id: string, filter: FilterSpecification, color: string): SymbolLayerSpecification => {
        const layer = label(id, 'label', filter, 12, color, 11);
        return {...layer, layout: {...layer.layout, 'text-variable-anchor': ['left','right','top','bottom'], 'text-radial-offset': .7}};
    };
    return {
        version: 8,
        glyphs: 'https://maps.gsi.go.jp/xyz/noto-jp/{fontstack}/{range}.pbf',
        sources: {
            gsi: {type: 'vector', tiles: ['https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/{z}/{x}/{y}.pbf'], minzoom: 4, maxzoom: 16, bounds: [122,20,154,46], attribution: GSI_MAP_ATTRIBUTION},
            // The transport tiles omit ocean polygons at national zoom levels.
            // Administrative land polygons provide a Japan-only coastline there.
            'gsi-land': {type:'vector', tiles:['https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf'], minzoom:4, maxzoom:7, bounds:[122,20,154,46], attribution:GSI_MAP_ATTRIBUTION},
        },
        layers: [
            {id: 'background', type: 'background', paint: {'background-color': ['step',['zoom'],water,8,land]}},
            {id:'japan-land',type:'fill',source:'gsi-land','source-layer':'AdmArea',maxzoom:8,paint:{'fill-color':land}},
            {id: 'water', type: 'fill', source, 'source-layer': 'waterarea', paint: {'fill-color': water}},
            line('coast', 'coastline', ['in', 'ftCode', 55101, 55102, 55103, 5101, 5102, 5103], casing, .7, 4),
            line('ordinary-roads', 'road', ['all', ['in', 'ftCode', 2701, 2702, 2703, 2704], ['!=', 'motorway', 1]], dark ? '#3e4546' : '#c5c7c4', 1, 11),
            line('major-roads', 'road', ['any',['==','ftCode',52701],['all', ['in', 'ftCode', 2701, 2702, 2703, 2704], ['==', 'rdCtg', 0], ['!=', 'motorway', 1]]], dark ? '#596160' : '#bec2bc', 1.8, 4),
            {...line('highway-casing', 'road', highwayFilter, dark ? '#879282' : '#a0a69d', 5, 4),paint:{'line-color':dark ? '#879282' : '#a0a69d','line-width':['interpolate',['linear'],['zoom'],4,4,8,5.5,12,8,16,13]}},
            {...line('highway', 'road', highwayFilter, dark ? '#d5dbcf' : '#ffffff', 3, 4),paint:{'line-color':dark ? '#d5dbcf' : '#ffffff','line-width':['interpolate',['linear'],['zoom'],4,2.5,8,3.8,12,6,16,10.5]}},
            line('railway', 'railway', railFilter, muted, 2, 4),
            {...line('railway-sleepers', 'railway', railFilter, land, 1.3, 8), paint: {
                'line-color': land, 'line-width': 1.3, 'line-dasharray': [2, 3],
            }},
            label('large-cities', 'symbol', ['in', 'ftCode', 51301, 51302], 14, ink, 4, 8),
            label('regional-cities', 'symbol', ['==', 'ftCode', 51303], 12, ink, 6, 8),
            label('cities', 'label', ['==', 'annoCtg', 110], 14, ink, 8),
            label('prefectures', 'label', ['==', 'annoCtg', 140], 12, muted, 8, 11),
            label('airports', 'label', ['==', 'annoCtg', 441], 12, ink, 10),
            // Annotation points mark label placement, not the physical station.
            // Place dots on the center of the actual station track geometry.
            {id: 'station-points', type: 'symbol', source, 'source-layer': 'railway', minzoom: 11,
                filter: ['all',['==','ftCode',8201],['has','staCode'],['!=','staCode','0'],['!=','staCode',0],['!=','opeState',1]],
                layout: {'text-field':'●','text-font':['NotoSansCJKjp-Regular'],'text-size':12,'symbol-placement':'line-center','text-allow-overlap':true,'text-rotation-alignment':'viewport'},
                paint: {'text-color':station,'text-halo-color':land,'text-halo-width':1}},
            offsetLabel('stations', ['==','annoCtg',422], station),
            {id:'highway-facility-points',type:'symbol',source,'source-layer':'transp',minzoom:11,maxzoom:14,
                filter:['in','ftCode',2941,2942,2943,2944,2945],
                layout:{'text-field':['match',['get','ftCode'],2943,'■',2944,'■',2942,'◇','●'],
                    'text-font':['NotoSansCJKjp-Regular'],'text-size':12,'text-allow-overlap':true},
                paint:{'text-color':['match',['get','ftCode'],2943,highway,2944,highway,ink],'text-halo-color':land,'text-halo-width':1}},
            {id:'highway-facilities',type:'symbol',source,'source-layer':'transp',minzoom:11,maxzoom:14,
                filter:['in','ftCode',2941,2942,2943,2944,2945],
                layout:{'text-field':['get','name'],'text-font':['NotoSansCJKjp-Regular'],'text-size':12,
                    'text-variable-anchor':['left','right','top','bottom'],'text-radial-offset':.7,'text-padding':5},
                paint:{'text-color':['match',['get','ftCode'],2943,highway,2944,highway,ink],'text-halo-color':land,'text-halo-width':1.5}},
            {id: 'detailed-highway-facility-points', type: 'symbol', source, 'source-layer': 'label', minzoom: 14,
                filter: ['==','annoCtg',412],
                layout: {'text-field':['case',restArea,'■',['any',['in','JCT',['get','knj']],['in','ＪＣＴ',['get','knj']],['in','ジャンクション',['get','knj']]],'◇','●'],
                    'text-font':['NotoSansCJKjp-Regular'],'text-size':12,'text-allow-overlap':true},
                paint: {'text-color':facilityColor,'text-halo-color':land,'text-halo-width':1}},
            {...offsetLabel('detailed-highway-facilities', ['==','annoCtg',412], ink), minzoom:14,
                paint: {'text-color':facilityColor,'text-halo-color':land,'text-halo-width':1.5}},
            label('major-facilities', 'label', ['in', 'annoCtg', 431, 621, 631, 673, 681], 11, muted, 13),
        ],
    };
}

// highwayNumbering
// Road name / route number facts from the MLIT public numbering list.
// https://www.mlit.go.jp/road/sign/numbering/list/index.html
const highwayNumbering: Record<string, string[]> = {
    "東名高速道路": [
        "E1"
    ],
    "名神高速道路": [
        "E1"
    ],
    "新東名高速道路": [
        "E1A"
    ],
    "新名神高速道路": [
        "E1A"
    ],
    "伊勢湾岸自動車道": [
        "E1A"
    ],
    "山陽自動車道": [
        "E2"
    ],
    "中国自動車道": [
        "E2A",
        "E29",
        "E73",
        "E74"
    ],
    "関門自動車道": [
        "E2A"
    ],
    "九州自動車道": [
        "E3"
    ],
    "南九州自動車道": [
        "E3A"
    ],
    "東北自動車道": [
        "E4",
        "E13",
        "E46",
        "E48"
    ],
    "東北縦貫自動車道八戸線": [
        "E4A"
    ],
    "八戸自動車道": [
        "E4A"
    ],
    "青森自動車道": [
        "E4A"
    ],
    "北海道縦貫自動車道": [
        "E5"
    ],
    "道央自動車道": [
        "E5"
    ],
    "北海道横断自動車道": [
        "E5A"
    ],
    "札樽自動車道": [
        "E5A"
    ],
    "常磐自動車道": [
        "E6"
    ],
    "仙台東部道路": [
        "E6"
    ],
    "三陸沿岸道路": [
        "E6",
        "E45"
    ],
    "仙台北部道路": [
        "E6"
    ],
    "日本海東北自動車道": [
        "E7"
    ],
    "秋田自動車道": [
        "E7",
        "E46"
    ],
    "北陸自動車道": [
        "E8"
    ],
    "京都縦貫自動車道": [
        "E9"
    ],
    "鳥取豊岡宮津自動車道": [
        "E9"
    ],
    "山陰自動車道": [
        "E9"
    ],
    "東九州自動車道": [
        "E10"
    ],
    "宮崎自動車道": [
        "E10"
    ],
    "徳島自動車道": [
        "E11",
        "E32"
    ],
    "高松自動車道": [
        "E11"
    ],
    "松山自動車道": [
        "E11",
        "E56"
    ],
    "東北中央自動車道": [
        "E13"
    ],
    "京葉道路": [
        "E14"
    ],
    "館山自動車道": [
        "E14"
    ],
    "富津館山道路": [
        "E14"
    ],
    "横浜新道": [
        "E16",
        "E83"
    ],
    "横浜横須賀道路": [
        "E16"
    ],
    "関越自動車道": [
        "E17"
    ],
    "上信越自動車道": [
        "E18"
    ],
    "中央自動車道": [
        "E19",
        "E20",
        "E52"
    ],
    "長野自動車道": [
        "E19"
    ],
    "東名阪自動車道": [
        "E23"
    ],
    "伊勢自動車道": [
        "E23"
    ],
    "京奈和自動車道": [
        "E24"
    ],
    "名阪国道": [
        "E25"
    ],
    "西名阪自動車道": [
        "E25"
    ],
    "近畿自動車道": [
        "E26"
    ],
    "阪和自動車道": [
        "E26",
        "E42"
    ],
    "舞鶴若狭自動車道": [
        "E27"
    ],
    "神戸淡路鳴門自動車道": [
        "E28"
    ],
    "中国横断自動車道姫路鳥取線": [
        "E29"
    ],
    "播磨自動車道": [
        "E29"
    ],
    "鳥取自動車道": [
        "E29"
    ],
    "瀬戸中央自動車道": [
        "E30"
    ],
    "広島呉道路": [
        "E31"
    ],
    "高知自動車道": [
        "E32",
        "E56"
    ],
    "大分自動車道": [
        "E34"
    ],
    "長崎自動車道": [
        "E34"
    ],
    "ながさき出島道路": [
        "E34"
    ],
    "西九州自動車道": [
        "E35"
    ],
    "北海道横断自動車道根室線": [
        "E38",
        "E44"
    ],
    "道東自動車道": [
        "E38",
        "E61"
    ],
    "旭川・紋別自動車道": [
        "E39"
    ],
    "東海北陸自動車道": [
        "E41"
    ],
    "能越自動車道": [
        "E41"
    ],
    "近畿自動車道紀勢線": [
        "E42"
    ],
    "紀勢自動車道": [
        "E42"
    ],
    "釜石自動車道": [
        "E46"
    ],
    "仙台南部道路": [
        "E48"
    ],
    "山形自動車道": [
        "E48"
    ],
    "磐越自動車道": [
        "E49"
    ],
    "北関東自動車道": [
        "E50"
    ],
    "東水戸道路": [
        "E50"
    ],
    "常陸那珂有料道路": [
        "E50"
    ],
    "東関東自動車道水戸線": [
        "E51"
    ],
    "東関東自動車道": [
        "E51"
    ],
    "新東名高速道路清水連絡路": [
        "E52"
    ],
    "中部横断自動車道": [
        "E52"
    ],
    "尾道自動車道": [
        "E54"
    ],
    "松江自動車道": [
        "E54"
    ],
    "四国横断自動車道": [
        "E55",
        "E56"
    ],
    "阿南安芸自動車道": [
        "E55"
    ],
    "高知東部自動車道": [
        "E55"
    ],
    "沖縄自動車道": [
        "E58"
    ],
    "那覇空港自動車道": [
        "E58"
    ],
    "函館・江差自動車道": [
        "E59"
    ],
    "帯広・広尾自動車道": [
        "E60"
    ],
    "北海道横断自動車道網走線": [
        "E61"
    ],
    "十勝オホーツク自動車道": [
        "E61"
    ],
    "深川・留萌自動車道": [
        "E62"
    ],
    "日高自動車道": [
        "E63"
    ],
    "津軽自動車道": [
        "E64"
    ],
    "新空港自動車道": [
        "E65"
    ],
    "首都圏中央連絡自動車道(栄～戸塚)": [
        "E66"
    ],
    "中部縦貫自動車道": [
        "E67"
    ],
    "中央自動車道(大月～河口湖）": [
        "E68"
    ],
    "東富士五湖道路": [
        "E68"
    ],
    "新東名高速道路引佐連絡路": [
        "E69"
    ],
    "三遠南信自動車道": [
        "E69"
    ],
    "伊豆縦貫自動車道": [
        "E70"
    ],
    "関西空港自動車道": [
        "E71"
    ],
    "関西国際空港連絡橋": [
        "E71"
    ],
    "北近畿豊岡自動車道": [
        "E72"
    ],
    "岡山自動車道": [
        "E73"
    ],
    "米子自動車道": [
        "E73"
    ],
    "広島自動車道": [
        "E74"
    ],
    "浜田自動車道": [
        "E74"
    ],
    "東広島呉自動車道": [
        "E75"
    ],
    "尾道福山自動車道": [
        "E76"
    ],
    "瀬戸内しまなみ海道": [
        "E76"
    ],
    "今治小松自動車道": [
        "E76"
    ],
    "九州横断自動車道延岡線": [
        "E77"
    ],
    "九州中央自動車道": [
        "E77"
    ],
    "東九州自動車道(清武～加治木)": [
        "E78"
    ],
    "あぶくま高原道路": [
        "E80"
    ],
    "日光宇都宮道路": [
        "E81"
    ],
    "千葉東金道路": [
        "E82"
    ],
    "第三京浜道路": [
        "E83"
    ],
    "新湘南バイパス": [
        "E84"
    ],
    "西湘バイパス": [
        "E84"
    ],
    "小田原厚木道路": [
        "E85"
    ],
    "のと里山海道": [
        "E86"
    ],
    "知多半島道路": [
        "E87"
    ],
    "セントレアライン": [
        "E87"
    ],
    "京滋バイパス": [
        "E88"
    ],
    "第二京阪道路": [
        "E89"
    ],
    "堺泉北有料道路": [
        "E90"
    ],
    "南阪奈有料道路": [
        "E91"
    ],
    "南阪奈道路": [
        "E91"
    ],
    "大和高田バイパス": [
        "E91"
    ],
    "第二阪奈有料道路": [
        "E92"
    ],
    "第二神明道路": [
        "E93",
        "E94"
    ],
    "播但連絡道路": [
        "E95"
    ],
    "長崎バイパス": [
        "E96"
    ],
    "日出バイパス": [
        "E97"
    ],
    "大分空港道路": [
        "E97"
    ],
    "一ツ葉有料道路": [
        "E98"
    ],
    "東京外環自動車道": [
        "C3"
    ],
    "首都圏中央連絡自動車道": [
        "C4"
    ],
    "名古屋第二環状自動車道": [
        "C2"
    ],
    "東海環状自動車道": [
        "C3"
    ]
};

// highwayLabels
const normalise = (name: string) => name.normalize('NFKC').replace(/\s/g,'').replace(/高速道路|自動車道|道路|高速$|道$/g,'');
const roadNumbers = new Map<string, string[]>();
for (const [name, codes] of Object.entries(highwayNumbering)) {
    const key = normalise(name), old = roadNumbers.get(key) ?? [];
    roadNumbers.set(key, [...new Set([...old, ...codes])]);
}
function highwayIdentity(name: string, nearbyNumbers: string[] = []): {number:string;name:string} | null {
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
function highwayAnnotationName(properties: Record<string,unknown>): string | null {
    for(const key of ['annoChar','knj','name']){
        const value=properties[key];if(typeof value==='string'&&value.trim())return value.trim();
    }
    return null;
}
function highwayAnnotationNumber(properties: Record<string,unknown>): string | null {
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
function installHighwayLabels(map: L.Map, gl: MapLibreMap): () => void {
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

// LimeMap
// Bundle the module worker with Vite so dev and GitHub Pages base paths agree.
setWorkerUrl(mapWorkerUrl);

function LimeMap({ posts = [], initialLocation, onBounds, onPin, onPost, onSelect, onLoadPost }: {
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

// PostLocationEditor
function PostLocationEditor({ post, onClose }: {
    post: PostWithAuthor;
    onClose: () => void;
}) {
    const [point, setPoint] = useState<MapLocation | null>(post.mapLocation ?? null);
    const qc = useQueryClient();
    const save = useMutation({ mutationFn: (location: MapLocation | null) => setPostMapLocation(post.id, location), onSuccess: () => { qc.invalidateQueries({ queryKey: ['map-posts'] }); qc.invalidateQueries({ queryKey: ['posts'] }); qc.invalidateQueries({ queryKey: ['post', post.id] }); qc.invalidateQueries({ queryKey: ['feed'] }); toast.success('ポストの場所を更新しました'); onClose(); }, onError: () => toast.error('場所を保存できませんでした') });
    return <Dialog open onOpenChange={open => { if (!open && !save.isPending)
        onClose(); }}><DialogContent className="lime-map-dialog flex max-h-[90dvh] flex-col gap-3 p-4 sm:max-w-2xl" aria-describedby={undefined} onInteractOutside={e => e.preventDefault()}>
  <DialogTitle className="pr-8">ポストを編集</DialogTitle><p className="text-sm text-muted-foreground">地図を押して場所を選択してください。</p>
  <div className="lime-map-dialog-body"><LimeMap initialLocation={post.mapLocation} onSelect={setPoint}/></div>
  <div className="flex justify-between gap-3"><Button variant="ghost" disabled={!post.mapLocation || save.isPending} onClick={() => save.mutate(null)}>場所を削除</Button><Button disabled={!point || save.isPending} onClick={() => save.mutate(point)}>保存する</Button></div>
 </DialogContent></Dialog>;
}

export { LimeMap as default };
export { PostLocationEditor };
export { highwayNumbering };
export { highwayIdentity };
export { highwayAnnotationName };
export { highwayAnnotationNumber };
export { installHighwayLabels };
export { createMapPostIcon };
export { updateMapPostIcon };
export { groupMapPosts };
export type { MapPostGroup };
export { createLimeMapStyle };
export { GSI_MAP_ATTRIBUTION };
