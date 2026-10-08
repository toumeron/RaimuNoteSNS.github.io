import type {PostWithAuthor} from '@/types';
export function isDeclaredGeneratedArt(post:PostWithAuthor):boolean {
 const text=[post.content,...(post.imageAltTexts??[]),post.author?.bio??''].join('\n').normalize('NFKC')
  .replace(/(?:no|non|not|anti)[ -]?ai(?:[ -]?(?:art|generated))?|AI(?:学習|生成)?(?:に)?(?:禁止|反対|不使用)|AI(?:生成|イラスト|画像|絵)(?:ではない|ではありません|じゃない)|生成AI(?:不使用|反対)|AIを(?:使わない|使用しない)/gi,'');
 return (post.contentLabels??[]).some(label=>/^(?:ai-generated|generative-ai|synthetic-media)$/i.test(label)) || /AI[ _-]?(?:イラスト|画像|生成|絵|art|generated)|生成AI|人工知能で(?:描|生成)|midjourney|stable[ _-]?diffusion|novelai|dall[ -]?e|#AIart/i.test(text);
}
