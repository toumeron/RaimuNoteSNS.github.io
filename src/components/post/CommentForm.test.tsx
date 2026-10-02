import { MemoryRouter } from 'react-router-dom';
import { act, cleanup, fireEvent, render as baseRender, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ send: vi.fn(), pending: false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'viewer', displayName: 'Viewer', avatarUrl: '', username: 'viewer' } }) }));
vi.mock('@/hooks/useComments', () => ({ useCreateComment: () => ({ mutateAsync: state.send, isPending: state.pending }) }));
vi.mock('@/components/feed/PostComposer', () => ({ PostComposer: ({ imageEditor }: { imageEditor: { src: string; onApply: (url: string) => void; onClose: () => void } }) => <div role="dialog"><span>{imageEditor.src}</span><button onClick={() => { imageEditor.onApply('blob:cropped'); imageEditor.onClose(); }}>編集を保存</button></div> }));
import { CommentForm } from './CommentForm';
const render = (ui: React.ReactNode, options?: Parameters<typeof baseRender>[1]) => baseRender(ui, { wrapper: MemoryRouter, ...options });

beforeEach(() => {
  state.send.mockReset().mockResolvedValue({}); state.pending = false;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockImplementation(() => `blob:${Math.random()}`) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(cleanup);
const attach = (container: HTMLElement, count = 1) => fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: Array.from({ length: count }, () => new File(['image'], 'image.png', { type: 'image/png' })) } });
describe('reply composer', () => {
  it('links the composer avatar to the current profile', () => {
    render(<CommentForm postId="post" />);
    expect(screen.getByRole('link', { name: '自分のプロフィールを開く' })).toHaveAttribute('href', '/u/viewer');
  });
  it('retains the compact mobile input and inline attachment control while typing', () => {
    const view = render(<CommentForm postId="post" variant="bottomNav" />);
    const input = screen.getByPlaceholderText('返信をポスト');
    expect(input.tagName).toBe('INPUT');
    fireEvent.focus(input);
    expect(input.parentElement).toContainElement(screen.getByRole('button', { name: '返信に画像を添付' }));
    expect(view.container.querySelector('[data-lime-reply-composer]')).toHaveAttribute('data-compact', 'true');
  });
  it('hides the photo button until editing and folds an empty draft after blur', () => {
    render(<CommentForm postId="post" variant="desktopReply" />);
    expect(screen.queryByRole('button', { name: '返信に画像を添付' })).toBeNull();
    const input = screen.getByPlaceholderText('返信をポスト'); fireEvent.focus(input);
    expect(screen.getByRole('button', { name: '返信に画像を添付' })).toBeInTheDocument();
    fireEvent.blur(input, { relatedTarget: document.body });
    expect(screen.queryByRole('button', { name: '返信に画像を添付' })).toBeNull();
  });
  it('shows images beneath the input with working edit and remove controls', async () => {
    const view = render(<CommentForm postId="post" />); attach(view.container);
    const original = screen.getByAltText('添付画像のプレビュー').getAttribute('src');
    fireEvent.click(screen.getByRole('button', { name: '編集' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(original!);
    fireEvent.click(screen.getByRole('button', { name: '編集を保存' }));
    expect(screen.getByAltText('添付画像のプレビュー')).toHaveAttribute('src', 'blob:cropped');
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(original);
    fireEvent.click(screen.getByRole('button', { name: 'コメントを送信' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledWith({ content: '', imageUrls: ['blob:cropped'], parentCommentId: null }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith(original));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cropped');
  });
  it('sends an image-only reply to the selected comment and releases previews', async () => {
    const view = render(<CommentForm postId="post" parentCommentId="reply" />);
    attach(view.container);
    fireEvent.click(screen.getByRole('button', { name: 'コメントを送信' }));
    await waitFor(() => expect(state.send).toHaveBeenCalledWith({ content: '', imageUrls: [expect.stringContaining('blob:')], parentCommentId: 'reply' }));
    await waitFor(() => expect(screen.queryAllByAltText('添付画像のプレビュー')).toHaveLength(0));
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it('limits attachments to four and allows removal', () => {
    const view = render(<CommentForm postId="post" />); attach(view.container, 5);
    expect(screen.getAllByAltText('添付画像のプレビュー')).toHaveLength(4);
    fireEvent.click(screen.getAllByRole('button', { name: '添付画像を削除' })[0]);
    expect(screen.getAllByAltText('添付画像のプレビュー')).toHaveLength(3);
  });
  it('keeps the draft and attachments on a failed send', async () => {
    state.send.mockRejectedValueOnce(new Error('offline'));
    const view = render(<CommentForm postId="post" />); attach(view.container);
    fireEvent.change(screen.getByPlaceholderText('返信をポスト'), { target: { value: 'keep me' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'コメントを送信' })); });
    expect(screen.getByPlaceholderText('返信をポスト')).toHaveValue('keep me');
    expect(screen.getAllByAltText('添付画像のプレビュー')).toHaveLength(1);
  });
  it('prevents duplicate submissions while the upload is running', async () => {
    let release!: () => void; state.send.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    render(<CommentForm postId="post" />);
    fireEvent.change(screen.getByPlaceholderText('返信をポスト'), { target: { value: 'reply' } });
    const send = screen.getByRole('button', { name: 'コメントを送信' });
    fireEvent.click(send); fireEvent.click(send);
    expect(state.send).toHaveBeenCalledTimes(1);
    await act(async () => release());
  });
  it('clears drafts when changing the reply target', () => {
    const view = render(<CommentForm postId="post" parentCommentId="one" />); attach(view.container);
    fireEvent.change(screen.getByPlaceholderText('返信をポスト'), { target: { value: 'one' } });
    view.rerender(<CommentForm postId="post" parentCommentId="two" />);
    expect(screen.getByPlaceholderText('返信をポスト')).toHaveValue('');
    expect(screen.queryAllByAltText('添付画像のプレビュー')).toHaveLength(0);
  });
});
