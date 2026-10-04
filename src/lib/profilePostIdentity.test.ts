import {it, expect} from 'vitest';
import {profilePostIdentity} from './profilePostIdentity';
it('keeps a self repost and its original as separate entries with stable keys',()=>{
 const original={id:'same'};
 const repost={...original,profileRepostedBy:'me',profileRepostedAt:'2026-10-04'};
 expect(profilePostIdentity(original)).not.toBe(profilePostIdentity(repost));
 expect(profilePostIdentity({...repost})).toBe(profilePostIdentity(repost));
 expect(new Set([original,repost,{...repost}].map(profilePostIdentity)).size).toBe(2);
});
