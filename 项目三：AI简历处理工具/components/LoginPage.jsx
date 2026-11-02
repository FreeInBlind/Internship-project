import React, { useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { signIn } from 'next-auth/react';
import PageHead from './PageHead';
import { useLanguage } from './LanguageProvider';

function safeCallback(value) {
  return typeof value === 'string' && /^\/(?:upload|history|settings|feedback\/[^/?#]+)(?:\?[^#]*)?$/.test(value) && !value.includes('\\') ? value : '/upload';
}

export default function LoginPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [registering, setRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitLockRef = useRef(false);

  async function submit(event) {
    event.preventDefault();
    if (submitLockRef.current || busy) return;
    setMessage('');
    setSuccess(false);
    if (registering && password !== confirmation) return setMessage('passwordMismatch');
    if (registering && ([...password].length < 12 || [...password].length > 72 || new TextEncoder().encode(password).length > 72)) return setMessage('passwordLength');
    submitLockRef.current = true;
    setBusy(true);
    try {
      if (registering) {
        const response = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        let result;
        try { result = await response.json(); } catch { return setMessage('registerFailed'); }
        if (!response.ok || result?.ok !== true) return setMessage('registerFailed');
        setRegistering(false);
        setPassword('');
        setConfirmation('');
        setSuccess(true);
        setMessage('registered');
      } else {
        const result = await signIn('credentials', { email, password, redirect: false });
        if (!result?.ok || result.error) return setMessage('authFailed');
        await router.push(safeCallback(router.query.callbackUrl));
      }
    } catch {
      setMessage('networkError');
    } finally {
      submitLockRef.current = false;
      setBusy(false);
    }
  }

  function switchMode() {
    setRegistering(!registering);
    setMessage('');
    setSuccess(false);
    setPassword('');
    setConfirmation('');
  }

  const inputClass = 'mt-2 w-full rounded-md border border-ink/25 bg-white px-4 py-3 text-ink focus:outline focus:outline-2 focus:outline-orange';
  return (
    <>
      <PageHead page="login" />
      <div className="mx-auto max-w-lg space-y-7">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange">{t.accountLabel}</p><h1 className="mt-3 text-4xl font-black tracking-tight">{registering ? t.registerTitle : t.loginTitle}</h1><p className="mt-4 text-lg leading-8 text-ink/65">{t.loginBody}</p></div>
        <form onSubmit={submit} aria-busy={busy} className="space-y-5">
          <label className="block text-sm font-semibold">{t.email}<input className={inputClass} type="email" name="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="block text-sm font-semibold">{t.password}<input className={inputClass} type="password" name="password" autoComplete={registering ? 'new-password' : 'current-password'} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          {registering && <><p className="text-sm text-ink/65">{t.passwordHint}</p><label className="block text-sm font-semibold">{t.confirmPassword}<input className={inputClass} type="password" name="confirmPassword" autoComplete="new-password" maxLength={72} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label></>}
          {message && <p role={success ? 'status' : 'alert'} className={success ? 'text-sm text-ink' : 'text-sm text-red-700'}>{t[message]}</p>}
          <button type="submit" disabled={busy} className="rounded-md bg-ink px-5 py-3 text-sm font-semibold text-white hover:bg-orange disabled:opacity-50">{busy ? t.working : registering ? t.registerSubmit : t.loginSubmit}</button>
        </form>
        <button type="button" onClick={switchMode} disabled={busy} className="text-sm font-semibold underline underline-offset-4 disabled:opacity-50">{registering ? t.haveAccount : t.needAccount}</button>
      </div>
    </>
  );
}
