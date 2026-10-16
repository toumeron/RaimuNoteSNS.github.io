import { createRoot, type Root } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { CallSessionProvider } from '../../src/components/chat/CallSessionProvider';
import ChatPage from '../../src/pages/ChatPage';
import '../../src/index.css';
import { IncomingFriendCall } from "@/components/chat/CallSessionProvider";
import { FriendProfile } from '../../src/components/chat/FriendProfile';
import { findAssistant } from '../../src/lib/aiFriends';
import { defaultAvatarUrl } from '../../src/lib/aiFriends';
import { useState } from 'react';

function IncomingPreview() {
  const [visible, setVisible] = useState(true);
  return visible ? <IncomingFriendCall name="なか" avatar={defaultAvatarUrl('nakkar7')} onAnswer={async () => true} onDecline={() => setVisible(false)}/> : <p>着信終了</p>;
}

// Local harness: production ChatPage and call lifecycle, without a real account.
// Simulate the measured nav height, including the installed PWA's safe area.
document.documentElement.style.setProperty('--lime-bottom-nav-height', '98px');
// Reuse the harness root when Vite reloads this entry; portals live outside it.
const container = document.getElementById('root')! as HTMLElement & { harnessRoot?: Root };
const root = container.harnessRoot ??= createRoot(container);
root.render(
  new URLSearchParams(window.location.search).has('friend-profile-preview') ? <FriendProfile friend={{...findAssistant('guest','builtin:km170')!,birthday:'09-29'}} uid={null} avatars={{}} onClose={() => {}} onTalk={() => {}} onCall={() => {}}/> :
  new URLSearchParams(window.location.search).has('incoming-preview') ? <IncomingPreview/> :
  <ThemeProvider attribute="class" defaultTheme="light">
    <MemoryRouter initialEntries={['/chat']}>
      <CallSessionProvider>
        <Routes>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/other" element={<p>別のページ</p>} />
        </Routes>
        <nav data-testid="nav" style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 98, zIndex: 120, background: 'white' }}>
          <Link to="/other">ホームへ</Link><Link to="/chat">チャットへ</Link>
        </nav>
      </CallSessionProvider>
    </MemoryRouter>
  </ThemeProvider>,
);
