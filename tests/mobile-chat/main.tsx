import { createRoot } from 'react-dom/client';
import { ThemeProvider } from 'next-themes';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import { CallSessionProvider } from '../../src/components/chat/CallSessionProvider';
import ChatPage from '../../src/pages/ChatPage';
import '../../src/index.css';

// Local harness: production ChatPage and call lifecycle, without a real account.
// Simulate the measured nav height, including the installed PWA's safe area.
document.documentElement.style.setProperty('--lime-bottom-nav-height', '98px');
createRoot(document.getElementById('root')!).render(
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
