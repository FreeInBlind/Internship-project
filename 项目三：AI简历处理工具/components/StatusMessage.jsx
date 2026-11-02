import { useLanguage } from './LanguageProvider';

export default function StatusMessage() {
  const { t } = useLanguage();
  return (
    <div className="flex items-start gap-3 rounded-lg border border-orange/40 bg-orange/10 p-4 text-sm" role="status">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-orange" aria-hidden="true" />
      <div>
        <p className="font-semibold">{t.statusLabel}</p>
        <p className="mt-1 text-ink/70">{t.unavailable}</p>
      </div>
    </div>
  );
}
