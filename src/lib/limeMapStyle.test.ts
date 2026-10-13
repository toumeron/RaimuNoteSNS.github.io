import {describe, expect, it} from 'vitest';
import {validateStyleMin, featureFilter} from '@maplibre/maplibre-gl-style-spec';
import {createLimeMapStyle} from './limeMapStyle';

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
