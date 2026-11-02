import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { customAiRequest } from '../lib/customAiClient';

const emptyValue = {
  config: null, savedConfig: null, revision: 0, loading: false, error: null,
  persistenceAvailable: false, ownerToken: null,
  updateConfig: () => {}, clearConfig: () => {}, reloadSavedConfig: async () => null,
};
const CustomAiContext = createContext(emptyValue);

function identityOf(session, status) {
  if (status !== 'authenticated' || !session?.user) return null;
  return session.user.id || session.user.email || null;
}

// Only metadata is admitted, even if a server accidentally returns extra fields.
function savedMetadata(value) {
  if (!value || typeof value.baseUrl !== 'string' || typeof value.model !== 'string'
    || value.hasKey !== true || typeof value.configVersion !== 'string' || !value.configVersion) return null;
  return {
    baseUrl: value.baseUrl, model: value.model, hasKey: true,
    maskedKey: '••••••••', storage: 'account-encrypted',
    configVersion: value.configVersion, updatedAt: value.updatedAt,
  };
}
function savedSelection(saved) {
  return saved ? { baseUrl: saved.baseUrl, model: saved.model, hasKey: true, source: 'saved', configVersion: saved.configVersion } : null;
}

export function CustomAiProvider({ children }) {
  const { data: session, status } = useSession();
  const identity = identityOf(session, status);
  const [memoryEpoch, setMemoryEpoch] = useState(0);
  const ownerToken = useMemo(() => ({ identity }), [identity, memoryEpoch]);
  const currentOwner = useRef(ownerToken);
  currentOwner.current = ownerToken;
  const [state, setState] = useState({ owner: null, temporary: null, saved: null, revision: 0, loading: false, error: null, persistenceAvailable: false });
  const loadRef = useRef(null);
  const suspendedRef = useRef(false);
  const generationRef = useRef(0);
  useEffect(() => { suspendedRef.current = false; }, [identity]);
  const visible = state.owner === ownerToken && identity ? state : null;

  const reloadSavedConfig = useCallback(async () => {
    if (!identity || suspendedRef.current || currentOwner.current !== ownerToken) return null;
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    const generation = ++generationRef.current;
    const isCurrent = () => currentOwner.current === ownerToken && generation === generationRef.current && !controller.signal.aborted;
    setState((previous) => ({ ...(previous.owner === ownerToken ? previous : { temporary: null, saved: null, revision: previous.revision + 1, persistenceAvailable: false }), owner: ownerToken, loading: true, error: null }));
    try {
      const result = await customAiRequest('/api/custom-ai/config', undefined, { method: 'GET', signal: controller.signal });
      if (!isCurrent()) return null;
      if (result?.ok !== true || !Object.prototype.hasOwnProperty.call(result, 'config')) throw Object.assign(new Error('REQUEST_FAILED'), { code: 'REQUEST_FAILED' });
      const saved = savedMetadata(result.config);
      if (result.config !== null && !saved) throw Object.assign(new Error('REQUEST_FAILED'), { code: 'REQUEST_FAILED' });
      setState((previous) => {
        if (!isCurrent() || previous.owner !== ownerToken) return previous;
        const changed = previous.saved?.configVersion !== saved?.configVersion;
        // A saved-key temporary model selection expires with its referenced version.
        const temporary = previous.temporary?.source === 'saved' && previous.temporary.configVersion !== saved?.configVersion ? null : previous.temporary;
        return { ...previous, temporary, saved, loading: false, error: null, persistenceAvailable: result.persistenceAvailable === true, revision: previous.revision + (changed && !temporary ? 1 : 0) };
      });
      return saved;
    } catch (error) {
      if (isCurrent()) setState((previous) => previous.owner === ownerToken ? { ...previous, loading: false, error: error?.code || 'REQUEST_FAILED' } : previous);
      return null;
    } finally {
      if (loadRef.current === controller) loadRef.current = null;
    }
  }, [identity, ownerToken]);

  const updateConfig = useCallback((value) => {
    if (!identity || suspendedRef.current || currentOwner.current !== ownerToken || !value || typeof value !== 'object') return;
    const next = value.source === 'saved'
      ? savedSelection(savedMetadata(value))
      : { baseUrl: value.baseUrl, apiKey: value.apiKey, model: value.model };
    if (!next) return;
    setState((previous) => {
      if (currentOwner.current !== ownerToken) return previous;
      const own = previous.owner === ownerToken ? previous : { saved: null, persistenceAvailable: false, loading: false, error: null };
      if (next.source === 'saved' && (own.saved?.configVersion !== next.configVersion || own.saved?.baseUrl !== next.baseUrl)) return previous;
      return { ...own, owner: ownerToken, temporary: next, revision: previous.revision + 1 };
    });
  }, [identity, ownerToken]);

  const clearConfig = useCallback(() => {
    if (currentOwner.current !== ownerToken) return;
    setState((previous) => previous.owner === ownerToken ? { ...previous, temporary: null, revision: previous.revision + 1 } : previous);
  }, [ownerToken]);

  useEffect(() => {
    currentOwner.current = ownerToken;
    if (!identity) setState((previous) => ({ owner: null, temporary: null, saved: null, revision: previous.revision + 1, loading: false, error: null, persistenceAvailable: false }));
    else void reloadSavedConfig();
    return () => { ++generationRef.current; loadRef.current?.abort(); };
  }, [identity, ownerToken, reloadSavedConfig]);

  useEffect(() => {
    const clearMemory = () => {
      suspendedRef.current = true;
      ++generationRef.current;
      loadRef.current?.abort();
      // Revoke closures immediately, before React renders the cleared owner.
      currentOwner.current = null;
      setState((previous) => ({ owner: null, temporary: null, saved: null, revision: previous.revision + 1, loading: false, error: null, persistenceAvailable: false }));
      setMemoryEpoch((value) => value + 1);
    };
    window.addEventListener('pagehide', clearMemory);
    return () => {
      currentOwner.current = null;
      ++generationRef.current;
      loadRef.current?.abort();
      window.removeEventListener('pagehide', clearMemory);
    };
  }, []);

  const config = visible?.temporary || savedSelection(visible?.saved);
  const value = {
    config, savedConfig: visible?.saved || null,
    revision: visible?.revision ?? state.revision + 1,
    loading: visible?.loading ?? Boolean(identity && !suspendedRef.current), error: visible?.error || null,
    persistenceAvailable: visible?.persistenceAvailable === true,
    ownerToken, updateConfig, clearConfig, reloadSavedConfig,
  };
  return <CustomAiContext.Provider value={value}>{children}</CustomAiContext.Provider>;
}

export function useCustomAi() { return useContext(CustomAiContext); }
