import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TalentFlow Voice Agent – Dashboard',
  description: 'Analytics Dashboard für den B2B Voice Agent (Everlast Challenge 2026)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="antialiased">{children}</body>
    </html>
  );
}
