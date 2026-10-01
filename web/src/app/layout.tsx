import type { Metadata } from 'next';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = { title: 'Workflows POC', description: 'Workflow builder + durable runner + playground' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex h-full min-h-screen font-sans text-sm">
        <Nav />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </body>
    </html>
  );
}
