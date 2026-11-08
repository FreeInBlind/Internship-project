'use client';

import { useState, type FormEvent } from 'react';
import { authClient } from '@/lib/auth-client';

export default function AccountPage() {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get('email')).trim();
    const password = String(fields.get('password'));
    try {
      const result = register
        ? await authClient.signUp.email({ name: String(fields.get('name')).trim(), email, password })
        : await authClient.signIn.email({ email, password });
      if (result.error) {
        const code = result.error.code;
        setError(code === 'INVALID_EMAIL_OR_PASSWORD' ? '邮箱或密码不正确。' : code?.includes('USER_ALREADY_EXISTS') ? '这个邮箱已注册，请直接登录。' : result.error.status === 429 ? '操作太频繁，请稍后再试。' : '操作失败，请检查输入后重试。');
      } else {
        const target = new URLSearchParams(window.location.search).get('returnTo') || '/';
        const url = new URL(target, window.location.origin);
        window.location.assign(url.origin === window.location.origin && !url.pathname.startsWith('/account') ? url.pathname + url.search + url.hash : '/');
      }
    } catch {
      setError('网络连接失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  return <main className="account-page">
    <a className="brand" href="/">✦ 星笺 <span>STARFOLIO</span></a>
    <section className="account-card">
      <span className="eyebrow">YOUR READING SPACE</span>
      <h1>{register ? '让阅读有迹可循' : '回到你的阅读时刻'}</h1>
      <p className="muted">登录后使用云端进度与书签。游客记录保留在本机，暂不自动合并至账户。</p>
      <div className="segmented" aria-label="账户操作">
        <button type="button" aria-pressed={!register} onClick={() => { setRegister(false); setError(''); }}>登录</button>
        <button type="button" aria-pressed={register} onClick={() => { setRegister(true); setError(''); }}>注册</button>
      </div>
      <form onSubmit={submit} className="account-form">
        {register && <label>昵称<input name="name" autoComplete="nickname" required maxLength={60} /></label>}
        <label>邮箱<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
        <label>密码<input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={8} maxLength={128} required /></label>
        {register && <small className="muted">密码 8–128 字符。当前未提供邮箱验证和邮件找回密码。</small>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? '正在处理…' : register ? '创建账户并登录' : '登录'}</button>
      </form>
      <a className="back-link" href="/">暂时以游客身份阅读 →</a>
    </section>
  </main>;
}
