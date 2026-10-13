import {describe,it,expect} from 'vitest';
import {highwayIdentity,highwayAnnotationName,highwayAnnotationNumber} from './highwayLabels';
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
