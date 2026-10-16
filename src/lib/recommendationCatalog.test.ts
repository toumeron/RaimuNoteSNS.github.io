import {beforeEach,expect,it} from 'vitest';
import fixtures from './fixtures/recommendationVisual.json';
import {classifyRecommendationVisual} from './recommendationVisual';
import {parseRecommendationCatalog,RECOMMENDATION_CATALOG_MAX_AGE,applyCatalogRecommendationVisuals} from './recommendationCatalog';
const now=Date.parse('2026-10-17T00:00:00Z');
const visual=classifyRecommendationVisual(fixtures.find(row=>row.name==='original-moe')!.vector);
const post={id:'x:2110766445940572599',userId:'x-user:123',source:'x',visibility:'public',author:{id:'x-user:123',username:'creator@twitter.com'},content:'',imageUrls:['https://pbs.twimg.com/media/work.jpg'],createdAt:new Date(now).toISOString(),recommendationVisual:visual};
const catalog=(extra={})=>({version:1,model:'Xenova/clip-vit-base-patch32',revision:'d15189d7028b43f1d3e65039190477f6af591c2a',generatedAt:new Date(now).toISOString(),posts:[post],...extra});
beforeEach(()=>localStorage.clear());
it('uses the same measured pixel classification and strips viewer-specific action flags',()=>{
 const [result]=parseRecommendationCatalog(catalog({posts:[{...post,likedByMe:true,repostedByMe:true}]}),now);
 expect(result.recommendationVisual).toEqual(visual);expect(result.likedByMe).toBe(false);expect(result.repostedByMe).toBe(false);
});
it('does not accept stale artifacts, an incompatible model or future timestamps',()=>{
 for(const extra of [{version:2},{revision:'other'},{generatedAt:new Date(now-RECOMMENDATION_CATALOG_MAX_AGE-1).toISOString()},{generatedAt:new Date(now+60001).toISOString()}])expect(parseRecommendationCatalog(catalog(extra),now)).toEqual([]);
});
it('does not include private content, duplicate IDs, private-media references or malformed vectors',()=>{
 const rows=[post,{...post},{...post,id:'private',visibility:'followers'},{...post,id:'private-media',imageUrls:['private-media:object']},{...post,id:'bad',recommendationVisual:{...visual,vector:[NaN]}}];
 expect(parseRecommendationCatalog(catalog({posts:rows}),now).map(row=>row.id)).toEqual([post.id]);
});
it('reclassifies a mislabeled catalog entry from its real vector',()=>{
 const vector=fixtures.find(row=>row.name==='pets')!.vector;
 const [result]=parseRecommendationCatalog(catalog({posts:[{...post,recommendationVisual:{...visual,kind:'moe',vector}}]}),now);
 expect(result.recommendationVisual!.kind).toBe('pets');
});
it('reuses a catalog vector for the identical image, without treating another work by that creator as equivalent',()=>{
 const catalogRows=parseRecommendationCatalog(catalog(),now);
 const rows=applyCatalogRecommendationVisuals([
  {...catalogRows[0],recommendationVisual:undefined,imageUrls:[post.imageUrls[0]+'?name=small']},
  {...catalogRows[0],id:'other-work',recommendationVisual:undefined,imageUrls:['https://pbs.twimg.com/media/other.jpg']},
 ],catalogRows);
 expect(rows[0].recommendationVisual).toEqual(visual);expect(rows[1].recommendationVisual).toBeUndefined();
});
