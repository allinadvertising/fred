import './globals.css';
import type { Metadata } from 'next';
import TopNav from './components/TopNav';

export const metadata: Metadata = {
  title: 'Prompt Workbench',
  description: 'Fill in client details once and copy ready-to-use prompts.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased pt-20 md:pt-24">
        <TopNav />
        {children}
      </body>
    </html>
  );
}
