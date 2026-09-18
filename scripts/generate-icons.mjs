import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const sharpModule = process.argv[2] ? await import(pathToFileURL(process.argv[2]).href) : await import('sharp');
const sharp = sharpModule.default;
const source = fs.readFileSync('art/brand/app-icon.svg');
fs.mkdirSync('public/icons', { recursive: true });
for (const size of [192, 512]) await sharp(source).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
fs.writeFileSync('public/favicon.svg', source);
console.log('Generated 192×192 and 512×512 PNG icons and SVG favicon.');
