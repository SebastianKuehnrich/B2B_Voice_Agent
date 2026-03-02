import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TalentFlow Voice Agent – Dashboard',
  description: 'Analytics Dashboard für den B2B Voice Agent (Everlast Challenge 2026)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        {/* Inline script to prevent flash of wrong theme */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var theme = localStorage.getItem('theme');
                  if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased bg-gray-50 dark:bg-gray-900 transition-colors">{children}</body>
    </html>
  );
}
