import { useLanguage } from './LanguageProvider';

export default function StepIndicator() {
  const { t } = useLanguage();
  const steps = [
    [t.stepOne, t.stepOneBody],
    [t.stepTwo, t.stepTwoBody],
    [t.stepThree, t.stepThreeBody],
    [t.stepFour, t.stepFourBody],
  ];
  return (
    <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={t.stepsTitle}>
      {steps.map(([title, body], index) => (
        <li key={title} className="min-w-0 rounded-lg border border-ink/10 bg-paper p-5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-mint text-xs font-bold text-ink" aria-hidden="true">{index + 1}</span>
          <h3 className="mt-4 text-base font-bold leading-6">{title}</h3>
          <p className="mt-2 text-sm leading-7 text-ink/65">{body}</p>
        </li>
      ))}
    </ol>
  );
}
