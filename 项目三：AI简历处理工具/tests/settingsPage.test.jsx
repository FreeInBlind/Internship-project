import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../pages/settings';
import { CustomAiProvider, useCustomAi } from '../components/CustomAiProvider';
import { LanguageProvider } from '../components/LanguageProvider';

const customAiRequest = vi.hoisted(() => vi.fn());
const sessionState = vi.hoisted(() => ({ data: { user: { id: 'settings-user' } }, status: 'authenticated' }));
vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('../lib/customAiClient', async (importOriginal) => ({ ...await importOriginal(), customAiRequest: (path, body, options) => options?.method === 'GET' ? Promise.resolve({ ok: true, config: null, persistenceAvailable: true }) : customAiRequest(path, body, options) }));

const fixture = { baseUrl: 'https://api.provider.com/v1', apiKey: 'fixture-secret-key', model: 'model-one' };
let providerState;
function Probe() { providerState = useCustomAi(); return null; }
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function setup({ config = null, language = 'zh' } = {}) {
  window.localStorage.setItem('resume-workspace-language', language);
  const tree = (visible = true) => <CustomAiProvider><LanguageProvider>{visible && <SettingsPage />}<Probe /></LanguageProvider></CustomAiProvider>;
  const view = render(tree());
  if (config) act(() => providerState.updateConfig(config));
  return { ...view, showPage: (visible) => view.rerender(tree(visible)) };
}
const baseUrlInput = () => screen.getByLabelText('API 根地址');
const keyInput = () => screen.getByLabelText('API 密钥');
const modelInput = () => screen.getByLabelText('模型');
const form = () => screen.getByRole('form', { name: '自定义 AI 配置' });
const saveButton = () => screen.getByRole('button', { name: /仅本次使用|正在校验并保存/ });
const testButton = () => screen.getByRole('button', { name: /测试连接/ });
function fill(config = fixture) {
  fireEvent.change(baseUrlInput(), { target: { value: config.baseUrl } });
  fireEvent.change(keyInput(), { target: { value: config.apiKey } });
  fireEvent.change(modelInput(), { target: { value: config.model } });
}
function failure(code) { return Object.assign(new Error('private upstream detail fixture-secret-key https://private.invalid'), { code }); }

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(customAiRequest).mockReset().mockResolvedValue({ ok: true });
  sessionState.data = { user: { id: 'settings-user' } };
  sessionState.status = 'authenticated';
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network requests allowed in settings DOM tests'); }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe('settings page configuration and copy boundaries', () => {
  it('saves only on explicit submit, clears the input but retains provider credentials, and links to upload', async () => {
    const view = setup();
    expect(customAiRequest).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: '前往工作台' })).not.toBeInTheDocument();
    fill();
    fireEvent.click(saveButton());
    await screen.findByText(/临时配置已保存并启用/);
    expect(customAiRequest).toHaveBeenCalledTimes(1);
    expect(customAiRequest).toHaveBeenCalledWith('/api/custom-ai/config', { config: fixture }, { signal: expect.any(AbortSignal) });
    expect(providerState.config).toEqual(fixture);
    expect(keyInput()).toHaveValue('');
    expect(screen.getByRole('link', { name: '前往工作台' })).toHaveAttribute('href', '/upload');
    expect(document.body.textContent).not.toContain(fixture.apiKey);
    expect(JSON.stringify(window.localStorage)).not.toContain(fixture.apiKey);
    expect(window.sessionStorage.length).toBe(0);
    // Mirrors the persistent _app provider while a routed page is unmounted.
    view.showPage(false);
    expect(providerState.config).toEqual(fixture);
    view.showPage(true);
    expect(baseUrlInput()).toHaveValue(fixture.baseUrl);
    expect(modelInput()).toHaveValue(fixture.model);
    expect(keyInput()).toHaveValue('');
    expect(screen.getByRole('link', { name: '前往工作台' })).toBeInTheDocument();
    expect(customAiRequest).toHaveBeenCalledTimes(1);
  });

  it('reuses the active key for a model-only replacement and clearly confirms replacement success', async () => {
    setup({ config: fixture });
    fireEvent.change(modelInput(), { target: { value: 'model-two' } });
    fireEvent.click(saveButton());
    await screen.findByText(/临时配置已替换并启用/);
    expect(customAiRequest).toHaveBeenCalledWith('/api/custom-ai/config', { config: { ...fixture, model: 'model-two' } }, expect.any(Object));
    expect(providerState.config).toEqual({ ...fixture, model: 'model-two' });
    expect(screen.getByRole('link', { name: '前往工作台' })).toHaveAttribute('href', '/upload');
  });

  it('requires a new key after changing the root and never sends the old key to a new target', async () => {
    setup({ config: fixture });
    fireEvent.change(keyInput(), { target: { value: 'draft-key' } });
    fireEvent.change(baseUrlInput(), { target: { value: 'https://other.provider.com/api/v1' } });
    expect(keyInput()).toHaveValue('');
    fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('改用其他 API 根地址前，请重新输入 API 密钥。');
    expect(customAiRequest).not.toHaveBeenCalled();
    expect(providerState.config).toEqual(fixture);
    fireEvent.change(keyInput(), { target: { value: 'replacement-key' } });
    fireEvent.click(saveButton());
    await screen.findByText(/临时配置已替换并启用/);
    expect(providerState.config).toEqual({ baseUrl: 'https://other.provider.com/api/v1', apiKey: 'replacement-key', model: fixture.model });
  });

  it('testing is explicit, does not save, retains the draft key, and allows a separate save', async () => {
    setup();
    fill();
    expect(customAiRequest).not.toHaveBeenCalled();
    fireEvent.click(testButton());
    expect(await screen.findByRole('status')).toHaveTextContent('连接测试成功，但本次输入尚未保存');
    expect(customAiRequest).toHaveBeenCalledWith('/api/custom-ai/test', { config: fixture, requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i) }, { signal: expect.any(AbortSignal) });
    expect(providerState.config).toBeNull();
    expect(keyInput()).toHaveValue(fixture.apiKey);
    expect(screen.queryByRole('link', { name: '前往工作台' })).not.toBeInTheDocument();
    fireEvent.click(saveButton());
    await screen.findByText(/临时配置已保存并启用/);
    expect(providerState.config).toEqual(fixture);
    expect(customAiRequest).toHaveBeenCalledTimes(2);
  });

  it('testing a replacement does not change the active configuration', async () => {
    setup({ config: fixture });
    fireEvent.change(modelInput(), { target: { value: 'unapplied-model' } });
    fireEvent.click(testButton());
    expect(await screen.findByRole('status')).toHaveTextContent('已有配置保持不变');
    expect(providerState.config).toEqual(fixture);
  });

  it.each(['', '/v1', '/api/v1'])('accepts an API root with the supported %s prefix', async (prefix) => {
    setup();
    fill({ ...fixture, baseUrl: `https://api.provider.com${prefix}` });
    fireEvent.click(saveButton());
    await screen.findByText(/临时配置已保存并启用/);
    expect(providerState.config.baseUrl).toBe(`https://api.provider.com${prefix}`);
  });

  it('rejects a full chat endpoint before sending a request', async () => {
    setup();
    fill({ ...fixture, baseUrl: `${fixture.baseUrl}/chat/completions` });
    fireEvent.click(testButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('不要填写完整接口端点');
    expect(customAiRequest).not.toHaveBeenCalled();
  });

  it('uses server input limits and accurate Chinese privacy, routing, billing, and lifetime copy without stage placeholders', () => {
    setup();
    expect(baseUrlInput()).toHaveAttribute('maxlength', '2048');
    expect(keyInput()).toHaveAttribute('maxlength', '4096');
    expect(modelInput()).toHaveAttribute('maxlength', '200');
    expect(baseUrlInput()).toHaveAccessibleDescription(/支持 HTTPS 公网域名及 \/v1、\/api\/v1/);
    expect(baseUrlInput()).toHaveAccessibleDescription(/不会自动添加 \/v1/);
    expect(baseUrlInput()).toHaveAccessibleDescription(/服务端会在根地址后追加 \/chat\/completions/);
    expect(keyInput()).toHaveAccessibleDescription(/保存校验会将密钥提交到本站服务器/);
    expect(keyInput()).toHaveAccessibleDescription(/测试和分析经本站服务器代理/);
    expect(screen.getByText(/配置保存在当前标签页的应用内存中/)).toHaveTextContent('站内页面切换时仍可使用');
    expect(screen.getByText(/配置保存在当前标签页的应用内存中/)).toHaveTextContent('刷新页面、关闭标签页、退出登录');
    expect(screen.getByText(/测试不等于保存/)).toHaveTextContent('供应商可能计费');
    expect(screen.getByText(/修改输入或清除配置会取消本页等待/)).toHaveTextContent('无法保证供应商停止处理或计费');
    expect(document.body.textContent).not.toMatch(/03 \/ Preferences|后续阶段|尚未实现|当前页面会话|离开页面.*丢失|不会写入.*服务器/);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('provides the same honest boundaries and separate save success in English', async () => {
    setup({ language: 'en' });
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('API root URL')).toHaveAccessibleDescription(/path prefix such as \/v1 or \/api\/v1/);
    expect(screen.getByLabelText('API key')).toHaveAccessibleDescription(/proxied through this site’s server/);
    expect(screen.getByText(/Configuration lives in this tab’s application memory/)).toHaveTextContent('remains available during in-app navigation');
    expect(screen.getByText(/Testing does not save configuration/)).toHaveTextContent('may incur provider charges');
    expect(document.body.textContent).not.toMatch(/Stage|later stages|leave the page|never written.*server/i);
    fireEvent.change(screen.getByLabelText('API root URL'), { target: { value: fixture.baseUrl } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: fixture.apiKey } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: fixture.model } });
    fireEvent.click(screen.getByRole('button', { name: 'Use temporarily' }));
    expect(await screen.findByRole('status')).toHaveTextContent('saved and activated');
    expect(screen.getByRole('link', { name: 'Go to workspace' })).toHaveAttribute('href', '/upload');
  });
});

describe('settings request ownership and loading', () => {
  it.each(['save', 'test'])('renders busy state immediately and locks repeated %s or cross-action requests', async (operation) => {
    const pending = deferred();
    vi.mocked(customAiRequest).mockReturnValueOnce(pending.promise);
    setup();
    fill();
    act(() => {
      fireEvent.click(operation === 'save' ? saveButton() : testButton());
      fireEvent.submit(form());
    });
    expect(form()).toHaveAttribute('aria-busy', 'true');
    expect(saveButton()).toBeDisabled();
    expect(testButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: operation === 'save' ? '正在校验并保存…' : '正在测试连接…' })).toBeDisabled();
    fireEvent.click(testButton());
    expect(customAiRequest).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ ok: true }));
    expect(form()).toHaveAttribute('aria-busy', 'false');
    expect(saveButton()).toBeEnabled();
    expect(testButton()).toBeEnabled();
  });

  it.each(['resolve', 'reject'])('a stale %s cannot clear a newer key, unlock a new request, show a notice, or save old input', async (settlement) => {
    const old = deferred();
    const next = deferred();
    vi.mocked(customAiRequest).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    setup();
    fill();
    fireEvent.click(saveButton());
    const oldSignal = vi.mocked(customAiRequest).mock.calls[0][2].signal;
    fireEvent.change(modelInput(), { target: { value: 'new-model' } });
    fireEvent.change(keyInput(), { target: { value: 'new-secret-key' } });
    expect(oldSignal.aborted).toBe(true);
    fireEvent.click(testButton());
    const nextSignal = vi.mocked(customAiRequest).mock.calls[1][2].signal;
    await act(async () => settlement === 'resolve' ? old.resolve({ ok: true }) : old.reject(failure('UPSTREAM_AUTH')));
    expect(keyInput()).toHaveValue('new-secret-key');
    expect(form()).toHaveAttribute('aria-busy', 'true');
    expect(saveButton()).toBeDisabled();
    expect(testButton()).toBeDisabled();
    expect(nextSignal.aborted).toBe(false);
    expect(providerState.config).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.submit(form());
    expect(customAiRequest).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve({ ok: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('本次输入尚未保存');
    expect(keyInput()).toHaveValue('new-secret-key');
    fireEvent.click(saveButton());
    await screen.findByText(/临时配置已保存并启用/);
    expect(providerState.config).toEqual({ ...fixture, apiKey: 'new-secret-key', model: 'new-model' });
  });

  it('allows clear while busy, aborts the request, and prevents stale resurrection or key clearing', async () => {
    const old = deferred();
    vi.mocked(customAiRequest).mockReturnValueOnce(old.promise);
    setup({ config: fixture });
    fireEvent.click(testButton());
    const signal = vi.mocked(customAiRequest).mock.calls[0][2].signal;
    expect(screen.getByRole('button', { name: '清除临时配置' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '清除临时配置' }));
    expect(signal.aborted).toBe(true);
    expect(providerState.config).toBeNull();
    expect(baseUrlInput()).toHaveValue('');
    expect(keyInput()).toHaveValue('');
    expect(modelInput()).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('临时配置已清除。');
    expect(screen.queryByRole('link', { name: '前往工作台' })).not.toBeInTheDocument();
    fill({ ...fixture, apiKey: 'draft-after-clear' });
    await act(async () => old.resolve({ ok: true }));
    expect(keyInput()).toHaveValue('draft-after-clear');
    expect(providerState.config).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['replacement', 'logout', 'pagehide'])('invalidates pending work on external provider %s', async (action) => {
    const old = deferred();
    vi.mocked(customAiRequest).mockReturnValueOnce(old.promise);
    const view = setup({ config: fixture });
    fireEvent.click(saveButton());
    const signal = vi.mocked(customAiRequest).mock.calls[0][2].signal;
    const replacement = { ...fixture, apiKey: 'other-key', model: 'other-model' };
    if (action === 'replacement') act(() => providerState.updateConfig(replacement));
    if (action === 'logout') {
      sessionState.status = 'unauthenticated';
      sessionState.data = null;
      view.showPage(true);
    }
    if (action === 'pagehide') act(() => window.dispatchEvent(new Event('pagehide')));
    expect(signal.aborted).toBe(true);
    expect(form()).toHaveAttribute('aria-busy', 'false');
    await act(async () => old.resolve({ ok: true }));
    expect(providerState.config).toEqual(action === 'replacement' ? replacement : null);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(modelInput()).toHaveValue(action === 'replacement' ? replacement.model : '');
  });

  it('aborts on page unmount without letting a stale save update the persistent provider', async () => {
    const pending = deferred();
    vi.mocked(customAiRequest).mockReturnValueOnce(pending.promise);
    const view = setup();
    fill();
    fireEvent.click(saveButton());
    const signal = vi.mocked(customAiRequest).mock.calls[0][2].signal;
    view.showPage(false);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve({ ok: true }));
    expect(providerState.config).toBeNull();
    view.showPage(true);
    expect(saveButton()).toBeEnabled();
    expect(keyInput()).toHaveValue('');
  });
});

describe('settings safe error categories', () => {
  it.each([
    ['INVALID_BASE_URL', 'API 根地址格式不受支持'],
    ['INSECURE_TRANSPORT', '本站当前连接不安全'],
    ['INVALID_API_KEY', 'API 密钥格式不正确'],
    ['INVALID_MODEL', '模型格式不正确'],
    ['INVALID_REQUEST_BODY', '配置格式或长度不符合要求'],
    ['INPUT_TOO_LARGE', '配置格式或长度不符合要求'],
    ['UNAUTHORIZED', '登录状态已失效'],
    ['FORBIDDEN', '本站拒绝了此请求'],
    ['UPSTREAM_AUTH', '供应商拒绝认证'],
    ['UPSTREAM_RATE_LIMIT', '请求过于频繁或供应商额度不足'],
    ['RATE_LIMITED', '请求过于频繁或供应商额度不足'],
    ['UPSTREAM_TIMEOUT', '供应商响应超时'],
    ['UPSTREAM_DNS', '无法解析供应商域名'],
    ['UNSAFE_UPSTREAM_ADDRESS', '供应商地址未通过公网安全校验'],
    ['INVALID_UPSTREAM_RESPONSE', '供应商接口或响应不兼容'],
    ['UPSTREAM_REDIRECT', '供应商接口或响应不兼容'],
    ['UPSTREAM_UNAVAILABLE', '供应商暂时不可用'],
    ['REQUEST_IN_PROGRESS', '已有请求正在处理'],
    ['REQUEST_ALREADY_HANDLED', '此测试请求已处理'],
    ['REQUEST_CAPACITY', '当前服务暂时繁忙'],
    ['UPSTREAM_ABORTED', '请求已中止'],
    ['UNKNOWN_WITH_PRIVATE_DETAIL', '无法完成请求'],
  ])('maps %s to a safe actionable message and never changes active config', async (code, message) => {
    vi.mocked(customAiRequest).mockRejectedValueOnce(failure(code));
    setup({ config: fixture });
    fireEvent.change(keyInput(), { target: { value: 'unsaved-key' } });
    fireEvent.click(testButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).not.toHaveTextContent(/private upstream detail|fixture-secret-key|private.invalid|UNKNOWN_WITH_PRIVATE_DETAIL/);
    expect(providerState.config).toEqual(fixture);
    expect(keyInput()).toHaveValue('unsaved-key');
    expect(saveButton()).toBeEnabled();
    expect(testButton()).toBeEnabled();
    expect(customAiRequest).toHaveBeenCalledTimes(1);
  });

  it('does not apply a non-success response and gives a safe fallback', async () => {
    vi.mocked(customAiRequest).mockResolvedValueOnce({ ok: false, privateDetail: fixture.apiKey });
    setup();
    fill();
    fireEvent.click(saveButton());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('无法完成请求'));
    expect(providerState.config).toBeNull();
    expect(document.body.textContent).not.toContain(fixture.apiKey);
  });
});
