import { useState } from 'react';
import { Search } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { PostCard } from '@/components/feed/PostCard';
import { UserCard } from '@/components/search/UserCard';

// データファイル全体を一旦 import
import * as PostData from '@/data/posts';
import * as UserData from '@/data/users';

export default function SearchPage() {
  const [query, setQuery] = useState("");

  // Record<string, any> として扱うことで、TSのプロパティ存在チェックを回避
  const postSource = PostData as Record<string, any>;
  const userSource = UserData as Record<string, any>;

  // ファイル内のエクスポート名を優先順位をつけて取得
  // プロジェクトの実態に合わせて 'posts' や 'users' の名前が違う場合でも対応可能
  const allPosts = (postSource.posts || postSource.default || postSource.DUMMY_POSTS || []) as any[];
  const allUsers = (userSource.users || userSource.default || userSource.DUMMY_USERS || []) as any[];

  // フィルタリング処理（nullチェック付き）
  const filteredPosts = allPosts.filter(post => 
    post?.content?.toLowerCase().includes(query.toLowerCase())
  );

  const filteredUsers = allUsers.filter(user => 
    user?.displayName?.toLowerCase().includes(query.toLowerCase()) ||
    user?.username?.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-2xl min-h-screen pb-20">
      {/* 検索バー */}
      <div className="sticky top-16 z-20 bg-background/95 backdrop-blur-sm p-4 border-b border-border/60">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="キーワードや名前で検索"
            className="w-full rounded-full bg-muted py-3 pl-12 pr-4 text-base outline-none ring-primary focus:ring-2 transition-all"
            autoFocus
          />
        </div>
      </div>

      <Tabs defaultValue="posts" className="w-full">
        <TabsList className="w-full grid grid-cols-2 bg-transparent border-b border-border/60 rounded-none h-auto p-0">
          <TabsTrigger value="posts" className="py-3 font-bold data-[state=active]:border-b-2 border-primary">
            投稿
          </TabsTrigger>
          <TabsTrigger value="users" className="py-3 font-bold data-[state=active]:border-b-2 border-primary">
            ユーザー
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="m-0">
          {query ? (
            filteredPosts.length > 0 ? (
              filteredPosts.map(post => <PostCard key={post.id} post={post} />)
            ) : (
              <p className="p-12 text-center text-muted-foreground">「{query}」に一致する投稿はありません</p>
            )
          ) : (
            <p className="p-12 text-center text-muted-foreground">キーワードを入力してください</p>
          )}
        </TabsContent>

        <TabsContent value="users" className="m-0">
          {query ? (
            filteredUsers.length > 0 ? (
              filteredUsers.map(user => <UserCard key={user.id} user={user} />)
            ) : (
              <p className="p-12 text-center text-muted-foreground">「{query}」に一致するユーザーは見つかりません</p>
            )
          ) : (
            <p className="p-12 text-center text-muted-foreground">名前やIDを入力してください</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}