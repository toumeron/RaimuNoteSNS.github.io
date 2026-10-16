/** Fetch a few images concurrently, but keep the model and decoded pixels serial. */
export function createRecommendationVisualQueue<Context,Input,Prepared,Output>(options:{
 load:()=>Promise<Context>;
 prepare:(input:Input)=>Promise<Prepared>;
 infer:(context:Context,prepared:Prepared,input:Input)=>Promise<Output>;
 capacity?:number;
}){
 const capacity=options.capacity??3;
 let active=0,tail:Promise<unknown>=Promise.resolve();
 const waiting:Array<()=>void>=[];
 const acquire=()=>new Promise<void>(resolve=>{
  const start=()=>{active++;resolve();};
  if(active<capacity)start();else waiting.push(start);
 });
 return async(input:Input):Promise<Output>=>{
  await acquire();
  try{
   // Model initialization and image/PDS reads do not depend on each other.
   const [context,prepared]=await Promise.all([options.load(),options.prepare(input)]);
   const result=tail.then(()=>options.infer(context,prepared,input));
   tail=result.catch(()=>{});
   return await result;
  }finally{active--;waiting.shift()?.();}
 };
}
