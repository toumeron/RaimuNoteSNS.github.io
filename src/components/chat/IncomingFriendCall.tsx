import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Phone } from 'lucide-react';
import { playIncomingRingtone } from '@/lib/incomingRingtone';
import './incoming-friend-call.css';

export function IncomingFriendCall({ name, avatar, onAnswer, onDecline }: {
  name: string; avatar: string; onAnswer: () => Promise<boolean>; onDecline: () => void;
}) {
  const [answering, setAnswering] = useState(false);
  useEffect(() => playIncomingRingtone(), []);
  return createPortal(<section className="lime-incoming-call" role="alertdialog" aria-label={`${name}から着信`} aria-describedby="lime-incoming-status">
    <img className="lime-incoming-avatar" src={avatar} alt="" />
    <div className="lime-incoming-person"><strong>{name}</strong><span id="lime-incoming-status">{answering ? '接続中…' : 'フレンドからの着信'}</span></div>
    <div className="lime-incoming-actions">
      <button type="button" className="decline" disabled={answering} aria-label="着信を拒否" onClick={onDecline}><Phone fill="currentColor"/><span>拒否</span></button>
      <button type="button" className="answer" disabled={answering} aria-label="着信に応答" onClick={async () => {
        setAnswering(true);
        try { if (await onAnswer()) onDecline(); }
        finally { setAnswering(false); }
      }}><Phone fill="currentColor"/><span>応答</span></button>
    </div>
  </section>, document.body);
}
