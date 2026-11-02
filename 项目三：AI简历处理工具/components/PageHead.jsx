import React from 'react';
import Head from 'next/head';
import { useLanguage } from './LanguageProvider';

export default function PageHead({ page }) {
  const { t } = useLanguage();
  return (
    <Head>
      <title>{t.titles[page]}</title>
    </Head>
  );
}
