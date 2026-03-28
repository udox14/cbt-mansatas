import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center">
        <p className="text-6xl font-extrabold text-gray-200">404</p>
        <h1 className="text-lg font-bold text-gray-800 mt-2">Halaman Tidak Ditemukan</h1>
        <p className="text-sm text-gray-400 mt-1 mb-5">Halaman yang Anda cari tidak tersedia.</p>
        <Link href="/" className="inline-block px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition">Kembali ke Beranda</Link>
      </div>
    </div>
  );
}
