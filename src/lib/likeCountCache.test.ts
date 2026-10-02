import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { updateLikeCountCache } from './likeCountCache';

describe('like count cache synchronization', () => {
  it('updates latest, following, detail, profile arrays, wrapped likes and quotes without changing paging', () => {
    const client = new QueryClient();
    const post = { id: 'p', likesCount: 2 };
    const other = { id: 'other', likesCount: 9 };
    const feed = { pages: [[post, other, { id: 'quote', parentPost: post }]], pageParams: [4] };
    client.setQueryData(['feed', 'all'], feed);
    client.setQueryData(['feed', 'following'], feed);
    client.setQueryData(['post', 'p'], post);
    client.setQueryData(['feed', 'all', 'timeline', []], { pages: [{ posts: [post], next: { lime: { page: 1 } } }], pageParams: [{}] });
    client.setQueryData(['posts', 'user', 'author'], { pages: [[post]], pageParams: [0] });
    client.setQueryData(['posts', 'likes', 'author'], { pages: [[{ posts: post }]], pageParams: [0] });
    client.setQueryData(['posts', 'user', 'legacy'], [post]);
    client.setQueryData(['profile', 'author'], { id: 'p', displayName: 'Author' });
    updateLikeCountCache(client, 'post', 'p', 8);
    for (const key of [['feed', 'all'], ['feed', 'following']]) {
      expect(client.getQueryData(key)).toEqual({ pages: [[{ ...post, likesCount: 8, likes_count: 8 }, other,
        { id: 'quote', parentPost: { ...post, likesCount: 8, likes_count: 8 } }]], pageParams: [4] });
    }
    expect(client.getQueryData(['post', 'p'])).toMatchObject({ likesCount: 8 });
    expect(client.getQueryData(['feed', 'all', 'timeline', []])).toMatchObject({ pages: [{ posts: [{ likesCount: 8 }], next: { lime: { page: 1 } } }] });
    expect(client.getQueryData(['posts', 'user', 'author'])).toMatchObject({ pages: [[{ likesCount: 8 }]], pageParams: [0] });
    expect(client.getQueryData(['posts', 'likes', 'author'])).toMatchObject({ pages: [[{ posts: { likesCount: 8 } }]] });
    expect(client.getQueryData(['posts', 'user', 'legacy'])).toEqual([{ ...post, likesCount: 8, likes_count: 8 }]);
    expect(client.getQueryData(['profile', 'author'])).toEqual({ id: 'p', displayName: 'Author' });
  });
  it('isolates comment counts from post counts with the same ID', () => {
    const client = new QueryClient();
    client.setQueryData(['comments', 'post'], [{ id: 'same', likes_count: 2 }]);
    client.setQueryData(['post', 'same'], { id: 'same', likesCount: 10 });
    updateLikeCountCache(client, 'comment', 'same', 0);
    expect(client.getQueryData(['comments', 'post'])).toEqual([{ id: 'same', likes_count: 0, likesCount: 0 }]);
    expect(client.getQueryData(['post', 'same'])).toEqual({ id: 'same', likesCount: 10 });
  });
  it('keeps unrelated query references unchanged', () => {
    const client = new QueryClient();
    const key = ['feed', 'all'];
    client.setQueryData(key, { pages: [[{ id: 'other', likesCount: 2 }]], pageParams: [0] });
    const data = client.getQueryData(key);
    updateLikeCountCache(client, 'post', 'missing', 8);
    expect(client.getQueryData(key)).toBe(data);
  });
});
