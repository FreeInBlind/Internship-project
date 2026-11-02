import Header from './Header';
import { useLanguage } from './LanguageProvider';

export default function AppShell({ children }) {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-mint px-3 py-3 sm:px-6 sm:py-6">
      <div className="mx-auto min-h-[calc(100vh-1.5rem)] max-w-7xl overflow-hidden rounded-xl bg-paper shadow-soft sm:min-h-[calc(100vh-3rem)]">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-5 focus:top-5 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-5 focus:py-3 focus:text-white">{t.skipToContent}</a>
        <Header />
        <main id="main-content" tabIndex={-1} className="px-5 py-10 sm:px-10 lg:px-16">{children}</main>
        <footer className="border-t border-ink/10 px-5 py-5 text-xs text-ink/50 sm:px-10 lg:px-16">{t.footer}</footer>
      </div>
    </div>
  );
}
