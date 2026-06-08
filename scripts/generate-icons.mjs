// Generates all PWA icon sizes from a single source image.
//
// Usage:
//   1. Save your square-ish source image to: public/icon-source.png
//      (or .jpg — pass the path as the first arg)
//   2. Run: node scripts/generate-icons.mjs [sourcePath]
//
// Outputs into public/icons/:
//   icon-192.png, icon-512.png            (purpose: any — fills the tile)
//   icon-maskable-192.png, -512.png       (purpose: maskable — safe-zone padded)
//   apple-touch-icon.png                  (180x180 for iOS home screen)

import sharp from "sharp";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const SRC = process.argv[2] || "public/icon-source.png";
const OUT_DIR = "public/icons";
const BG = { r: 255, g: 255, b: 255, alpha: 1 }; // white — matches the icon's background

if (!existsSync(SRC)) {
  console.error(`\n❌ Nie znaleziono pliku zrodlowego: ${SRC}`);
  console.error(`   Zapisz swoj obraz jako public/icon-source.png i uruchom ponownie.\n`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });

// "any" icons — cover the full square tile (face fills the icon, edges may crop)
async function makeAny(size) {
  const out = path.join(OUT_DIR, `icon-${size}.png`);
  await sharp(SRC)
    .resize(size, size, { fit: "cover", position: "top" })
    .png()
    .toFile(out);
  console.log(`✓ ${out}`);
}

// Apple touch icon — 180x180, cover, flattened on white (iOS adds its own rounding)
async function makeApple() {
  const out = path.join(OUT_DIR, "apple-touch-icon.png");
  await sharp(SRC)
    .resize(180, 180, { fit: "cover", position: "top" })
    .flatten({ background: BG })
    .png()
    .toFile(out);
  console.log(`✓ ${out}`);
}

// Maskable icons — image sits inside the ~80% safe zone on a white canvas,
// so Android can mask to any shape (circle/squircle) without cutting the face.
async function makeMaskable(size) {
  const out = path.join(OUT_DIR, `icon-maskable-${size}.png`);
  const inner = Math.round(size * 0.78);
  const resized = await sharp(SRC)
    .resize(inner, inner, { fit: "cover", position: "top" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toFile(out);
  console.log(`✓ ${out}`);
}

console.log(`\nGeneruje ikony z: ${SRC}\n`);
await makeAny(192);
await makeAny(512);
await makeApple();
await makeMaskable(192);
await makeMaskable(512);
console.log(`\n✅ Gotowe — 5 ikon w ${OUT_DIR}/\n`);
