import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/compat/router';
import { useLanguage } from './LanguageProvider';
import { signOut, useSession } from 'next-auth/react';

export default function Header() {
  const { t, toggleLanguage } = useLanguage();
  const { status } = useSession();
  // Pages Router context is optional so the shell also works without a router
  // (for example, standalone previews and the existing navigation tests).
  const router = useRouter();
  const pathname = router?.pathname === '/' ? '/' : (router?.pathname || '').split(/[?#]/)[0].replace(/\/$/, '');
  const links = [
    ['/', t.navHome],
    ['/upload', t.navWorkspace],
    ['/history', t.navHistory],
    ['/settings', t.navSettings],
  ];
  return (
    <header className="flex flex-col gap-5 border-b border-ink/10 px-5 py-5 sm:px-10 lg:flex-row lg:items-center lg:justify-between lg:px-16">
      <div className="flex items-center justify-between gap-4">
        <Link href="/" className="text-lg font-black tracking-tight">{t.brand}</Link>
        <button type="button" onClick={toggleLanguage} className="min-h-11 rounded-md border border-ink/20 px-3 py-2 text-xs font-semibold hover:bg-ink hover:text-white lg:hidden">{t.language}</button>
      </div>
      <nav aria-label={t.navLabel} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-semibold sm:gap-x-5">
        {links.map(([href, label]) => {
          const active = pathname === href;
          return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={`inline-flex min-h-11 items-center border-b-2 py-2 ${active ? 'border-orange text-ink' : 'border-transparent text-ink/65 hover:text-ink'}`}>{label}</Link>;
        })}
        {status === 'authenticated' && <button type="button" onClick={() => signOut({ callbackUrl: '/' })} className="min-h-11 rounded-md bg-ink px-4 py-2 text-white hover:bg-orange">{t.navLogout}</button>}
        {status === 'unauthenticated' && <Link href="/login" aria-current={pathname === '/login' ? 'page' : undefined} className="inline-flex min-h-11 items-center rounded-md bg-ink px-4 py-2 text-white hover:bg-orange">{t.navLogin}</Link>}
        {status === 'loading' && <span role="status" className="inline-flex min-h-11 items-center text-xs text-ink/65">{t.navLoading}</span>}
        <button type="button" onClick={toggleLanguage} className="hidden min-h-11 rounded-md border border-ink/20 px-3 py-2 text-xs font-semibold hover:bg-ink hover:text-white lg:inline-flex">{t.language}</button>
      </nav>
    </header>
  );
}
