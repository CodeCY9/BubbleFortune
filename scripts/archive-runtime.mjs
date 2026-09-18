// One-time, checked archive of the superseded exports; never changes current geometry.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root = process.cwd();
const checked = relative => {
  const absolute = path.resolve(root, relative);
  assert.ok(absolute.startsWith(root + path.sep), 'Path must remain inside workspace');
  return absolute;
};
const fingerprint = file => { const bytes = fs.readFileSync(checked(file)); return {
  bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }; };
const chest = ['BF_Briefcase_v008.glb', 'BF_Briefcase_v008_low.glb', 'BF_Chest_lod0.glb',
  'BF_Chest_lod0_nla_test.glb', 'BF_Chest_lod1.glb', 'BF_Chest_lod2.glb',
  ...['Hover', 'Idle', 'Open', 'RewardHold', 'Selected', 'Shake'].map(name => `clips/Chest_${name}.glb`)];
const stage = ['BF_DisplayStage_16_v007.glb', 'BF_DisplayStage_16_v006.glb', 'BF_DisplayStage_26_v006.glb', 'BF_Stage.glb'];
const entries = [
  { original: 'public/assets/models/chest_blue.glb', destination: 'art/chest-standard/legacy/runtime/chest_blue.glb' },
  ...chest.map(name => ({ original: 'public/assets/models/runtime/' + name, destination: 'art/chest-standard/legacy/runtime/' + name })),
  ...stage.map(name => ({ original: 'public/assets/models/runtime/' + name, destination: 'art/stage-basic/legacy/runtime/' + name })),
];
const currentNames = ['BF_Briefcase_v009.glb', 'BF_Briefcase_v009_low.glb', 'BF_DisplayStage_26_v007.glb'];
const current = currentNames.map(name => ({ path: 'public/assets/models/runtime/' + name, ...fingerprint('public/assets/models/runtime/' + name) }));
const manifestPath = checked('docs/validation/2026-09-10-runtime-archive.json');
assert.ok(!fs.existsSync(manifestPath), 'Archive already recorded; inspect manifest instead of rerunning');
const layoutFile = checked('src/stage-layout.json');
const originalLayouts = JSON.parse(fs.readFileSync(layoutFile, 'utf8'));
assert.ok(originalLayouts['16'] && originalLayouts['26']);
for (const entry of entries) {
  checked(entry.destination); assert.ok(fs.existsSync(checked(entry.original)));
  assert.ok(!fs.existsSync(checked(entry.destination)), 'Destination must not exist');
}
for (const entry of entries) {
  Object.assign(entry, fingerprint(entry.original));
  entry.backup = '.codex-antigravity/backups/runtime-archive/' + entry.original;
  fs.mkdirSync(path.dirname(checked(entry.backup)), { recursive: true });
  if (!fs.existsSync(checked(entry.backup))) fs.copyFileSync(checked(entry.original), checked(entry.backup), fs.constants.COPYFILE_EXCL);
  assert.equal(fingerprint(entry.backup).sha256, entry.sha256);
  fs.mkdirSync(path.dirname(checked(entry.destination)), { recursive: true });
  fs.renameSync(checked(entry.original), checked(entry.destination));
  assert.deepEqual(fingerprint(entry.destination), { bytes: entry.bytes, sha256: entry.sha256 });
}
const layoutBackup = checked('.codex-antigravity/backups/runtime-archive/stage-layout.json');
fs.copyFileSync(layoutFile, layoutBackup, fs.constants.COPYFILE_EXCL);
fs.writeFileSync(checked('art/stage-basic/legacy/stage-layout-16.json'), JSON.stringify(originalLayouts['16'], null, 2) + '\n', { flag: 'wx' });
fs.writeFileSync(layoutFile, JSON.stringify({ '26': originalLayouts['26'] }, null, 2) + '\n');
assert.deepEqual(JSON.parse(fs.readFileSync(layoutFile, 'utf8'))['26'], originalLayouts['26']);
for (const item of current) assert.equal(fingerprint(item.path).sha256, item.sha256);
fs.writeFileSync(manifestPath, JSON.stringify({ date: new Date().toISOString(), entries, current,
  layout: { archive: 'art/stage-basic/legacy/stage-layout-16.json', backup: path.relative(root, layoutBackup).replaceAll('\\', '/'), current26Unchanged: true } }, null, 2) + '\n', { flag: 'wx' });
console.log('Archived 17 historical GLBs; target and backup hashes verified. Current 3 GLBs and 26-box layout unchanged.');
