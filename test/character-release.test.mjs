import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readRuntimeConfig } from '../dsh-plugin/runtime-config.js';

const root = fileURLToPath(new URL('..', import.meta.url));

test('portable services have no author paths and reject remote services or relative resource paths', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'character-config-'));
  try {
    const config = readRuntimeConfig({ home: temp, applications: temp, workspace: temp, env: {} });
    assert.equal(config.pianoRuntime, null); assert.equal(config.coversRoot, null); assert.equal(config.petApp, null);
    assert.equal(config.ttsUrl, 'http://127.0.0.1:9881');
    assert.throws(() => readRuntimeConfig({ home: temp, workspace: temp, env: { AGENTS_TIME_TTS_URL: 'https://example.com' } }), /本机/u);
    assert.throws(() => readRuntimeConfig({ home: temp, workspace: temp, env: { AGENTS_TIME_PET_APP: './pet.app' } }), /绝对路径/u);
    const file = join(temp, 'services.json');
    await writeFile(file, JSON.stringify({ pianoUrl: 'http://localhost:19982', petApp: '/test/Custom Pet.app' }));
    const custom = readRuntimeConfig({ home: temp, workspace: temp, env: { AGENTS_TIME_CONFIG: file, AGENTS_TIME_TTS_URL: 'http://127.0.0.1:19981' } });
    assert.equal(custom.ttsUrl, 'http://127.0.0.1:19981'); assert.equal(custom.pianoUrl, 'http://localhost:19982');
    assert.equal(custom.petApp, '/test/Custom Pet.app');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('the actual release installs both characters in an isolated directory without images, weights or personal data', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'character-release-'));
  try {
    const output = join(temp, 'artifacts'), installRoot = join(temp, 'installed plugins'), extracted = join(temp, 'unpacked');
    const build = () => JSON.parse(execFileSync('python3', [join(root, 'scripts/build-character-release.py'), '--output', output], { encoding: 'utf8' }));
    const release = build(), first = await readFile(release.zip); build();
    assert.deepEqual(await readFile(release.zip), first);
    execFileSync('python3', ['-c', 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', release.zip, extracted]);
    const directory = join(extracted, release.zip.split('/').at(-1).replace(/\.zip$/u, ''));
    const hashes = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
    assert.doesNotMatch(hashes, /\.(?:png|jpe?g|webp|moc3|pth|ckpt|sqlite|wav|mp3)(?:\s|$)/imu);
    const installer = join(directory, 'Install.command'), mock = join(temp, 'mock-dsh'), receipt = join(temp, 'receipt');
    await writeFile(mock, '#!/bin/sh\nprintf "%s\\n" "$@" > "$INSTALL_RECEIPT"\n', { mode: 0o755 });
    const env = { ...process.env, DSH_CLI: mock, DSH_PROFILE: 'qa-test', AGENTS_TIME_INSTALL_ROOT: installRoot, INSTALL_RECEIPT: receipt };
    const check = execFileSync('sh', [installer, '--check'], { env, encoding: 'utf8' });
    assert.match(check, /检查模式未安装/u); await assert.rejects(stat(installRoot), { code: 'ENOENT' });
    execFileSync('sh', [installer], { env });
    const args = (await readFile(receipt, 'utf8')).trim().split('\n');
    assert.deepEqual(args.slice(0, 4), ['plugin', '--profile', 'qa-test', 'add']);
    const installed = args[4]; assert.equal((await stat(join(installed, 'index.js'))).isFile(), true);
    execFileSync('sh', [installer], { env }); // Repeat install reuses identical code.
    const metadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
    assert.equal(metadata.name, '@emilia/companion-loop');
    const model = await readFile(join(installed, 'model.js'), 'utf8');
    assert.match(model, /emilia-x1/u); assert.match(model, /hotaru-v0\.1/u);
    const covers = await import(pathToFileURL(join(installed, 'music-covers.js')));
    assert.equal(covers.MUSIC_COVERS.length, 0);
    const avatars = await import(pathToFileURL(join(installed, 'avatars.js')));
    assert.equal((await avatars.loadAvatar('emilia')).type, 'image/svg+xml');
    assert.match((await avatars.loadAvatar('hotaru')).bytes.toString(), />HO</u);
    assert.equal(await avatars.loadAvatar('../../secret'), null);
    await import(pathToFileURL(join(installed, 'index.js'))); // All backend imports resolve from the installed package.
    await writeFile(join(directory, 'package', 'model.js'), 'tampered');
    assert.notEqual(spawnSync('sh', [installer, '--check'], { env, encoding: 'utf8' }).status, 0);
    assert.deepEqual((await readdir(output)).sort(), [release.zip.split('/').at(-1), 'SHA256SUMS', release.plugin.split('/').at(-1)].sort());
  } finally { await rm(temp, { recursive: true, force: true }); }
});
