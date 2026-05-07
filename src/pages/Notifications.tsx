import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { AtSign, Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ja } from "date-fns/locale";
import { Link } from "react-router-dom";

const Notifications = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!error) setNotifications(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchNotifications();

    // リアルタイム更新の購読
    const channel = supabase
      .channel("page-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user?.id}` },
        () => fetchNotifications()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  if (loading) return <div className="p-4 text-center">読み込み中...</div>;

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Bell className="w-6 h-6" /> 通知
      </h1>
      
      {notifications.length === 0 ? (
        <p className="text-muted-foreground text-center py-10">通知はありません</p>
      ) : (
        notifications.map((n) => (
          <Link key={n.id} to={`/post/${n.post_id}`} className="block">
            <Card className="p-4 hover:bg-accent/50 transition-colors cursor-pointer">
              <div className="flex gap-3">
                <div className="mt-1">
                  <AtSign className="w-5 h-5 text-primary" />
                </div>
                <Avatar className="w-10 h-10">
                  <AvatarImage src={n.actor_avatar_url} />
                  <AvatarFallback>{n.actor_name?.[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="text-sm">
                    <span className="font-bold">{n.actor_name}</span> さんがあなたをメンションしました
                  </p>
                  {n.content_preview && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2 italic">
                      "{n.content_preview}"
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ja })}
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        ))
      )}
    </div>
  );
};

export default Notifications;