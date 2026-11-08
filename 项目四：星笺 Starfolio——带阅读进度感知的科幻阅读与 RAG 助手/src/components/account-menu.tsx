'use client';

import { useState } from 'react';
import { authClient } from '@/lib/auth-client';

export function AccountMenu() {
  const { data: session, isPending, error } = authClient.useSession();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      const result = await authClient.signOut();
      if (result.error) setMessage('退出失败，请重试。');
      else window.location.reload();
    } catch { setMessage('网络连接失败，请重试。'); }
    finally { setBusy(false); }
  }

  return (
    <div className="account-menu">
      {isPending ? <span>正在确认账户…</span> : session ? <>
        <span className="account-name">{session.user.name}</span>
        <button type="button" className="quiet-button" onClick={signOut} disabled={busy}>{busy ? '正在退出…' : '退出'}</button>
      </> : <a className="quiet-button" href="/account" onClick={(event) => {
        event.preventDefault();
        window.location.assign(`/account?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
      }}>登录 / 注册</a>}
      {(message || error) && <span role="alert" className="error-text">{message || '账户状态获取失败，请刷新重试。'}</span>}
    </div>
  );
}
