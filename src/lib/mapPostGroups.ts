import type {MapPostPin} from './mapLocation';
export type MapPostGroup={key:string;posts:MapPostPin[];point:{x:number;y:number}};
// Only visible points are projected. A dense cell is one painted circle, while
// every original post remains selectable from its popup.
export function groupMapPosts(posts:MapPostPin[],project:(post:MapPostPin)=>{x:number;y:number}|null,cellSize=24):MapPostGroup[]{
 const groups=new Map<string,MapPostGroup>();
 for(const post of posts){const point=project(post);if(!point)continue;const key=`${Math.floor(point.x/cellSize)}:${Math.floor(point.y/cellSize)}`;const group=groups.get(key);if(group){const n=group.posts.length;group.point={x:(group.point.x*n+point.x)/(n+1),y:(group.point.y*n+point.y)/(n+1)};group.posts.push(post);}else groups.set(key,{key,posts:[post],point:{...point}});}
 return [...groups.values()];
}

