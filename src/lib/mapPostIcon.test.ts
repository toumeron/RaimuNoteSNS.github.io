import {describe,it,expect} from 'vitest';
import {createMapPostIcon,updateMapPostIcon} from './mapPostIcon';
const post={id:'p',createdAt:'2026-10-14',mapLocation:{latitude:35,longitude:139},author:{displayName:'作者',avatarUrl:'https://images.example/avatar.png'}};
describe('map avatar pin',()=>{
 it('uses the author image without injecting profile text into HTML',()=>{
  const icon=createMapPostIcon(post),node=icon.options.html as HTMLElement;
  expect(node.querySelector('img')?.src).toBe(post.author.avatarUrl);
  expect(icon.options.iconSize).toEqual([40,48]);
  expect(node.querySelector('.lime-map-avatar-pin-rim circle')?.getAttribute('stroke-width')).toBe('2');
  expect(node.querySelector('.lime-map-avatar-pin-rim circle')?.getAttribute('r')).toBe('18');
  expect(node.querySelector('img')?.referrerPolicy).toBe('no-referrer');
 });
 it('keeps a simple fallback for missing or failed icons and rejects unsafe URLs',()=>{
  const node=createMapPostIcon({...post,author:{displayName:'<script>',avatarUrl:'javascript:alert(1)'}}).options.html as HTMLElement;
  expect(node.querySelector('img')).toBeNull();expect(node.querySelector('script')).toBeNull();expect(node.textContent).toBe('<');
  const imageNode=createMapPostIcon(post).options.html as HTMLElement;
  imageNode.querySelector('img')!.dispatchEvent(new Event('error'));expect(imageNode.querySelector('img')).toBeNull();expect(imageNode.textContent).toBe('作');
 });
 it('retains the image node when zoom changes the cluster count',()=>{
  const root=document.createElement('div');root.append(createMapPostIcon(post,2).options.html as HTMLElement);const image=root.querySelector('img');
  updateMapPostIcon(root,post,1);expect(root.querySelector('img')).toBe(image);expect(root.querySelector('.lime-map-avatar-pin-count')).toBeNull();
  updateMapPostIcon(root,post,3);expect(root.querySelector('img')).toBe(image);expect(root.querySelector('.lime-map-avatar-pin-count')?.textContent).toBe('3');
 });
 it('adds only a small count when posts overlap',()=>{
  expect((createMapPostIcon(post).options.html as HTMLElement).querySelector('.lime-map-avatar-pin-count')).toBeNull();
  expect((createMapPostIcon(post,5).options.html as HTMLElement).querySelector('.lime-map-avatar-pin-count')?.textContent).toBe('5');
 });
});
