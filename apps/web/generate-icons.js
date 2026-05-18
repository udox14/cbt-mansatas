// generate-icons.js — jalankan sekali untuk buat semua PWA icons
const sharp = require('sharp');
const path = require('path');

const src = path.join(__dirname, 'public', 'kemenag.png');
const outDir = path.join(__dirname, 'public', 'icons');
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

async function main() {
  for (const size of sizes) {
    await sharp(src)
      .resize(size, size, { fit: 'contain', background: { r: 244, g: 246, b: 244, alpha: 1 } })
      .png()
      .toFile(path.join(outDir, `icon-${size}.png`));
    console.log(`✓ icon-${size}.png`);
  }

  // Apple touch icon (180x180) — wajib untuk iOS
  await sharp(src)
    .resize(180, 180, { fit: 'contain', background: { r: 244, g: 246, b: 244, alpha: 1 } })
    .png()
    .toFile(path.join(outDir, 'apple-touch-icon.png'));
  console.log('✓ apple-touch-icon.png');

  // Favicon 32x32
  await sharp(src)
    .resize(32, 32, { fit: 'contain', background: { r: 244, g: 246, b: 244, alpha: 1 } })
    .png()
    .toFile(path.join(__dirname, 'public', 'favicon-32.png'));
  console.log('✓ favicon-32.png');

  console.log('\nSemua icon berhasil dibuat!');
}

main().catch(console.error);
