import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../pages/settings';
import { CustomAiProvider, useCustomAi } from '../components/CustomAiProvider';
import { LanguageProvider } from '../components/LanguageProvider';
import { customAiRequest } from '../lib/customAiClient';

const auth = vi.hoisted(() => ({ data: { user: { id: 'owner-a' } }, status: 'authenticated' }));
vi.mock('next-auth/react', () => ({ useSession: () => auth }));
vi.mock('../lib/requireSession', () => ({ requireSession: vi.fn() }));
vi.mock('../components/PageHead', () => ({ default: () => null }));
vi.mock('../lib/customAiClient', async (original) => ({ ...await original(), customAiRequest: vi.fn() }));
const saved = { baseUrl: 'https://api.provider.com/v1', model: 'saved-model', hasKey: true, maskedKey: '••••••••', storage: 'account-encrypted', configVersion: 'version_one', updatedAt: '2026-11-02T00:00:00Z' };
const temporary = { baseUrl: 'https://temp.provider.com/v1', apiKey: 'temporary-secret', model: 'temporary-model' };
let state;
let metadata;
let available;
function Probe() { state = useCustomAi(); return <span data-testid="selected-model">{state.config?.model || ''}</span>; }
function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
function setup() {
  const tree = (visible = true) => <CustomAiProvider><LanguageProvider>{visible && <SettingsPage />}<Probe /></LanguageProvider></CustomAiProvider>;
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()), hide: () => view.rerender(tree(false)) };
}
const keyInput = () => screen.getByLabelText('API 密钥');
const modelInput = () => screen.getByLabelText('模型');
const button = (name) => screen.getByRole('button', { name });
async function hydrated() { await waitFor(() => expect(state.loading).toBe(false)); }
const writes = () => vi.mocked(customAiRequest).mock.calls.filter(([, , options]) => options?.method !== 'GET');

beforeEach(() => {
  vi.clearAllMocks();
  metadata = { ...saved };
  available = true;
  auth.data = { user: { id: 'owner-a' } }; auth.status = 'authenticated';
  window.localStorage.clear(); window.sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Offline tests only'); }));
  vi.mocked(customAiRequest).mockReset().mockImplementation(async (_path, _body, options) => options?.method === 'GET' ? { ok: true, config: metadata, persistenceAvailable: available } : { ok: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe('saved account configuration UI', () => {
  it('hydrates only whitelisted metadata and never returns or stores a saved key', async () => {
    metadata = { ...saved, apiKey: 'server-secret-never-admitted', extra: 'private' };
    setup(); await hydrated();
    expect(customAiRequest).toHaveBeenCalledWith('/api/custom-ai/config', undefined, { method: 'GET', signal: expect.any(AbortSignal) });
    expect(state.config).toEqual({ baseUrl: saved.baseUrl, model: saved.model, hasKey: true, source: 'saved', configVersion: saved.configVersion });
    expect(state.savedConfig).toEqual(saved);
    expect(keyInput()).toHaveValue('');
    expect(JSON.stringify(state)).not.toContain('server-secret');
    expect(document.body.textContent).not.toContain('server-secret');
    expect(JSON.stringify(window.localStorage)).not.toContain(saved.baseUrl);
    expect(window.sessionStorage.length).toBe(0);
    expect(writes()).toHaveLength(0);
  });

  it('tests a changed saved model without key disclosure or changing persistence', async () => {
    setup(); await hydrated();
    fireEvent.change(modelInput(), { target: { value: 'one-off-model' } });
    fireEvent.click(button('测试连接'));
    await screen.findByText(/连接测试成功/);
    expect(writes()[0][1]).toEqual({ source: 'saved', configVersion: saved.configVersion, model: 'one-off-model', requestId: expect.any(String) });
    expect(writes()[0][1]).not.toHaveProperty('config');
    expect(state.savedConfig.model).toBe('saved-model');
    expect(state.config.model).toBe('saved-model');
    fireEvent.click(button('仅本次使用'));
    await waitFor(() => expect(state.config.model).toBe('one-off-model'));
    expect(state.config).not.toHaveProperty('apiKey');
    expect(state.savedConfig.model).toBe('saved-model');
    fireEvent.click(button('清除临时配置'));
    await waitFor(() => expect(state.config.model).toBe('saved-model'));
    expect(writes()).toHaveLength(1);
  });

  it('keeps temporary credentials ahead of reload and clearing only falls back to saved', async () => {
    setup(); await hydrated();
    act(() => state.updateConfig(temporary));
    await act(async () => state.reloadSavedConfig());
    expect(state.config).toEqual(temporary);
    fireEvent.click(button('清除临时配置'));
    await waitFor(() => expect(state.config.source).toBe('saved'));
    expect(state.savedConfig).toEqual(saved);
    expect(writes()).toHaveLength(0);
  });

  it.each([null, saved])('uses conditional creation or replacement and clears successful key input', async (initial) => {
    metadata = initial;
    setup(); await hydrated();
    fireEvent.change(screen.getByLabelText('API 根地址'), { target: { value: saved.baseUrl } });
    fireEvent.change(modelInput(), { target: { value: 'new-model' } });
    fireEvent.change(keyInput(), { target: { value: 'new-secret' } });
    vi.mocked(customAiRequest).mockImplementation(async (_path, _body, options) => {
      if (options?.method === 'PUT') { metadata = { ...saved, model: 'new-model', configVersion: 'version_two' }; return { ok: true, config: metadata }; }
      return { ok: true, config: metadata, persistenceAvailable: true };
    });
    fireEvent.click(button('加密保存到账户'));
    await screen.findByText(/账户配置已加密保存/);
    await waitFor(() => expect(state.savedConfig.configVersion).toBe('version_two'));
    expect(writes()[0]).toEqual(['/api/custom-ai/config', { config: { baseUrl: saved.baseUrl, model: 'new-model', apiKey: 'new-secret' } }, { method: 'PUT', signal: expect.any(AbortSignal), headers: initial ? { 'If-Match': saved.configVersion } : { 'If-None-Match': '*' } }]);
    expect(keyInput()).toHaveValue('');
    expect(state.config).not.toHaveProperty('apiKey');
  });

  it('reuses saved key for same-URL account model updates but requires key for URL changes', async () => {
    setup(); await hydrated();
    fireEvent.change(modelInput(), { target: { value: 'updated-model' } });
    fireEvent.click(button('加密保存到账户'));
    await screen.findByText(/账户配置已加密保存/);
    expect(writes()[0][1]).toEqual({ config: { baseUrl: saved.baseUrl, model: 'updated-model' } });
    fireEvent.change(screen.getByLabelText('API 根地址'), { target: { value: 'https://other.provider.com/v1' } });
    fireEvent.click(button('仅本次使用'));
    expect(await screen.findByRole('alert')).toHaveTextContent('重新输入 API 密钥');
    expect(writes()).toHaveLength(1);
  });

  it('deletes with version while preserving temporary credentials', async () => {
    setup(); await hydrated(); act(() => state.updateConfig(temporary));
    vi.mocked(customAiRequest).mockImplementation(async (_path, _body, options) => {
      if (options?.method === 'DELETE') metadata = null;
      return { ok: true, config: metadata, persistenceAvailable: true };
    });
    fireEvent.click(button('删除账户配置'));
    await screen.findByText(/账户配置已删除/);
    await waitFor(() => expect(state.savedConfig).toBeNull());
    expect(writes()[0]).toEqual(['/api/custom-ai/config', undefined, { method: 'DELETE', signal: expect.any(AbortSignal), headers: { 'If-Match': saved.configVersion } }]);
    expect(state.config).toEqual(temporary);
  });

  it.each(['CONFIG_VERSION_CONFLICT', 'CONFIG_PRECONDITION_REQUIRED'])('retains failed drafts, refreshes metadata and safely explains %s', async (code) => {
    setup(); await hydrated();
    fireEvent.change(keyInput(), { target: { value: 'retain-secret' } });
    fireEvent.change(modelInput(), { target: { value: 'retain-model' } });
    vi.mocked(customAiRequest).mockImplementation(async (_path, _body, options) => {
      if (options?.method === 'PUT') throw Object.assign(new Error('private detail'), { code });
      return { ok: true, config: { ...saved, configVersion: 'version_external' }, persistenceAvailable: true };
    });
    fireEvent.click(button('加密保存到账户'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/重新读取/);
    await waitFor(() => expect(state.savedConfig.configVersion).toBe('version_external'));
    expect(keyInput()).toHaveValue('retain-secret'); expect(modelInput()).toHaveValue('retain-model');
    expect(screen.queryByText(/账户配置已加密保存/)).not.toBeInTheDocument();
  });

  it('offers temporary use and deletion when encryption persistence is unavailable', async () => {
    available = false;
    setup(); await hydrated();
    expect(screen.getByText(/账户加密存储不可用/)).toHaveTextContent('仍可仅本次使用');
    expect(button('加密保存到账户')).toBeDisabled();
    expect(button('删除账户配置')).toBeEnabled();
    fireEvent.change(keyInput(), { target: { value: 'temporary-key' } });
    fireEvent.click(button('仅本次使用'));
    await waitFor(() => expect(state.config.apiKey).toBe('temporary-key'));
  });
});

describe('saved request ownership and uncertain writes', () => {
  it('hides previous owner on the first render and rejects a late metadata load', async () => {
    const old = deferred();
    vi.mocked(customAiRequest).mockReturnValueOnce(old.promise);
    const view = setup();
    auth.data = { user: { id: 'owner-b' } }; metadata = null;
    view.refresh();
    expect(state.config).toBeNull(); expect(state.savedConfig).toBeNull();
    await hydrated();
    await act(async () => old.resolve({ ok: true, config: saved, persistenceAvailable: true }));
    expect(state.config).toBeNull(); expect(keyInput()).toHaveValue('');
  });

  it('an old owner callback cannot change new owner state', async () => {
    const view = setup(); await hydrated();
    const oldUpdate = state.updateConfig;
    auth.data = { user: { id: 'owner-b' } }; metadata = null;
    view.refresh(); await hydrated();
    act(() => oldUpdate(temporary));
    expect(state.config).toBeNull();
  });

  it.each(['edit', 'unmount'])('reconciles aborted PUT after %s without resurrecting its response', async (action) => {
    const pending = deferred();
    const view = setup(); await hydrated();
    vi.mocked(customAiRequest).mockImplementation(async (_path, _body, options) => options?.method === 'PUT' ? pending.promise : { ok: true, config: metadata, persistenceAvailable: true });
    fireEvent.change(modelInput(), { target: { value: 'pending-model' } });
    fireEvent.click(button('加密保存到账户'));
    const signal = writes()[0][2].signal;
    if (action === 'edit') {
      fireEvent.change(modelInput(), { target: { value: 'newer-draft' } });
      fireEvent.change(keyInput(), { target: { value: 'newer-key' } });
    } else view.hide();
    expect(signal.aborted).toBe(true);
    metadata = { ...saved, model: 'actual-committed-model', configVersion: 'version_committed' };
    await act(async () => pending.resolve({ ok: true, config: { ...saved, model: 'stale-response-model', configVersion: 'version_stale' } }));
    await waitFor(() => expect(state.savedConfig.configVersion).toBe('version_committed'));
    expect(state.savedConfig.model).toBe('actual-committed-model');
    if (action === 'edit') { expect(modelInput()).toHaveValue('newer-draft'); expect(keyInput()).toHaveValue('newer-key'); }
  });

  it('refreshes metadata after an unconfirmed DELETE without claiming deletion or clearing the draft', async () => {
    setup(); await hydrated();
    fireEvent.change(keyInput(), { target: { value: 'retained-draft-key' } });
    vi.mocked(customAiRequest).mockImplementation(async (_path, _body, options) => {
      if (options?.method === 'DELETE') { metadata = null; throw Object.assign(new Error('private'), { code: 'REQUEST_ABORTED' }); }
      return { ok: true, config: metadata, persistenceAvailable: true };
    });
    fireEvent.click(button('删除账户配置'));
    expect(await screen.findByRole('alert')).toHaveTextContent('可能已经写入');
    await waitFor(() => expect(state.savedConfig).toBeNull());
    expect(keyInput()).toHaveValue('retained-draft-key');
    expect(screen.queryByText(/账户配置已删除/)).not.toBeInTheDocument();
  });

  it('cannot rehydrate or reconcile a late PUT after logout', async () => {
    const pending = deferred();
    const view = setup(); await hydrated();
    vi.mocked(customAiRequest).mockImplementation(async (_path, _body, options) => options?.method === 'PUT' ? pending.promise : { ok: true, config: metadata, persistenceAvailable: true });
    fireEvent.change(keyInput(), { target: { value: 'old-owner-secret' } });
    fireEvent.click(button('加密保存到账户'));
    auth.data = null; auth.status = 'unauthenticated';
    view.refresh();
    expect(state.config).toBeNull(); expect(keyInput()).toHaveValue('');
    const count = vi.mocked(customAiRequest).mock.calls.length;
    await act(async () => pending.resolve({ ok: true, config: saved }));
    expect(state.savedConfig).toBeNull(); expect(customAiRequest).toHaveBeenCalledTimes(count);
    expect(screen.queryByText(/账户配置已加密保存/)).not.toBeInTheDocument();
  });

  it('pagehide clears memory and cannot delete or rehydrate account metadata', async () => {
    setup(); await hydrated(); act(() => state.updateConfig(temporary));
    const count = vi.mocked(customAiRequest).mock.calls.length;
    act(() => window.dispatchEvent(new Event('pagehide')));
    expect(state.config).toBeNull(); expect(state.savedConfig).toBeNull();
    await act(async () => {});
    expect(customAiRequest).toHaveBeenCalledTimes(count);
    expect(writes()).toHaveLength(0);
  });
});
