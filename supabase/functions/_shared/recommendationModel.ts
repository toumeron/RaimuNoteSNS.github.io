export const FEATURE_NAMES = ['interest','recent_interest','author_affinity','follow','freshness','quality','seen_penalty','spam_penalty','self_penalty','baseline','has_image','native','bluesky','misskey','text_length'];
export type RankTree = {leaf_value:number} | {split_feature:number;threshold:number;default_left:boolean;decision_type:'<=';left_child:RankTree;right_child:RankTree};
export type RankModel = {version:1;featureNames:string[];trainedAt:string;trees:RankTree[];metrics:{baselineNdcg:number;modelNdcg:number;validationGroups:number}};
export function validFeatures(value:unknown):value is number[] {
 return Array.isArray(value)&&value.length===FEATURE_NAMES.length&&value.every(item=>typeof item==='number'&&Number.isFinite(item)&&Math.abs(item)<=1000);
}
export function validRankModel(input:unknown):input is RankModel {
 const model=input as RankModel;
 if(!model||model.version!==1||JSON.stringify(model.featureNames)!==JSON.stringify(FEATURE_NAMES)||!Number.isFinite(Date.parse(model.trainedAt))||!Array.isArray(model.trees)||!model.trees.length||model.trees.length>128||!model.metrics||![model.metrics.modelNdcg,model.metrics.baselineNdcg].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||model.metrics.modelNdcg<=model.metrics.baselineNdcg||(!Number.isInteger(model.metrics.validationGroups)||model.metrics.validationGroups<5))return false;
 let nodes=0;
 const valid=(node:RankTree,depth:number):boolean=>{
  if(!node||++nodes>20000||depth>16)return false;
  if('leaf_value' in node)return Number.isFinite(node.leaf_value)&&Math.abs(node.leaf_value)<1000;
  return Number.isInteger(node.split_feature)&&node.split_feature>=0&&node.split_feature<FEATURE_NAMES.length&&Number.isFinite(node.threshold)&&node.decision_type==='<='&&typeof node.default_left==='boolean'&&valid(node.left_child,depth+1)&&valid(node.right_child,depth+1);
 };
 return model.trees.every(tree=>valid(tree,0));
}
export function predictRank(model:RankModel,features:number[]):number {
 return model.trees.reduce((score,tree)=>{
  let node=tree;
  while(!('leaf_value' in node)){
   const value=features[node.split_feature];
   node=(Number.isFinite(value)?value<=node.threshold:node.default_left)?node.left_child:node.right_child;
  }
  return score+node.leaf_value;
 },0);
}
