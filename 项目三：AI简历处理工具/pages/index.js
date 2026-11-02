import Button from '../components/Button';
import PageHead from '../components/PageHead';
import Card from '../components/Card';
import StepIndicator from '../components/StepIndicator';
import { useLanguage } from '../components/LanguageProvider';

export default function Home() {
  const { t } = useLanguage();
  return (
    <>
      <PageHead page="home" />
      <div className="space-y-16">
        <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]" aria-labelledby="home-title">
          <div>
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.18em] text-orange">{t.heroEyebrow}</p>
            <h1 id="home-title" className="max-w-3xl text-3xl font-black leading-tight tracking-tight [text-wrap:balance] sm:text-6xl">{t.heroTitle}</h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-ink/65 sm:text-lg">{t.heroBody}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button href="/upload">{t.startWork}</Button>
              <Button href="/settings" variant="secondary">{t.personalAiSettings}</Button>
            </div>
          </div>
          <Card className="bg-mint shadow-none">
            <h2 className="text-2xl font-black tracking-tight">{t.startTitle}</h2>
            <p className="mt-3 text-sm leading-6 text-ink/65">{t.startBody}</p>
            <dl className="mt-6 space-y-4 border-t border-ink/10 pt-5 text-sm">
              <div><dt className="font-bold">{t.formatsLabel}</dt><dd className="mt-1 text-ink/65">{t.formatsBody}</dd></div>
              <div><dt className="font-bold">{t.limitsLabel}</dt><dd className="mt-1 text-ink/65">{t.limitsBody}</dd></div>
            </dl>
          </Card>
        </section>

        <section className="space-y-6" aria-labelledby="workflow-title">
          <h2 id="workflow-title" className="text-2xl font-black tracking-tight">{t.stepsTitle}</h2>
          <StepIndicator />
        </section>

        <section className="flex flex-col gap-5 rounded-lg border border-ink/10 bg-mint p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8" aria-labelledby="saved-reports-title">
          <div className="max-w-2xl">
            <h2 id="saved-reports-title" className="text-2xl font-black tracking-tight">{t.historyTitle}</h2>
            <p className="mt-3 text-sm leading-7 text-ink/65">{t.historyEntryBody}</p>
          </div>
          <Button href="/history" variant="secondary" className="shrink-0">{t.viewHistory}</Button>
        </section>

        <section className="space-y-6" aria-labelledby="boundaries-title">
          <h2 id="boundaries-title" className="text-2xl font-black tracking-tight">{t.boundariesTitle}</h2>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="shadow-none"><h3 className="font-bold">{t.privacyTitle}</h3><p className="mt-2 text-sm leading-7 text-ink/65">{t.privacyBody}</p></Card>
            <Card className="shadow-none"><h3 className="font-bold">{t.aiTitle}</h3><p className="mt-2 text-sm leading-7 text-ink/65">{t.aiBody}</p></Card>
            <Card className="shadow-none"><h3 className="font-bold">{t.temporaryTitle}</h3><p className="mt-2 text-sm leading-7 text-ink/65">{t.temporaryBody}</p></Card>
          </div>
        </section>
      </div>
    </>
  );
}
