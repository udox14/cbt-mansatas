import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CBT PMB - Ujian Penerimaan Murid Baru',
  description: 'Sistem Computer Based Test untuk Penerimaan Murid Baru',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
