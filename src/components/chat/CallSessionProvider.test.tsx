import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CallSessionProvider, useCallSession } from './CallSessionProvider';
import { requestMicrophonePermission } from '@/lib/microphone';

vi.mock('@/lib/microphone', () => ({ requestMicrophonePermission: vi.fn(), microphoneErrorMessage: () => 'permission denied' }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
const unmount = vi.fn();
function Call({ close }: { close: () => void }) {
  useEffect(() => () => unmount(), []);
  return <button onClick={close}>End call</button>;
}
function Page() {
  const session = useCallSession();
  const navigate = useNavigate();
  return <><button onClick={() => session.start(close => <Call close={close} />)}>Start call</button><button onClick={() => navigate('/other')}>Navigate</button></>;
}
function App() {
  return <MemoryRouter><CallSessionProvider><Routes><Route path="/" element={<Page />} /><Route path="/other" element={<div>Other page</div>} /></Routes></CallSessionProvider></MemoryRouter>;
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('persistent call session', () => {
  it('requests permission from the click and preserves the call across navigation until ended', async () => {
    vi.mocked(requestMicrophonePermission).mockResolvedValue();
    render(<App />);
    fireEvent.click(screen.getByText('Start call'));
    expect(requestMicrophonePermission).toHaveBeenCalledOnce();
    await screen.findByText('End call');
    fireEvent.click(screen.getByText('Navigate'));
    expect(screen.getByText('Other page')).toBeInTheDocument();
    expect(screen.getByText('End call')).toBeInTheDocument();
    expect(unmount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('End call'));
    expect(unmount).toHaveBeenCalledOnce();
  });
  it('prevents double starts while permission is pending', async () => {
    let grant!: () => void;
    vi.mocked(requestMicrophonePermission).mockReturnValue(new Promise(resolve => { grant = resolve; }));
    render(<App />);
    fireEvent.click(screen.getByText('Start call'));
    fireEvent.click(screen.getByText('Start call'));
    expect(requestMicrophonePermission).toHaveBeenCalledOnce();
    await act(async () => grant());
    expect(screen.getAllByText('End call')).toHaveLength(1);
  });
  it('does not start after permission is denied or after the owner unmounts', async () => {
    vi.mocked(requestMicrophonePermission).mockRejectedValue(new Error('denied'));
    const view = render(<App />);
    await act(async () => fireEvent.click(screen.getByText('Start call')));
    expect(screen.queryByText('End call')).not.toBeInTheDocument();
    let grant!: () => void;
    vi.mocked(requestMicrophonePermission).mockReturnValue(new Promise(resolve => { grant = resolve; }));
    fireEvent.click(screen.getByText('Start call'));
    view.unmount();
    await act(async () => grant());
    expect(unmount).not.toHaveBeenCalled();
  });
});
