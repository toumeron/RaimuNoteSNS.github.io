import {expect,it} from 'vitest';
import original from './recommendationVisualPrototypes.json';
import browser from './recommendationVisualClassifierData.json';
it('keeps every classifier vector and topic exactly unchanged while omitting unused model data',()=>{
 expect(browser.prototypes).toEqual(original.prototypes.map(({id,topics,vectors})=>({id,topics,vectors})));
 expect(JSON.stringify(browser).length).toBeLessThan(JSON.stringify(original).length*.75);
});
