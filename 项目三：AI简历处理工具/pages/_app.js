import '../styles/globals.css';
import AppShell from '../components/AppShell';
import { LanguageProvider } from '../components/LanguageProvider';
import { SessionProvider } from 'next-auth/react';
import { CustomAiProvider } from '../components/CustomAiProvider';

export default function MyApp({ Component, pageProps }) {
  return (
    <SessionProvider session={pageProps.session}>
      <CustomAiProvider>
        <LanguageProvider>
          <AppShell><Component {...pageProps} /></AppShell>
        </LanguageProvider>
      </CustomAiProvider>
    </SessionProvider>
  );
}
