vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'fixture-owner' } } }) }));
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UploadPage from '../pages/upload';
import { LanguageProvider, useLanguage } from '../components/LanguageProvider';
import { createBrowserOcr } from '../lib/browserOcr';
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ push }) }));
vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {} }));
vi.mock('../lib/browserOcr', async importOriginal => ({ ...await importOriginal(), createBrowserOcr: vi.fn() }));
function LanguageSwitch() { const { toggleLanguage } = useLanguage(); return <button type="button" onClick={toggleLanguage}>Switch language</button>; }
beforeEach(() => { window.localStorage.clear(); vi.mocked(createBrowserOcr).mockReturnValue({ recognize: vi.fn().mockResolvedValue({ text: 'Entirely fictional resume text.' }), cancel: vi.fn() }); });
afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('official AI disabled interface with real language provider', () => {
  it('shows the acceptance notice only when the explicit public flag is enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_STAGE4A_ACCEPTANCE', 'true');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ extraction: { text: 'Entirely fictional resume text.' } }) })));
    render(<LanguageProvider><LanguageSwitch /><UploadPage /></LanguageProvider>);
    fireEvent.change(screen.getByLabelText(/选择文件/), { target: { files: [{ name: 'fictional.png', size: 100, arrayBuffer: async () => new ArrayBuffer(1) }] } });
    await screen.findByRole('textbox', { name: '待确认简历文本' });
    fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
    await screen.findByRole('heading', { name: '官方 AI' });
    expect(screen.getByText(/官方 AI 当前可用/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始 AI 分析' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('目标岗位（必填）'), { target: { value: '工程师' } });
    fireEvent.change(screen.getByLabelText('最高学历（必填）'), { target: { value: '本科' } });
    expect(screen.getByRole('button', { name: '开始 AI 分析' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    expect(screen.getByText(/Official AI is currently available/)).toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/upload']);
  });

  it('keeps extraction/confirmation working and never sends an official request in either language', async () => {
    const fetchMock = vi.fn(async (url, options) => {
      if (url !== '/api/upload') throw new Error('Unexpected analysis request');
      return { ok: true, json: async () => ({ extraction: { text: JSON.parse(options.body).text } }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<LanguageProvider><LanguageSwitch /><UploadPage /></LanguageProvider>);
    fireEvent.change(screen.getByLabelText(/选择文件/), { target: { files: [{ name: 'fictional.png', size: 100, arrayBuffer: async () => new ArrayBuffer(1) }] } });
    await screen.findByRole('textbox', { name: '待确认简历文本' });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认并提交文本' }));
    await screen.findByRole('heading', { name: '官方 AI' });
    expect(screen.getByText(/官方 AI 暂不开放/)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: '暂不支持' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    // Deliberately bypass the DOM disabled property: the handler itself must still refuse.
    button.disabled = false;
    fireEvent.click(button);
    button.disabled = true;
    expect(screen.getByRole('link', { name: '配置个人 AI' })).toHaveAttribute('href', '/settings');
    fireEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    expect(screen.getByRole('heading', { name: 'Official AI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Currently unavailable' })).toBeDisabled();
    expect(screen.getByText(/Official AI is paused/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/upload');
    expect(push).not.toHaveBeenCalled();
  });
});
