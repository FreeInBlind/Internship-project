import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryPage from '../pages/history';

const ctx = vi.hoisted(() => ({ language: 'en', session: { status: 'authenticated', data: { user: { id: 'owner-a' } } } }));
vi.mock('next-auth/react', () => ({ useSession: () => ctx.session }));
vi.mock('next/link', () => ({ default: ({ children, ...props }) => <a {...props}>{children}</a> }));
vi.mock('../components/Button', () => ({ default: ({ href, children }) => <a href={href}>{children}</a> }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('../components/LanguageProvider', () => ({ useLanguage: () => ({ language: ctx.language }) }));

const id = 'report-1';
const saved = (overrides = {}) => ({
  id, title: 'Saved report', jobTitle: 'Engineer', reportLanguage: 'en',
  createdAt: new Date(Date.now() - 60000).toISOString(),
  updatedAt: new Date(Date.now() - 30000).toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(), ...overrides,
});
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { resolve, promise }; };

beforeEach(() => {
  ctx.language = 'en';
  ctx.session = { status: 'authenticated', data: { user: { id: 'owner-a' } } };
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('history list boundaries', () => {
  it('retains the failed page cursor and retries that page without duplicating previous items', async () => {
    const retry = deferred();
    fetch.mockResolvedValueOnce(response({ ok: true, items: [saved()], nextCursor: 'next-page' }))
      .mockRejectedValueOnce(new Error('network lost')).mockReturnValueOnce(retry.promise);
    render(<HistoryPage />);
    await screen.findByRole('link', { name: 'Saved report' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('alert');
    expect(fetch.mock.calls[1][0]).toBe('/api/reports?limit=20&cursor=next-page');
    fireEvent.click(screen.getByRole('button', { name: 'Reload history' }));
    expect(fetch.mock.calls[2][0]).toBe('/api/reports?limit=20&cursor=next-page');
    await act(async () => retry.resolve(response({ ok: true, items: [saved({ id: 'report-2', title: 'Second report' })], nextCursor: null })));
    expect(await screen.findByRole('link', { name: 'Second report' })).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'History' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('continues pagination when a page contains only expired reports', async () => {
    fetch.mockResolvedValueOnce(response({ ok: true, items: [saved({ expiresAt: new Date(Date.now() - 1000).toISOString() })], nextCursor: 'after-expired' }))
      .mockResolvedValueOnce(response({ ok: true, items: [saved({ id: 'report-2', title: 'Still active' })], nextCursor: null }));
    render(<HistoryPage />);
    await screen.findByRole('button', { name: 'Load more' });
    expect(screen.queryByRole('heading', { name: 'No saved reports yet' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'Still active' })).toBeInTheDocument();
    expect(fetch.mock.calls[1][0]).toBe('/api/reports?limit=20&cursor=after-expired');
  });

  it('rejects malformed item and cursor shapes instead of rendering partial records', async () => {
    fetch.mockResolvedValueOnce(response({ ok: true, items: [saved(), { ...saved({ id: 'bad' }), updatedAt: null }], nextCursor: 'next' }))
      .mockResolvedValueOnce(response({ ok: true, items: [], nextCursor: 42 }));
    render(<HistoryPage />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('link', { name: 'Saved report' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload history' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('refreshes the first page and shows explicit feedback after deletion', async () => {
    fetch.mockResolvedValueOnce(response({ ok: true, items: [saved()], nextCursor: null }))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response({ ok: true, items: [saved({ id: 'report-2', title: 'Newly saved report' })], nextCursor: null }));
    render(<HistoryPage />);
    await screen.findByRole('link', { name: 'Saved report' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('status')).toHaveTextContent('deleted or is already unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
    expect(await screen.findByRole('link', { name: 'Newly saved report' })).toBeInTheDocument();
    expect(fetch.mock.calls[2][0]).toBe('/api/reports?limit=20');
    expect(screen.queryByText('The report was deleted or is already unavailable.')).not.toBeInTheDocument();
  });

  it('does not submit a delete after confirmation is cancelled', async () => {
    fetch.mockResolvedValueOnce(response({ ok: true, items: [saved()], nextCursor: null }));
    render(<HistoryPage />);
    await screen.findByRole('link', { name: 'Saved report' });
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
  });
});
