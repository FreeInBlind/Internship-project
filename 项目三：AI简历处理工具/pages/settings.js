import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '../components/Button';
import PageHead from '../components/PageHead';
import { useLanguage } from '../components/LanguageProvider';
import { useCustomAi } from '../components/CustomAiProvider';
import { customAiRequest, validateCustomAiBaseUrl } from '../lib/customAiClient';

export { requireSession as getServerSideProps } from '../lib/requireSession';

const copy = {
  zh: {
    pageBody: '管理自定义 AI 的临时使用与账户加密存储。',
    section: '自定义 AI',
    intro: '配置兼容 OpenAI Chat Completions 的服务。选择仅本次使用，或加密保存到账户以便下次登录恢复。',
    accountSave: '加密保存到账户', accountDelete: '删除账户配置',
    accountSaved: '账户配置已加密保存。密钥输入已清除。', accountDeleted: '账户配置已删除，临时配置不受影响。',
    accountStatus: '账户已保存配置，密钥不会返回浏览器。', loading: '正在读取账户配置…',
    storageUnavailable: '账户加密存储不可用（服务端主密钥未配置或不可用）；仍可仅本次使用。',
    metadataError: '无法读取账户配置。请手动重新读取后再保存到账户，临时使用仍可用。', reload: '重新读取账户配置',
    versionConflict: '账户配置已发生变化，请重新读取并核对后再操作。本次输入已保留。',
    precondition: '缺少账户配置版本，请重新读取后再操作。本次输入已保留。',
    uncertain: '未能确认账户操作结果，可能已经写入。正在重新读取账户状态，请核对后再手动操作。',
    savedActive: '当前使用账户配置；刷新后可恢复。临时选择优先于账户配置。',
    baseUrl: 'API 根地址',
    baseUrlPlaceholder: 'https://api.provider.com/v1',
    baseUrlHint: '支持 HTTPS 公网域名及 /v1、/api/v1 等普通路径前缀，也可不带路径。不会自动添加 /v1；服务端会在根地址后追加 /chat/completions。请勿填写以 /chat/completions、/completions 或 /responses 结尾的完整端点，也不要包含账号密码、查询参数、片段、百分号编码或点路径段。仅允许默认 HTTPS 端口；IP 地址、本机、私网及保留域名或解析地址会被拒绝。',
    apiKey: 'API 密钥',
    apiKeyHint: '仅本次使用的密钥暂存在当前标签页的应用内存中，不写入浏览器存储或数据库。加密保存到账户会将密钥加密写入服务器数据库，浏览器只读取元数据。保存校验会将密钥提交到本站服务器；测试和分析经本站服务器代理发送至指定供应商。已有配置且地址未变时可留空复用原密钥；改用其他 API 根地址需重新输入。',
    model: '模型',
    modelPlaceholder: '例如 gpt-4o-mini',
    save: '仅本次使用',
    replace: '仅本次使用',
    clear: '清除临时配置',
    test: '测试连接',
    testWarning: '测试不等于保存。点击测试会发送一次不含简历的上游请求，供应商可能计费，不会自动重试。测试成功后仍需点击“仅本次使用”或“加密保存到账户”。',
    cancelHint: '修改输入或清除配置会取消本页等待，但无法保证供应商停止处理或计费。',
    temporary: '临时存储说明',
    temporaryBody: '配置保存在当前标签页的应用内存中，站内页面切换时仍可使用。刷新页面、关闭标签页、退出登录、切换账号或手动清除后会丢失，需要重新配置。',
    saved: '临时配置已保存并启用，可前往工作台使用。密钥输入已清除。',
    replaced: '临时配置已替换并启用，可前往工作台使用。密钥输入已清除。',
    tested: '连接测试成功，但本次输入尚未保存。请点击“仅本次使用”或“加密保存到账户”以启用；已有配置保持不变。',
    cleared: '临时配置已清除。',
    missing: '请填写 API 根地址、API 密钥和模型。',
    networkError: '无法完成请求，请检查网络并稍后手动重试。',
    missingKey: '改用其他 API 根地址前，请重新输入 API 密钥。',
    invalidUrl: 'API 根地址格式不受支持。请使用 HTTPS 公网域名，可带 /v1 等普通路径前缀，但不要填写完整接口端点；具体限制见地址说明。',
    invalidKey: 'API 密钥格式不正确。请使用 1–4096 个不含空格的可打印 ASCII 字符，且不要将密钥填入地址或模型。',
    invalidModel: '模型格式不正确。请填写供应商的模型标识，使用 1–200 个不含空格的可打印 ASCII 字符。',
    invalidInput: '配置格式或长度不符合要求，请检查输入后重试。',
    insecureTransport: '本站当前连接不安全。请通过 HTTPS 访问本站后重试；本机开发地址可使用 HTTP。',
    unauthorized: '登录状态已失效，请重新登录后配置。',
    forbidden: '本站拒绝了此请求，请从本站页面重新操作。',
    providerAuth: '供应商拒绝认证，请检查密钥及该密钥的模型访问权限。',
    rateLimited: '请求过于频繁或供应商额度不足，请检查额度并稍后手动重试。',
    inProgress: '已有请求正在处理，请等待完成后再手动操作。',
    alreadyHandled: '此测试请求已处理，不会自动重试。如需再次测试，请主动点击。',
    capacity: '当前服务暂时繁忙，请稍后手动重试。',
    unsafeAddress: '供应商地址未通过公网安全校验，请检查域名及其解析地址，勿使用本机或私网地址。',
    dnsError: '无法解析供应商域名，请检查 API 根地址及域名配置。',
    timeout: '供应商响应超时，不会自动重试。请稍后手动操作；供应商仍可能计费。',
    incompatible: '供应商接口或响应不兼容，请检查 API 根地址、模型及 Chat Completions 支持情况。',
    providerUnavailable: '供应商暂时不可用，请检查服务状态并稍后手动重试。',
    cancelled: '请求已中止，未应用本次输入；供应商仍可能计费。',
    saving: '正在校验并保存…',
    testing: '正在测试连接…',
    notConfigured: '尚未配置临时 AI。',
    configured: '当前标签页已有临时配置，站内页面切换时仍可使用。',
    workspace: '前往工作台',
    accessibility: '自定义 AI 配置',
  },
  en: {
    pageBody: 'Manage temporary custom AI and encrypted account storage.',
    section: 'Custom AI',
    intro: 'Configure an OpenAI Chat Completions-compatible service. Use it temporarily or save it encrypted to your account for future sessions.',
    accountSave: 'Save encrypted to account', accountDelete: 'Delete account configuration',
    accountSaved: 'Account configuration saved encrypted. The key input was cleared.', accountDeleted: 'Account configuration deleted. Temporary configuration is unchanged.',
    accountStatus: 'Account configuration is saved. Its key is never returned to the browser.', loading: 'Loading account configuration…',
    storageUnavailable: 'Encrypted account storage is unavailable (the server master key is missing or unavailable). Temporary use is still available.',
    metadataError: 'Account configuration could not be loaded. Reload it before saving to your account; temporary use is still available.', reload: 'Reload account configuration',
    versionConflict: 'Account configuration changed. Reload and review it before continuing. Your input was retained.',
    precondition: 'The account configuration version is missing. Reload before continuing. Your input was retained.',
    uncertain: 'The account operation could not be confirmed and may have been written. Account metadata is being reloaded; review it before trying manually again.',
    savedActive: 'Account configuration is active and can be restored after refresh. Temporary selections take priority.',
    baseUrl: 'API root URL',
    baseUrlPlaceholder: 'https://api.provider.com/v1',
    baseUrlHint: 'Use an HTTPS public domain, optionally with an ordinary path prefix such as /v1 or /api/v1. /v1 is not added automatically; the server appends /chat/completions. Do not enter a full endpoint ending in /chat/completions, /completions, or /responses, credentials, query parameters, fragments, percent-encoded paths, or dot segments. Only the default HTTPS port is allowed. IP literals, local, private, and reserved domains or resolved addresses are rejected.',
    apiKey: 'API key',
    apiKeyHint: 'A temporary key is held in this tab’s application memory, not browser storage or a database. Saving to your account encrypts the key in the server database; the browser only receives metadata. Saving sends the key to this site’s server for validation; tests and analysis are proxied through this site’s server to your chosen provider. Leave blank to reuse a key for the same URL; a different API root requires a new key.',
    model: 'Model',
    modelPlaceholder: 'For example, gpt-4o-mini',
    save: 'Use temporarily',
    replace: 'Use temporarily',
    clear: 'Clear temporary configuration',
    test: 'Test connection',
    testWarning: 'Testing does not save configuration. Clicking Test sends one upstream request without resume content, may incur provider charges, and is not automatically retried. After testing, click “Use temporarily” or “Save encrypted to account” to apply your input.',
    cancelHint: 'Editing inputs or clearing configuration cancels this page’s wait, but cannot guarantee that the provider stops processing or charging.',
    temporary: 'Temporary storage',
    temporaryBody: 'Configuration lives in this tab’s application memory and remains available during in-app navigation. Refreshing, closing the tab, logging out, switching accounts, or clearing it removes the configuration; you must configure it again.',
    saved: 'Temporary configuration saved and activated. Continue to the workspace to use it. The key input was cleared.',
    replaced: 'Temporary configuration replaced and activated. Continue to the workspace to use it. The key input was cleared.',
    tested: 'Connection test succeeded, but this input has not been saved. Click “Use temporarily” or “Save encrypted to account” to apply it; any active configuration is unchanged.',
    cleared: 'Temporary configuration cleared.',
    missing: 'Enter an API root URL, API key, and model.',
    networkError: 'The request could not be completed. Check your connection and retry manually later.',
    missingKey: 'Enter a new API key before using a different API root URL.',
    invalidUrl: 'Unsupported API root URL. Use an HTTPS public domain, optionally with an ordinary path prefix such as /v1, not a full endpoint. See the URL guidance for restrictions.',
    invalidKey: 'Invalid API key format. Use 1–4096 printable ASCII characters without spaces, and do not include the key in the URL or model.',
    invalidModel: 'Invalid model format. Enter the provider’s model ID using 1–200 printable ASCII characters without spaces.',
    invalidInput: 'The configuration format or length is invalid. Check your input and try again.',
    insecureTransport: 'This site’s connection is not secure. Open this site over HTTPS and try again; HTTP is allowed for local development.',
    unauthorized: 'Your login has expired. Log in again before configuring AI.',
    forbidden: 'This site rejected the request. Start again from this site’s page.',
    providerAuth: 'The provider rejected authentication. Check the key and its model permissions.',
    rateLimited: 'Requests are rate-limited or the provider quota is exhausted. Check your quota and retry manually later.',
    inProgress: 'A request is already being processed. Wait for it to finish before trying manually again.',
    alreadyHandled: 'This test request has already been handled and will not be automatically retried. Click Test to start another test.',
    capacity: 'The service is temporarily busy. Retry manually later.',
    unsafeAddress: 'The provider address failed public-network safety checks. Check the domain and its resolved addresses; do not use local or private targets.',
    dnsError: 'The provider domain could not be resolved. Check the API root URL and domain configuration.',
    timeout: 'The provider timed out. No automatic retry is made. Retry manually later; provider charges may still apply.',
    incompatible: 'The provider API or response is incompatible. Check the API root URL, model, and Chat Completions support.',
    providerUnavailable: 'The provider is temporarily unavailable. Check its status and retry manually later.',
    cancelled: 'The request was aborted and this input was not applied. Provider charges may still apply.',
    saving: 'Validating and saving…',
    testing: 'Testing connection…',
    notConfigured: 'No temporary AI is configured.',
    configured: 'A temporary configuration is active in this tab and remains available across in-app pages.',
    workspace: 'Go to workspace',
    accessibility: 'Custom AI configuration',
  },
};

function safeErrorMessage(error, text) {
  switch (error?.code) {
    case 'CONFIG_VERSION_CONFLICT': return text.versionConflict;
    case 'CONFIG_PRECONDITION_REQUIRED':
    case 'INVALID_CONFIG_VERSION': return text.precondition;
    case 'API_KEY_REQUIRED': return text.missingKey;
    case 'AI_CONFIG_STORAGE_UNAVAILABLE':
    case 'AI_CONFIG_ENCRYPTION_UNAVAILABLE':
    case 'AI_CONFIG_ENCRYPTION_FAILED':
    case 'AI_CONFIG_DECRYPTION_FAILED':
    case 'PERSISTENCE_UNAVAILABLE':
    case 'CONFIG_STORAGE_UNAVAILABLE':
    case 'CONFIG_DECRYPTION_FAILED': return text.storageUnavailable;
    case 'CONFIG_NOT_FOUND': return text.versionConflict;
    case 'INVALID_BASE_URL': return text.invalidUrl;
    case 'INSECURE_TRANSPORT': return text.insecureTransport;
    case 'CONFIG_REQUIRED': return text.missingKey;
    case 'MISSING_CONFIG': return text.missing;
    case 'INVALID_API_KEY': return text.invalidKey;
    case 'INVALID_MODEL': return text.invalidModel;
    case 'INVALID_INPUT':
    case 'INVALID_REQUEST_BODY':
    case 'INPUT_TOO_LARGE': return text.invalidInput;
    case 'UNAUTHORIZED': return text.unauthorized;
    case 'FORBIDDEN': return text.forbidden;
    case 'UPSTREAM_AUTH':
    case 'UPSTREAM_UNAUTHORIZED': return text.providerAuth;
    case 'RATE_LIMITED':
    case 'UPSTREAM_RATE_LIMIT': return text.rateLimited;
    case 'REQUEST_IN_PROGRESS': return text.inProgress;
    case 'REQUEST_ALREADY_HANDLED': return text.alreadyHandled;
    case 'REQUEST_CAPACITY': return text.capacity;
    case 'UNSAFE_UPSTREAM_ADDRESS': return text.unsafeAddress;
    case 'UPSTREAM_DNS': return text.dnsError;
    case 'UPSTREAM_TIMEOUT': return text.timeout;
    case 'UPSTREAM_REDIRECT':
    case 'UPSTREAM_REJECTED':
    case 'INVALID_UPSTREAM_RESPONSE':
    case 'INVALID_REPORT':
    case 'UPSTREAM_TRUNCATED': return text.incompatible;
    case 'UPSTREAM_UNAVAILABLE': return text.providerUnavailable;
    case 'UPSTREAM_ABORTED':
    case 'REQUEST_ABORTED': return text.cancelled;
    default: return text.networkError;
  }
}

export default function SettingsPage() {
  const { t, language } = useLanguage();
  const text = copy[language] || copy.zh;
  const { config, savedConfig, revision, ownerToken, updateConfig, clearConfig, loading, error: metadataError, persistenceAvailable, reloadSavedConfig } = useCustomAi();
  const [draftState, setDraft] = useState({ baseUrl: '', apiKey: '', model: '' });
  const [draftOwner, setDraftOwner] = useState(ownerToken);
  const draft = draftOwner === ownerToken ? draftState : { baseUrl: '', apiKey: '', model: '' };
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(null);
  const requestRef = useRef(null);
  const ownerRef = useRef(ownerToken);
  ownerRef.current = ownerToken;
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  const dirtyRef = useRef(false);
  const previousOwner = useRef(ownerToken);
  const reloadRef = useRef(reloadSavedConfig);
  reloadRef.current = reloadSavedConfig;

  const invalidatePending = useCallback(() => {
    const request = requestRef.current;
    requestRef.current = null;
    request?.controller.abort();
    if (request?.mutation && request.sent && request.owner === ownerRef.current) {
      // An abort only stops waiting. Reconcile metadata without replaying a write.
      void reloadRef.current();
    }
    setBusy(null);
  }, []);

  useEffect(() => {
    const changedOwner = previousOwner.current !== ownerToken;
    previousOwner.current = ownerToken;
    setDraftOwner(ownerToken);
    const hadRequest = Boolean(requestRef.current);
    invalidatePending();
    if (changedOwner || !dirtyRef.current || hadRequest) {
      dirtyRef.current = false;
      setDraft({ baseUrl: config?.baseUrl || '', apiKey: '', model: config?.model || '' });
    }
    if (changedOwner || hadRequest) setNotice(null);
  }, [ownerToken, config?.baseUrl, config?.model, revision, invalidatePending]);

  useEffect(() => () => {
    const request = requestRef.current;
    requestRef.current = null;
    request?.controller.abort();
    if (request?.mutation && request.sent && request.owner === ownerRef.current) void reloadRef.current();
  }, []);

  const changeDraft = (field, value) => {
    dirtyRef.current = true;
    invalidatePending();
    setNotice(null);
    setDraft((current) => ({ ...current, [field]: value, ...(field === 'baseUrl' ? { apiKey: '' } : {}) }));
  };

  const runRequest = async (operation) => {
    if (requestRef.current) return;
    const mutation = operation === 'account' || operation === 'delete';
    const request = { controller: new AbortController(), revision: revisionRef.current, owner: ownerToken, mutation, sent: false };
    requestRef.current = request;
    setBusy(operation);
    setNotice(null);
    const isCurrent = () => requestRef.current === request && request.revision === revisionRef.current && request.owner === ownerRef.current;
    const sameOwner = () => request.owner === ownerRef.current;
    const baseUrl = draft.baseUrl.trim();
    const model = draft.model.trim();
    const reusableTemporary = config?.source !== 'saved' && config?.baseUrl === baseUrl ? config?.apiKey : '';
    const apiKey = draft.apiKey || reusableTemporary || '';
    const reusableSaved = savedConfig?.baseUrl === baseUrl && savedConfig?.hasKey;
    const savedSource = !apiKey && reusableSaved;
    try {
      let body;
      let path = '/api/custom-ai/config';
      let options = { signal: request.controller.signal };
      if (operation === 'delete') {
        if (!savedConfig?.configVersion) throw Object.assign(new Error('CONFIG_PRECONDITION_REQUIRED'), { code: 'CONFIG_PRECONDITION_REQUIRED' });
        options = { ...options, method: 'DELETE', headers: { 'If-Match': savedConfig.configVersion } };
      } else {
        if (!baseUrl || !model || (!apiKey && !savedSource)) throw Object.assign(new Error('MISSING_CONFIG'), { code: (config || savedConfig) && !apiKey ? 'CONFIG_REQUIRED' : 'MISSING_CONFIG' });
        const urlError = validateCustomAiBaseUrl(baseUrl);
        if (urlError) throw Object.assign(new Error(urlError), { code: urlError });
        if (!/^[\x21-\x7e]{1,200}$/.test(model)) throw Object.assign(new Error('INVALID_MODEL'), { code: 'INVALID_MODEL' });
        if (apiKey && (!/^[\x21-\x7e]{1,4096}$/.test(apiKey) || baseUrl.includes(apiKey) || model.includes(apiKey))) throw Object.assign(new Error('INVALID_API_KEY'), { code: 'INVALID_API_KEY' });
        if (operation === 'save' && savedSource) {
          updateConfig({ ...savedConfig, source: 'saved', model });
          dirtyRef.current = false;
          setDraft((current) => ({ ...current, apiKey: '' }));
          setNotice({ type: 'success', message: text.saved });
          return;
        }
        if (operation === 'account') {
          if (!persistenceAvailable || loading || metadataError) throw Object.assign(new Error('PERSISTENCE_UNAVAILABLE'), { code: 'PERSISTENCE_UNAVAILABLE' });
          body = { config: { baseUrl, model, ...(apiKey ? { apiKey } : {}) } };
          options = { ...options, method: 'PUT', headers: savedConfig ? { 'If-Match': savedConfig.configVersion } : { 'If-None-Match': '*' } };
        } else if (operation === 'test') {
          path = '/api/custom-ai/test';
          body = { ...(savedSource ? { source: 'saved', configVersion: savedConfig.configVersion, model } : { config: { baseUrl, apiKey, model } }), requestId: crypto.randomUUID() };
        } else body = { config: { baseUrl, apiKey, model } };
      }
      request.sent = true;
      const response = await customAiRequest(path, body, options);
      if (!isCurrent()) {
        if (mutation && sameOwner()) void reloadSavedConfig();
        return;
      }
      if (!response?.ok) throw Object.assign(new Error('REQUEST_FAILED'), { code: 'REQUEST_FAILED' });
      if (mutation) {
        // Never apply write responses directly: only a fresh, owner-scoped GET wins.
        requestRef.current = null;
        setBusy(null);
        setDraft((current) => ({ ...current, apiKey: '' }));
        setNotice({ type: 'success', message: operation === 'delete' ? text.accountDeleted : text.accountSaved });
        await reloadSavedConfig();
      } else if (operation === 'save') {
        dirtyRef.current = false;
        updateConfig({ baseUrl, apiKey, model });
        setDraft((current) => ({ ...current, apiKey: '' }));
        setNotice({ type: 'success', message: config ? text.replaced : text.saved });
      } else setNotice({ type: 'success', message: `${text.tested} ${model}` });
    } catch (error) {
      if (isCurrent()) {
        const uncertain = mutation && request.sent && ['REQUEST_ABORTED', 'REQUEST_FAILED'].includes(error?.code);
        setNotice({ type: 'error', message: uncertain ? text.uncertain : safeErrorMessage(error, text) });
        if (mutation && request.sent) {
          requestRef.current = null;
          setBusy(null);
          void reloadSavedConfig();
        }
      } else if (mutation && request.sent && sameOwner()) void reloadSavedConfig();
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setBusy(null);
      }
    }
  };

  const submit = (event) => {
    event.preventDefault();
    return runRequest('save');
  };

  const clear = () => {
    invalidatePending();
    clearConfig();
    dirtyRef.current = false;
    setDraft({ baseUrl: savedConfig?.baseUrl || '', apiKey: '', model: savedConfig?.model || '' });
    setNotice({ type: 'success', message: text.cleared });
  };

  const configured = Boolean(config);
  const buttonText = configured ? text.replace : text.save;
  return <>
    <PageHead page="settings" />
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-4xl font-black tracking-tight">{t.settingsTitle}</h1>
        <p className="mt-4 text-lg leading-8 text-ink/65">{text.pageBody}</p>
      </div>
      <section className="rounded-lg border border-ink/15 bg-white p-6 shadow-sm" aria-labelledby="custom-ai-heading">
        <div className="mb-6">
          <h2 id="custom-ai-heading" className="text-2xl font-bold">{text.section}</h2>
          <p className="mt-2 text-sm leading-6 text-ink/65">{text.intro}</p>
          {loading && <p className="mt-2 text-sm">{text.loading}</p>}
          {!loading && !persistenceAvailable && <p className="mt-2 text-sm text-amber-800">{text.storageUnavailable}</p>}
          {metadataError && <p className="mt-2 text-sm text-red-700">{text.metadataError}</p>}
          {savedConfig && <p className="mt-2 text-sm">{text.accountStatus} {savedConfig.baseUrl} · {savedConfig.model} · {savedConfig.maskedKey}</p>}
          <button type="button" className="mt-2 text-sm underline" onClick={() => reloadSavedConfig()} disabled={loading || Boolean(busy)}>{text.reload}</button>
        </div>
        <form onSubmit={submit} className="space-y-5" aria-label={text.accessibility} aria-busy={Boolean(busy)}>
          <div>
            <label className="block text-sm font-semibold" htmlFor="custom-ai-base-url">{text.baseUrl}</label>
            <input id="custom-ai-base-url" className="mt-2 w-full rounded-md border border-ink/20 bg-paper px-3 py-3" type="url" value={draft.baseUrl} placeholder={text.baseUrlPlaceholder} onChange={(event) => changeDraft('baseUrl', event.target.value)} autoComplete="url" maxLength={2048} aria-describedby="custom-ai-base-url-hint" required />
            <p id="custom-ai-base-url-hint" className="mt-2 text-xs leading-5 text-ink/60">{text.baseUrlHint}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold" htmlFor="custom-ai-api-key">{text.apiKey}</label>
            <input id="custom-ai-api-key" className="mt-2 w-full rounded-md border border-ink/20 bg-paper px-3 py-3" type="password" value={draft.apiKey} onChange={(event) => changeDraft('apiKey', event.target.value)} autoComplete="off" spellCheck="false" maxLength={4096} aria-describedby="custom-ai-api-key-hint" />
            <p id="custom-ai-api-key-hint" className="mt-2 text-xs leading-5 text-ink/60">{text.apiKeyHint}</p>
          </div>
          <div>
            <label className="block text-sm font-semibold" htmlFor="custom-ai-model">{text.model}</label>
            <input id="custom-ai-model" className="mt-2 w-full rounded-md border border-ink/20 bg-paper px-3 py-3" type="text" value={draft.model} placeholder={text.modelPlaceholder} onChange={(event) => changeDraft('model', event.target.value)} autoComplete="off" maxLength={200} required />
          </div>
          <p className="text-xs leading-5 text-ink/60">{text.testWarning}</p>
          <p className="text-xs leading-5 text-ink/60">{text.cancelHint}</p>
          {notice && draftOwner === ownerToken && <p className={`text-sm ${notice.type === 'error' ? 'text-red-700' : 'text-green-700'}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange" disabled={Boolean(busy)}>{busy === 'save' ? text.saving : buttonText}</button>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/20 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-ink hover:text-white" onClick={() => runRequest('account')} disabled={Boolean(busy) || loading || !persistenceAvailable || Boolean(metadataError)}>{busy === 'account' ? text.saving : text.accountSave}</button>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/20 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:bg-ink hover:text-white" onClick={() => runRequest('test')} disabled={Boolean(busy)}>{busy === 'test' ? text.testing : text.test}</button>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-700/30 px-5 py-3 text-sm font-semibold text-red-700" onClick={() => runRequest('delete')} disabled={Boolean(busy) || loading || !savedConfig}>{text.accountDelete}</button>
            <button type="button" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-700/30 px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50" onClick={clear}>{text.clear}</button>
            {configured && <Button href="/upload">{text.workspace}</Button>}
          </div>
        </form>
      </section>
      <aside className="rounded-lg border border-orange/40 bg-orange/10 p-5" aria-label={text.temporary}>
        <p className="font-semibold">{text.temporary}</p>
        <p className="mt-2 text-sm leading-6 text-ink/70">{text.temporaryBody}</p>
        <p className="mt-3 text-sm font-semibold">{config?.source === 'saved' ? text.savedActive : configured ? text.configured : text.notConfigured}{config && ` ${config.baseUrl} · ${config.model}`}</p>
      </aside>
      <Button href="/">{t.backHome}</Button>
    </div>
  </>;
}
