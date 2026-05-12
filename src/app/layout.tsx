import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Curriculum Ingest',
  description: 'Extract structured curriculum data from textbook PDFs.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
