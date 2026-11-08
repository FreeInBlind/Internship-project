import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '星笺 Starfolio',
  description: '可追溯原文的科幻阅读与 RAG 助手',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
