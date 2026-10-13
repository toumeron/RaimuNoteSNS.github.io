import type { ExpressionSpecification, FilterSpecification, LineLayerSpecification, SymbolLayerSpecification, StyleSpecification } from 'maplibre-gl';

export const GSI_MAP_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/vector/" target="_blank" rel="noopener noreferrer">国土地理院</a>';

/** A small transport map, using GSI's documented vector feature categories.
 * Keep the geographic geometry: this is a simplified map, not a distorted route diagram.
 * https://maps.gsi.go.jp/help/pdf/vector/dataspec.pdf
 */
export function createLimeMapStyle(dark: boolean): StyleSpecification {
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
