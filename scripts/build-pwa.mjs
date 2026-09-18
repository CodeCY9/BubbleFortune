import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const root = path.resolve('dist');
const staticFiles = ['/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  ...fs.readdirSync(path.join(root, 'assets')).filter(name => /\.(js|css)$/.test(name)).map(name => '/assets/' + name)];
const runtimeFiles = [
  '/assets/models/runtime/BF_Briefcase_v009.glb', '/assets/models/runtime/BF_Briefcase_v009_low.glb',
  '/assets/models/runtime/BF_DisplayStage_26_v007.glb',
  ...['thinking', 'confident', 'sinister', 'explaining', 'pointing', 'smiling'].map(name => `/assets/character_banker_${name}.png`),
];
const digest = crypto.createHash('sha256');
for (const file of [...staticFiles, ...runtimeFiles].sort()) digest.update(file).update(fs.readFileSync(path.join(root, file)));
const config = { version: digest.digest('hex').slice(0, 20), staticFiles, runtimeFiles,
  precache: staticFiles.filter(file => !file.startsWith('/assets/Stage3D-')) };
const template = fs.readFileSync('scripts/sw-template.js', 'utf8');
assert.equal(template.split('__BF_CONFIG__').length, 2);
fs.writeFileSync(path.join(root, 'sw.js'), template.replace('__BF_CONFIG__', JSON.stringify(config)));
fs.writeFileSync(path.join(root, 'pwa-build.json'), JSON.stringify(config, null, 2));
console.log(`PWA ${config.version}: ${config.precache.length} shell resources; ${runtimeFiles.length} runtime assets allowed.`);
