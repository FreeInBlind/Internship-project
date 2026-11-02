import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HistoryPage from '../pages/history';
import FeedbackPage from '../pages/feedback/[id]';
import ReportMarkdownEditor from '../components/ReportMarkdownEditor';
import { createReportDraft } from '../lib/reportDraft';

const ctx = vi.hoisted(() => ({ language: 'en', session: { status: 'authenticated', data: { user: { id: 'a' } } }, router: { isReady: true, query: { id: 'draft' }, replace: vi.fn() } }));
vi.mock('next-auth/react', () => ({ useSession: () => ctx.session }));
vi.mock('next/router', () => ({ useRouter: () => ctx.router }));
vi.mock('next/link', () => ({ default: ({ children, ...props }) => <a {...props}>{children}</a> }));
vi.mock('../components/Button', () => ({ default: ({ href, children }) => <a href={href}>{children}</a> }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));
vi.mock('../components/LanguageProvider', () => ({ useLanguage: () => ({ language: ctx.language, t: { feedbackTitle: 'Report details' } }) }));
const id = 'c6d3ecf0-626a-4a39-b2d0-27878446ab18';
const id2 = 'cae47792-2f35-492d-91e3-928862b7fded';
const report = { schemaVersion: 1, reportLanguage: 'en', overview: 'Overview source', strengths: [], issues: [], roleFit: { matches: [], gaps: [], limitations: [] }, rewriteExamples: [] };
const input = { confirmedResumeText: 'Confirmed resume', jobTitle: 'Developer', education: 'Degree', optionalJd: '', salary: '', reportLanguage: 'en' };
const dto = (overrides = {}) => ({ id, title: 'Saved title', jobTitle: 'Developer', reportLanguage: 'en', createdAt: new Date(Date.now() - 1000).toISOString(), updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), version: 'a'.repeat(64), editedMarkdown: 'Saved Markdown', reportJson: null, ...overrides });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; };
const editor = () => screen.getByRole('textbox', { name: 'Edit Markdown' });
function draft() { window.__resumeReportDraft = createReportDraft(report, 'Initial Markdown', input, 'a'); }
function detail() { ctx.router.query = { id }; }

beforeEach(() => {
  ctx.language = 'en';
  ctx.session = { status: 'authenticated', data: { user: { id: 'a' } } };
  ctx.router = { isReady: true, query: { id: 'draft' }, replace: vi.fn() };
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(window.crypto, 'randomUUID').mockReturnValue(id);
  delete window.__resumeReportDraft;
});
afterEach(() => { cleanup(); delete window.__resumeReportDraft; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('saved report lifecycle UI', () => {
  it('saves only on click, freezes one UUID/body and switches immediately into saved mode', async () => {
    draft();
    const pending = deferred();
    fetch.mockReturnValueOnce(pending.promise);
    render(<FeedbackPage />);
    expect(screen.getByText(/confirmed resume text and job details are retained with the report for 14 days/)).toBeInTheDocument();
    expect(screen.getByText(/Uploaded files and AI provider credentials are not saved/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(editor(), { target: { value: 'Explicit saved edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to history' }));
    expect(editor()).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Report title' })).toBeDisabled();
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/reports');
    expect(options).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    expect(options.headers).not.toHaveProperty('Origin');
    expect(JSON.parse(options.body)).toMatchObject({ ...input, saveId: id, title: 'Developer', editedMarkdown: 'Explicit saved edit', reportJson: report });
    await act(async () => pending.resolve(response({ ok: true, report: dto({ title: 'Developer', editedMarkdown: 'Explicit saved edit', reportJson: report }) }, 201)));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(ctx.router.replace).toHaveBeenCalledWith(`/feedback/${id}`);
    expect(screen.queryByText(/unsaved changes/)).not.toBeInTheDocument();
  });

  it('preserves uncertain POST edits, queries the known id, and never rePOSTs after 404', async () => {
    draft();
    fetch.mockRejectedValueOnce(new TypeError('Network lost')).mockResolvedValueOnce(response({ ok: false, error: { code: 'NOT_FOUND' } }, 404));
    render(<FeedbackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to history' }));
    await screen.findByText(/save result is unconfirmed/);
    fireEvent.change(editor(), { target: { value: 'Keep these later edits' } });
    expect(screen.getByRole('button', { name: 'Save to history' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Verify saved result' }));
    await screen.findByText(/original save may still finish/);
    expect(fetch.mock.calls[1][0]).toBe(`/api/reports/${id}`);
    expect(fetch.mock.calls.filter(([, value]) => value.method === 'POST')).toHaveLength(1);
    expect(editor()).toHaveValue('Keep these later edits');
    expect(screen.getByRole('button', { name: 'Save to history' })).toBeDisabled();
  });

  it('reconciles successful uncertain POST without losing subsequent local edits', async () => {
    draft();
    fetch.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response({ ok: true, report: dto({ title: 'Developer', editedMarkdown: 'Initial Markdown', reportJson: report }) }));
    render(<FeedbackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to history' }));
    await screen.findByText(/save result is unconfirmed/);
    fireEvent.change(editor(), { target: { value: 'Later local edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify saved result' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled());
    expect(editor()).toHaveValue('Later local edit');
    expect(ctx.router.replace).toHaveBeenCalledWith(`/feedback/${id}`);
  });

  it('loads Markdown-only history and PATCHes only title/Markdown with If-Match', async () => {
    detail();
    const saved = dto();
    fetch.mockResolvedValueOnce(response({ ok: true, report: saved })).mockResolvedValueOnce(response({ ok: true, report: { ...saved, version: 'b'.repeat(64), editedMarkdown: 'Updated' } }));
    render(<FeedbackPage />);
    expect(await screen.findByRole('textbox', { name: 'Edit Markdown' })).toHaveValue('Saved Markdown');
    expect(screen.queryByRole('heading', { name: 'Structured report' })).not.toBeInTheDocument();
    fireEvent.change(editor(), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled());
    const [, options] = fetch.mock.calls[1];
    expect(options.headers['If-Match']).toBe(saved.version);
    expect(JSON.parse(options.body)).toEqual({ title: saved.title, editedMarkdown: 'Updated' });
    expect(screen.getByText(new Date(saved.expiresAt).toLocaleString('en-US'))).toBeInTheDocument();
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  });

  it('loads existing cuid report identifiers as well as new UUID identifiers', async () => {
    const existingId = 'cmfixtureexistingreport0001';
    ctx.router.query = { id: existingId };
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto({ id: existingId }) }));
    render(<FeedbackPage />);
    expect(await screen.findByRole('textbox', { name: 'Edit Markdown' })).toHaveValue('Saved Markdown');
    expect(fetch.mock.calls[0][0]).toBe(`/api/reports/${existingId}`);
  });

  it('rejects a detail DTO whose id does not match the requested report', async () => {
    detail();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto({ id: id2 }) }));
    render(<FeedbackPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload latest version' })).toBeInTheDocument();
  });

  it('clears conflicting edits when reload returns a mismatched DTO id', async () => {
    detail();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto() }))
      .mockResolvedValueOnce(response({ ok: false, error: { code: 'VERSION_CONFLICT' } }, 412))
      .mockResolvedValueOnce(response({ ok: true, report: dto({ id: id2 }) }));
    render(<FeedbackPage />);
    await screen.findByRole('textbox', { name: 'Edit Markdown' });
    fireEvent.change(editor(), { target: { value: 'Conflicting secret edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload latest version' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest version' }));
    await screen.findByRole('alert');
    expect(screen.queryByDisplayValue('Conflicting secret edit')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload latest version' })).toBeInTheDocument();
  });

  it('requires matching saveId on POST confirmation and keeps verifying the frozen id', async () => {
    draft();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto({ id: id2, title: 'Developer' }) }, 201))
      .mockResolvedValueOnce(response({ ok: false, error: { code: 'NOT_FOUND' } }, 404));
    render(<FeedbackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to history' }));
    await screen.findByText(/save result is unconfirmed/);
    expect(ctx.router.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Verify saved result' }));
    await screen.findByText(/original save may still finish/);
    expect(fetch.mock.calls[1][0]).toBe(`/api/reports/${id}`);
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    expect(editor()).toHaveValue('Initial Markdown');
  });

  it('warns for title edits without labeling Markdown as changed', async () => {
    detail();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto() }));
    render(<FeedbackPage />);
    await screen.findByRole('textbox', { name: 'Edit Markdown' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Report title' }), { target: { value: 'Renamed report' } });
    expect(screen.getByText('The title has unsaved changes.')).toBeInTheDocument();
    expect(screen.queryByText('Markdown has unsaved changes.')).not.toBeInTheDocument();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps dirty input on version conflict and requires deliberate reload', async () => {
    detail();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto() })).mockResolvedValueOnce(response({ ok: false, error: { code: 'VERSION_CONFLICT' } }, 412));
    render(<FeedbackPage />);
    await screen.findByRole('textbox', { name: 'Edit Markdown' });
    fireEvent.change(editor(), { target: { value: 'My conflict edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/changed in another page/);
    expect(editor()).toHaveValue('My conflict edit');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload latest version' })).toBeInTheDocument();
  });

  it('hides owner data immediately and rejects a late PATCH after an account switch', async () => {
    detail();
    const pending = deferred();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto() })).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response({ ok: false }, 404));
    const view = render(<FeedbackPage />);
    await screen.findByRole('textbox', { name: 'Edit Markdown' });
    fireEvent.change(editor(), { target: { value: 'private account A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    ctx.session = { status: 'authenticated', data: { user: { id: 'b' } } };
    view.rerender(<FeedbackPage />);
    expect(screen.queryByDisplayValue('private account A')).not.toBeInTheDocument();
    await act(async () => pending.resolve(response({ ok: true, report: dto({ editedMarkdown: 'private account A' }) })));
    expect(screen.queryByRole('textbox', { name: 'Edit Markdown' })).not.toBeInTheDocument();
    expect(ctx.router.replace).not.toHaveBeenCalled();
  });

  it('does not revive a late draft read on route change and rejects mismatched-owner handoffs', async () => {
    detail();
    const pending = deferred();
    fetch.mockReturnValueOnce(pending.promise);
    const view = render(<FeedbackPage />);
    ctx.router.query = { id: 'draft' };
    window.__resumeReportDraft = createReportDraft(report, 'Account A secret', input, 'a');
    ctx.session = { status: 'authenticated', data: { user: { id: 'b' } } };
    view.rerender(<FeedbackPage />);
    await act(async () => pending.resolve(response({ ok: true, report: dto() })));
    expect(screen.queryByRole('textbox', { name: 'Edit Markdown' })).not.toBeInTheDocument();
    expect(screen.queryByText('Account A secret')).not.toBeInTheDocument();
  });

  it('clears content and disables every operation after a 401', async () => {
    detail();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto() })).mockResolvedValueOnce(response({ ok: false }, 401));
    render(<FeedbackPage />);
    await screen.findByRole('textbox', { name: 'Edit Markdown' });
    fireEvent.change(editor(), { target: { value: 'Never leave this visible' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/session has expired/);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete report' })).not.toBeInTheDocument();
    fireEvent.focus(window);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('clears expired detail on the timer and focus without a request', async () => {
    vi.useFakeTimers();
    detail();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto({ expiresAt: new Date(Date.now() + 2000).toISOString() }) }));
    render(<FeedbackPage />);
    await act(async () => {});
    expect(editor()).toHaveValue('Saved Markdown');
    await act(async () => { vi.advanceTimersByTime(2001); });
    fireEvent.focus(window);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('expired');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('confirms deletion and never retries uncertain deletion', async () => {
    detail();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto() })).mockRejectedValueOnce(new Error('lost'));
    render(<FeedbackPage />);
    await screen.findByRole('textbox', { name: 'Edit Markdown' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete report' }));
    await screen.findByText(/delete result is unconfirmed/);
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'DELETE', cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete report' })).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not restore a late first-save response after switching accounts', async () => {
    draft();
    const pending = deferred();
    fetch.mockReturnValueOnce(pending.promise);
    const view = render(<FeedbackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to history' }));
    ctx.session = { status: 'authenticated', data: { user: { id: 'b' } } };
    view.rerender(<FeedbackPage />);
    expect(screen.queryByRole('textbox', { name: 'Edit Markdown' })).not.toBeInTheDocument();
    await act(async () => pending.resolve(response({ ok: true, report: dto({ reportJson: report }) }, 201)));
    expect(screen.queryByRole('textbox', { name: 'Edit Markdown' })).not.toBeInTheDocument();
    expect(ctx.router.replace).not.toHaveBeenCalled();
  });

  it('cancels deletion without sending a mutation and accepts successful deletion', async () => {
    detail();
    fetch.mockResolvedValueOnce(response({ ok: true, report: dto() })).mockResolvedValueOnce(response(null, 204));
    render(<FeedbackPage />);
    await screen.findByRole('textbox', { name: 'Edit Markdown' });
    window.confirm.mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete report' }));
    expect(fetch).toHaveBeenCalledOnce();
    expect(editor()).toHaveValue('Saved Markdown');
    fireEvent.click(screen.getByRole('button', { name: 'Delete report' }));
    await screen.findByText('The report was deleted.');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps reconciled local edits when Next replaces the draft route with its saved id', async () => {
    draft();
    fetch.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response({ ok: true, report: dto({ title: 'Developer', editedMarkdown: 'Initial Markdown', reportJson: report }) }));
    const view = render(<FeedbackPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to history' }));
    await screen.findByText(/save result is unconfirmed/);
    fireEvent.change(editor(), { target: { value: 'Keep across replace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify saved result' }));
    await waitFor(() => expect(ctx.router.replace).toHaveBeenCalled());
    ctx.router.query = { id };
    view.rerender(<FeedbackPage />);
    expect(editor()).toHaveValue('Keep across replace');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('allows legacy display but blocks saving without context or a real owner', () => {
    window.__resumeReportDraft = { report, markdown: 'Legacy content' };
    ctx.session = { status: 'authenticated', data: { user: { email: 'a@example.test' } } };
    render(<FeedbackPage />);
    expect(editor()).toHaveValue('Legacy content');
    expect(screen.getByRole('button', { name: 'Save to history' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('history pages', () => {
  it('distinguishes loading, error and empty states and fetches cursor pages without body data', async () => {
    const pending = deferred();
    fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response({ ok: true, items: [dto({ id: id2, title: 'Page two' })], nextCursor: null }));
    render(<HistoryPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading history');
    expect(screen.queryByText('No saved reports yet')).not.toBeInTheDocument();
    await act(async () => pending.resolve(response({ ok: true, items: [dto()], nextCursor: 'private+cursor' })));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'Page two' })).toHaveAttribute('href', `/feedback/${id2}`);
    expect(within(screen.getByRole('list', { name: 'History' })).getAllByRole('listitem')).toHaveLength(2);
    expect(fetch.mock.calls[1][0]).toBe('/api/reports?limit=20&cursor=private%2Bcursor');
    expect(fetch.mock.calls[1][1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
  });

  it('does not present a failed first request as an empty history', async () => {
    fetch.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response({ ok: true, items: [], nextCursor: null }));
    render(<HistoryPage />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { name: 'No saved reports yet' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reload history' }));
    expect(await screen.findByRole('heading', { name: 'No saved reports yet' })).toBeInTheDocument();
  });

  it('clears lists on owner change and ignores late results from the former owner', async () => {
    const pending = deferred();
    fetch.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response({ ok: true, items: [], nextCursor: null }));
    const view = render(<HistoryPage />);
    ctx.session = { status: 'authenticated', data: { user: { id: 'b' } } };
    view.rerender(<HistoryPage />);
    await act(async () => pending.resolve(response({ ok: true, items: [dto()], nextCursor: null })));
    expect(screen.queryByRole('link', { name: 'Saved title' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'No saved reports yet' })).toBeInTheDocument();
  });

  it('removes expired list entries on timer/focus and blocks requests after session expiry', async () => {
    vi.useFakeTimers();
    fetch.mockResolvedValueOnce(response({ ok: true, items: [dto({ expiresAt: new Date(Date.now() + 1000).toISOString() })], nextCursor: null }));
    const view = render(<HistoryPage />);
    await act(async () => {});
    expect(screen.getByRole('link', { name: 'Saved title' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(1001));
    fireEvent.focus(window);
    expect(screen.queryByRole('link', { name: 'Saved title' })).not.toBeInTheDocument();
    ctx.session = { status: 'unauthenticated', data: null };
    view.rerender(<HistoryPage />);
    expect(screen.getByRole('alert')).toHaveTextContent('session has expired');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('clears previously loaded pages after a 401 and does not offer retry operations', async () => {
    fetch.mockResolvedValueOnce(response({ ok: true, items: [dto()], nextCursor: 'next' })).mockResolvedValueOnce(response({ ok: false, error: { code: 'UNAUTHORIZED' } }, 401));
    render(<HistoryPage />);
    await screen.findByRole('link', { name: 'Saved title' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText(/session has expired/);
    expect(screen.queryByRole('link', { name: 'Saved title' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    fireEvent.focus(window);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('removes a deleted list record after confirmation, treating 404 as already absent', async () => {
    fetch.mockResolvedValueOnce(response({ ok: true, items: [dto()], nextCursor: null })).mockResolvedValueOnce(response(null, 404));
    render(<HistoryPage />);
    await screen.findByRole('link', { name: 'Saved title' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Saved title' })).not.toBeInTheDocument());
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[1][1].method).toBe('DELETE');
  });
});

describe('safe React Markdown preview', () => {
  it('renders supported elements and never creates resources or unsafe encoded links', () => {
    const markdown = '# Heading\n\n**Strong** and *emphasis* and `code`\n\n- One\n- Two\n\n[HTTPS](https://example.test/path) [Email](mailto:a@example.test) [Hash](#section) [bad](javascript:alert) [encoded](java%73cript:alert) [entity](javascript&#58;alert)\n\n![track](https://tracker.test/pixel) <iframe src="https://tracker.test">embed</iframe>\n\n```html\n<script>bad()</script>\n```';
    const { container } = render(<ReportMarkdownEditor value={markdown} onChange={() => {}} language="en" />);
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    expect(container.querySelector('strong')).toHaveTextContent('Strong');
    expect(container.querySelector('em')).toHaveTextContent('emphasis');
    expect(screen.getByRole('link', { name: 'HTTPS' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:a@example.test');
    expect(screen.getByRole('link', { name: 'Hash' })).toHaveAttribute('href', '#section');
    expect(container.querySelector('img, iframe, script, object, embed, video, audio, source, style, link')).toBeNull();
    expect(container.querySelector('[src], [srcset], [style]')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(fetch).not.toHaveBeenCalled();
  });
});
