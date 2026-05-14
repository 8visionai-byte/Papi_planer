import sharp from "sharp";
import path from "path";

const ICONS_DIR = path.join(process.cwd(), "public", "icons");
const PRIMARY_COLOR = "#1d4ed8";
const BG_COLOR_MASKABLE = "#1d4ed8";

async function generateIcon(size: number, filename: string, maskable: boolean) {
  // For maskable icons, use more padding (safe zone is inner 80%)
  const fontSize = maskable ? Math.round(size * 0.3) : Math.round(size * 0.4);
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${maskable ? BG_COLOR_MASKABLE : PRIMARY_COLOR}" rx="${maskable ? 0 : Math.round(size * 0.15)}"/>
      <text
        x="50%" y="54%"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="bold"
        fill="white"
        text-anchor="middle"
        dominant-baseline="middle"
      >PC</text>
    </svg>
  `;

  await sharp(Buffer.from(svg))
    .png()
    .toFile(path.join(ICONS_DIR, filename));

  console.log(`Generated ${filename} (${size}x${size})`);
}

async function main() {
  await generateIcon(192, "icon-192.png", false);
  await generateIcon(512, "icon-512.png", false);
  await generateIcon(192, "icon-maskable-192.png", true);
  await generateIcon(512, "icon-maskable-512.png", true);
  console.log("All icons generated.");
}

main().catch(console.error);
