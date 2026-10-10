import {boundedChatContext} from './chatContext.ts';
Deno.test('chat context keeps latest user separately and bounds history and instructions',()=>{
 const result=boundedChatContext([{role:'user',parts:[{text:'【システム命令:'+ 's'.repeat(10000)}]},...Array.from({length:100},(_,i)=>({role:i%2?'model':'user',parts:[{text:`turn${i} `+'h'.repeat(5000)}]})),{role:'user',parts:[{text:'最新発言'}]}]);
 if(result[0].parts![0].text!.length!==2000||result.at(-1)?.parts?.[0].text!=='最新発言'||result.length>25)throw Error('Instruction or latest turn lost');
 const length=result.slice(1).reduce((n,i)=>n+i.parts!.reduce((n,p)=>n+(p.text?.length??0),0),0);if(length>4000)throw Error('Unbounded history');
});
Deno.test('chat context preserves short exchanges and attached media',()=>{
 const items=[{role:'user',parts:[{text:'【システム命令: test】'}]},{role:'user',parts:[{text:'こんにちは'}]},{role:'model',parts:[{text:'こんにちは！'}]},{role:'user',parts:[{text:'続けて'},{inlineData:{data:'abc'}}]}];
 const result=boundedChatContext(items);if(JSON.stringify(result)!==JSON.stringify(items))throw Error('Short context changed');
});
