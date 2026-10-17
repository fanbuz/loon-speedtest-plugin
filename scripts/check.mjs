import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Verification must not replace an OSS installer with local/LAN configuration.
const directory = await mkdtemp(path.join(tmpdir(), 'loon-speedtest-check-'));
try {
  for (const args of [
    [fileURLToPath(new URL('build.mjs', import.meta.url)), '--local', '--out-dir', directory],
    ['--check', path.join(directory, 'loon-speedtest.js')]
  ]) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = result.status || 1;
    if (process.exitCode) break;
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
