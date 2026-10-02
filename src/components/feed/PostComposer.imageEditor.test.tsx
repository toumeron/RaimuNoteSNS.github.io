import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'viewer', username: 'viewer', displayName: 'Viewer' } }) }));
vi.mock('@/hooks/useFeed', () => ({ useCreatePost: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
import { PostComposer } from './PostComposer';
const draw = vi.fn();
const apply = vi.fn();
const close = vi.fn();
beforeEach(() => {
  draw.mockReset(); apply.mockReset(); close.mockReset();
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    naturalWidth = 400; naturalHeight = 200; complete = true;
    set src(_value: string) { Promise.resolve().then(() => this.onload?.()); }
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: draw } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['crop'], { type: 'image/jpeg' })));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:edited') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() {
  const view = render(<MemoryRouter><PostComposer imageEditor={{ src: 'blob:reply-original', onApply: apply, onClose: close }} /></MemoryRouter>);
  await act(async () => {}); return view;
}
describe('shared post and reply image editor', () => {
  it('shows only the existing editor and preserves an untouched original', async () => {
    const view = await mount();
    expect(screen.getByText('メディアをトリミング')).toBeInTheDocument();
    expect(screen.queryByText('いまどうしてる？')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(apply).toHaveBeenCalledWith('blob:reply-original'); expect(close).toHaveBeenCalledTimes(1);
    view.unmount(); expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:reply-original');
  });
  it('uses the normal composer crop operation and returns the resulting image to the reply', async () => {
    await mount(); fireEvent.click(screen.getByRole('button', { name: '1:1でトリミング' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith('blob:edited'));
    expect(draw).toHaveBeenCalledWith(expect.anything(), 100, 0, 200, 200, 0, 0, 1080, 1080);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
