import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CBT PMB - MAN 1 Tasikmalaya',
  description: 'Sistem Computer Based Test Penerimaan Murid Baru MAN 1 Tasikmalaya',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'CBT PMB',
    statusBarStyle: 'black-translucent', // fullscreen style di iOS
  },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  other: {
    // iOS: aktifkan installable web app
    'mobile-web-app-capable': 'yes',
    // Disable phone number detection
    'format-detection': 'telephone=no',
  },
};

export const viewport: Viewport = {
  themeColor: '#2d7a4f',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false, // cegah pinch-zoom saat ujian
  viewportFit: 'cover', // penting untuk notch iPhone
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        {/* Service Worker registration — harus di <head> agar load lebih awal */}
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', function() {
              navigator.serviceWorker.register('/sw.js')
                .then(function(reg) { console.log('[SW] Registered:', reg.scope); })
                .catch(function(err) { console.warn('[SW] Registration failed:', err); });
            });
          }
        ` }} />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
