import {beforeEach,expect,it,vi} from 'vitest';
import {findAssistant,listAssistants,saveCustomAssistant,type AssistantDraft} from './aiFriends';
beforeEach(()=>localStorage.clear());
it('edits a built-in friend in the existing store without duplicating its ID or losing history identity',()=>{
 const friend=findAssistant('owner','builtin:km170')!;const draft={...friend,name:'更新した名前',description:'更新した紹介',systemPrompt:'更新した設定',gender:'female'} as AssistantDraft;
 saveCustomAssistant('owner',draft);
 const list=listAssistants('owner');expect(list.filter(item=>item.id===friend.id)).toHaveLength(1);expect(findAssistant('owner',friend.id)).toMatchObject({name:draft.name,description:draft.description,systemPrompt:draft.systemPrompt,slug:friend.slug});
 expect(findAssistant('another',friend.id)?.name).toBe(friend.name);
 saveCustomAssistant('owner',{...draft,name:'再編集'});expect(findAssistant('owner',friend.id)?.name).toBe('再編集');expect(listAssistants('owner').filter(item=>item.id===friend.id)).toHaveLength(1);
});
it('still saves edits to custom friends',()=>{const [friend]=saveCustomAssistant('owner',{name:'友達',description:'',systemPrompt:'設定',starter:'',greeting:'',gender:'female'});saveCustomAssistant('owner',{...friend,name:'新しい名前',gender:'female'});expect(findAssistant('owner',friend.id)?.name).toBe('新しい名前');});
it('reports storage failures instead of pretending an edit was saved',()=>{const storage=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')});try{expect(()=>saveCustomAssistant('owner',{...findAssistant('owner','builtin:km170')!,name:'新名',gender:'female'})).toThrow('quota');}finally{storage.mockRestore();}});
