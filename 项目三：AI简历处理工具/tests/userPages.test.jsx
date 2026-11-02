import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Home from '../pages/index';
import HistoryPage from '../pages/history';
import Header from '../components/Header';
import AppShell from '../components/AppShell';
import LoginPage from '../components/LoginPage';
import { signIn, signOut } from 'next-auth/react';
import { LanguageProvider, useLanguage } from '../components/LanguageProvider';

const router = vi.hoisted(() => ({ pathname: '/', query: {}, push: vi.fn() }));
const session = vi.hoisted(() => ({ status: 'unauthenticated', data: null }));
const routing = vi.hoisted(() => ({ available: true }));
vi.mock('next/compat/router', () => ({ useRouter: () => routing.available ? router : null }));
vi.mock('next/router', () => ({ useRouter: () => router }));
vi.mock('next-auth/react', () => ({ useSession: () => session, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ children, ...props }) => <a {...props}>{children}</a> }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));

function LanguageSwitch() {
  const { toggleLanguage } = useLanguage();
  return <button type="button" onClick={toggleLanguage}>Switch language</button>;
}

beforeEach(() => {
  router.pathname = '/';
  router.query = {};
  router.push.mockReset();
  routing.available = true;
  session.status = 'unauthenticated';
  session.data = null;
  vi.mocked(signIn).mockReset();
  vi.mocked(signOut).mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

function renderWithLanguage(ui) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

describe('user-facing pages', () => {
  it('presents the real workflow and truthful limits in both languages', () => {
    renderWithLanguage(<><Home /><LanguageSwitch /></>);
    expect(screen.getByRole('heading', { name: '让简历的下一步，更清楚。' })).toBeInTheDocument();
    expect(screen.getByText(/TXT、MD、PDF、DOCX/)).toBeInTheDocument();
    expect(screen.getByText(/单个文件最大 3 MB/)).toBeInTheDocument();
    expect(screen.queryByText(/阶段 1|01 \/ 04|工程与页面壳/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入工作台' })).toHaveAttribute('href', '/upload');
    expect(screen.getByRole('link', { name: '个人 AI 设置' })).toHaveAttribute('href', '/settings');
    expect(screen.getByRole('link', { name: '查看已保存报告' })).toHaveAttribute('href', '/history');
    expect(screen.getByText(/仅可修改标题和 Markdown 正文/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: '四步处理，由你掌控' })).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText(/确认文本会发往本站服务端，但不会调用 AI/)).toBeInTheDocument();
    expect(screen.getByText(/连接测试和分析可能产生服务商费用/)).toBeInTheDocument();
    expect(screen.getByText(/当前不提供报告导出/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    expect(screen.getByRole('heading', { name: 'Make your next resume step clearer.' })).toBeInTheDocument();
    expect(screen.getByText(/Up to 3 MB per file/)).toBeInTheDocument();
    expect(screen.queryByText(/Stage 1|01 \/ 04|Project and page shell/)).not.toBeInTheDocument();
  });

  it('keeps saved history empty state and retention readable in English', async () => {
    window.localStorage.setItem('resume-workspace-language', 'en');
    session.status = 'authenticated';
    session.data = { user: { id: 'owner-a' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, items: [], nextCursor: null }) }));
    renderWithLanguage(<HistoryPage />);
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'No saved reports yet' })).toBeInTheDocument();
    expect(screen.getByText(/14 days after the first save/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open workspace' })).toHaveAttribute('href', '/upload');
  });

  it('shows an explicit-save history empty state with a workspace next step', async () => {
    session.status = 'authenticated';
    session.data = { user: { id: 'owner-a' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, items: [], nextCursor: null }) }));
    renderWithLanguage(<HistoryPage />);
    expect(screen.getByRole('heading', { name: '历史记录' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '还没有保存的报告' })).toBeInTheDocument();
    expect(screen.getByText(/分析不会自动保存/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '进入工作台' })).toHaveAttribute('href', '/upload');
    expect(screen.queryByText(/实现状态|阶段 1/)).not.toBeInTheDocument();
  });

  it('keeps the active navigation state, skip link, and session loading state accessible', () => {
    router.pathname = '/history';
    session.status = 'loading';
    renderWithLanguage(<AppShell><p>content</p></AppShell>);
    expect(screen.getByRole('link', { name: '跳至主要内容' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('link', { name: '历史记录' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('正在检查登录状态');
    expect(screen.queryByRole('link', { name: '登录' })).not.toBeInTheDocument();
  });
});
