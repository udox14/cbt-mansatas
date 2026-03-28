import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>

      <div style={{ position: 'fixed', inset: 0, backgroundImage: 'radial-gradient(circle,#c4ccc4 1px,transparent 1px)', backgroundSize: '26px 26px', opacity: 0.35, pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', top: '-60px', right: '-60px', width: '220px', height: '220px', borderRadius: '50%', background: '#dde2dd', pointerEvents: 'none' }} />
      <div style={{ position: 'fixed', bottom: '-40px', left: '-40px', width: '170px', height: '170px', borderRadius: '50%', background: '#d6e8dc', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', maxWidth: '340px', width: '100%' }}>
        <div style={{ background: '#fff', border: '1.5px solid #d4dbd4', borderRadius: '20px', padding: '40px 32px' }}>
          <p style={{ fontSize: '72px', fontWeight: 900, color: '#e0e5e0', lineHeight: 1, letterSpacing: '-4px', marginBottom: '8px' }}>404</p>
          <p style={{ color: '#1e2e22', fontSize: '16px', fontWeight: 800, marginBottom: '6px' }}>Halaman Tidak Ditemukan</p>
          <p style={{ color: '#8a9e8d', fontSize: '13px', marginBottom: '24px', lineHeight: 1.5 }}>Halaman yang Anda cari tidak tersedia.</p>
          <Link href="/" style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            background: '#2d7a4f', color: '#fff', fontSize: '13px', fontWeight: 700,
            padding: '10px 22px', borderRadius: '12px', textDecoration: 'none',
          }}>
            Kembali ke Beranda
          </Link>
        </div>
        <p style={{ marginTop: '20px', color: '#a8b3a8', fontSize: '11px', fontWeight: 500 }}>© 2026 MAN 1 Tasikmalaya — DRUDOX</p>
      </div>
    </div>
  );
}
