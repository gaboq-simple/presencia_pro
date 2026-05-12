// ─── PWA Icon Generator ────────────────────────────────────────────────────────
// Generates placeholder PNG icons for the sellers-portal PWA manifest.
// Color: #185FA5 (PresenciaPro brand blue).
// Run: node generate-icons.js
// Replace with real icons before production deploy.

const path = require('path');

async function generateIcons() {
  let sharp;
  try {
    sharp = require('sharp');
  } catch {
    console.error('sharp not found — install it with: npm install sharp');
    process.exit(1);
  }

  const outDir = path.join(__dirname, 'public', 'icons');
  const sizes = [192, 512];

  for (const size of sizes) {
    const outPath = path.join(outDir, `icon-${size}.png`);
    // Solid #185FA5 square
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 24, g: 95, b: 165, alpha: 1 },
      },
    })
      .png()
      .toFile(outPath);

    console.log(`Generated ${outPath}`);
  }
}

generateIcons().catch((err) => {
  console.error(err);
  process.exit(1);
});
