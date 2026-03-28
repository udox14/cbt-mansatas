import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 p-4">
      <div className="text-center">
        <p className="text-6xl font-extrabold text-surface-200">404</p>
        <h1 className="text-lg font-bold text-surface-800 mt-2">Halaman Tidak Ditemukan</h1>
        <p className="text-sm text-surface-400 mt-1 mb-4">Halaman yang Anda cari tidak tersedia.</p>
        <Link href="/" className="inline-block px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-colors">
          Kembali ke Beranda
        </Link>
      </div>
    </div>
  );
}
