import type { Post } from '@/types';

// ダミー投稿データ（新着順は API 層でソート）
export const postsData: Post[] = [
  {
    id: 'p1', userId: 'u1',
    content: 'カフェのいちごパフェ食べてきた🍓 SNSの写真より100倍かわいかった……ムリムリ！',
    imageUrls: ['https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&h=600&fit=crop'],
    createdAt: '2025-01-20T14:32:00Z', likesCount: 24, commentsCount: 3, likedByMe: false,
  },
  {
    id: 'p2', userId: 'u2',
    content: '新しいイラスト描いた🎨 ティール色を使うと急にエモくなる気がする。',
    imageUrls: [
      'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?w=800&h=600&fit=crop',
    ],
    createdAt: '2025-01-20T13:10:00Z', likesCount: 56, commentsCount: 7, likedByMe: true,
  },
  {
    id: 'p3', userId: 'u3',
    content: 'うちの猫🐈‍⬛ 今日もご機嫌ナナメ。なでさせてくれない……',
    imageUrls: ['https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?w=800&h=600&fit=crop'],
    createdAt: '2025-01-20T11:45:00Z', likesCount: 132, commentsCount: 15, likedByMe: false,
  },
  {
    id: 'p4', userId: 'u4',
    content: '新しいメイド服届いた🎀 リボンのサイズ感がもうムリムリ！\n\n紅茶も新しいの開けて、休日の儀式って感じ。',
    imageUrls: [],
    createdAt: '2025-01-20T10:22:00Z', likesCount: 18, commentsCount: 2, likedByMe: false,
  },
  {
    id: 'p5', userId: 'u5',
    content: 'リボン総選挙、本日開催🎀 みんなはどの色派？',
    imageUrls: [
      'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1518895949257-7621c3c786d7?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1561835491-ed2567d96913?w=800&h=600&fit=crop',
    ],
    createdAt: '2025-01-20T09:00:00Z', likesCount: 89, commentsCount: 22, likedByMe: true,
  },
  {
    id: 'p6', userId: 'u6',
    content: '今日読んでる本📚 静かな午後にぴったり。',
    imageUrls: ['https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&h=600&fit=crop'],
    createdAt: '2025-01-19T22:14:00Z', likesCount: 41, commentsCount: 4, likedByMe: false,
  },
  {
    id: 'p7', userId: 'u7',
    content: '推しのライブ当選しましたーーー！！！！！🍑💗\n声が震えて電話に出れなかった……',
    imageUrls: [],
    createdAt: '2025-01-19T20:50:00Z', likesCount: 203, commentsCount: 31, likedByMe: true,
  },
  {
    id: 'p8', userId: 'u8',
    content: '春はまだだけど、気分はもう桜🌸 制服+ピンクのリボン、あざと可愛いって言って。',
    imageUrls: [
      'https://images.unsplash.com/photo-1522383225653-ed111181a951?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1490750967868-88aa4486c946?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=800&h=600&fit=crop',
    ],
    createdAt: '2025-01-19T18:30:00Z', likesCount: 167, commentsCount: 19, likedByMe: false,
  },
  {
    id: 'p9', userId: 'u1',
    content: 'お絵かき配信、今夜21時から🎨💗 のんびりやるよー',
    imageUrls: [],
    createdAt: '2025-01-19T16:00:00Z', likesCount: 67, commentsCount: 12, likedByMe: false,
  },
  {
    id: 'p10', userId: 'u2',
    content: '近所に新しいカフェがオープン☕ 内装がティールでもうムリ！\n通っちゃう予感しかない',
    imageUrls: ['https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&h=600&fit=crop'],
    createdAt: '2025-01-19T13:45:00Z', likesCount: 92, commentsCount: 11, likedByMe: true,
  },
  {
    id: 'p11', userId: 'u3',
    content: 'タピオカ卒業して今はチーズティーにハマってる🧀🍵',
    imageUrls: ['https://images.unsplash.com/photo-1558857563-c0c6ee6ff8ee?w=800&h=600&fit=crop'],
    createdAt: '2025-01-19T11:20:00Z', likesCount: 38, commentsCount: 5, likedByMe: false,
  },
  {
    id: 'p12', userId: 'u5',
    content: '今日の小さな幸せ🎀\n・新しい色のリボン買えた\n・コンビニでプリン半額だった\n・推しが新曲出した\n以上！',
    imageUrls: [],
    createdAt: '2025-01-19T09:10:00Z', likesCount: 78, commentsCount: 9, likedByMe: false,
  },
  {
    id: 'p13', userId: 'u4',
    content: '刺繍のワンポイント、いちご🍓 縫ってる時間がいちばん落ち着く。',
    imageUrls: [
      'https://images.unsplash.com/photo-1606922693103-3a3e7d2c44df?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1512389142860-9c449e58a543?w=800&h=600&fit=crop',
    ],
    createdAt: '2025-01-18T21:33:00Z', likesCount: 51, commentsCount: 6, likedByMe: true,
  },
  {
    id: 'p14', userId: 'u6',
    content: '抹茶ラテ、自分で点てると無限に飲める🍵',
    imageUrls: ['https://images.unsplash.com/photo-1536013455671-2f1d5cf3eced?w=800&h=600&fit=crop'],
    createdAt: '2025-01-18T17:05:00Z', likesCount: 44, commentsCount: 3, likedByMe: false,
  },
  {
    id: 'p15', userId: 'u7',
    content: 'ムリムリSNSはじめました💗 みなさんよろしくね～！',
    imageUrls: [],
    createdAt: '2025-01-18T15:00:00Z', likesCount: 112, commentsCount: 28, likedByMe: true,
  },
  {
    id: 'p16', userId: 'u8',
    content: 'カメラ新調しました📷 これから写真あげていくね～',
    imageUrls: ['https://images.unsplash.com/photo-1502920917128-1aa500764cbd?w=800&h=600&fit=crop'],
    createdAt: '2025-01-18T12:40:00Z', likesCount: 73, commentsCount: 8, likedByMe: false,
  },
  {
    id: 'p17', userId: 'u1',
    content: '今日のラフ画。色塗ったら載せます🎨',
    imageUrls: ['https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=800&h=600&fit=crop'],
    createdAt: '2025-01-18T10:00:00Z', likesCount: 29, commentsCount: 4, likedByMe: false,
  },
  {
    id: 'p18', userId: 'u2',
    content: '雨の日のカフェ☔ こういう日が一番好きかも',
    imageUrls: [],
    createdAt: '2025-01-17T23:18:00Z', likesCount: 86, commentsCount: 7, likedByMe: false,
  },
];
