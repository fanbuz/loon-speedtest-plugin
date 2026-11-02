import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import metadata from '../src/metadata.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const buildScript = fileURLToPath(new URL('build.mjs', import.meta.url));
const artifacts = ['LoonSpeedtest.plugin', 'loon-speedtest.js', 'icon.png'];

function runNode(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('构建或语法检查失败（退出码 ' + result.status + '）');
}

function readmeProblems(readme) {
  const problems = [];
  const links = [...readme.matchAll(/href=["']([^"']+)["']/g), ...readme.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)]
    .map(match => match[1].replace(/&amp;/g, '&'));
  const pluginPath = '/fanbuz/loon-speedtest-plugin/main/dist/LoonSpeedtest.plugin';
  const installers = { raw: [], import: [] };
  for (const link of links) {
    let url;
    try { url = new URL(link); } catch (_) { continue; }
    if (url.hostname === 'raw.githubusercontent.com' && url.pathname === pluginPath) installers.raw.push(url);
    if (url.hostname === 'www.nsloon.com' && url.pathname === '/openloon/import') {
      try { installers.import.push(new URL(url.searchParams.get('plugin'))); } catch (_) { problems.push('README.md：一键导入链接缺少有效 plugin 地址'); }
    }
  }
  for (const [kind, urls] of Object.entries(installers)) {
    if (!urls.length) problems.push('README.md：缺少 ' + (kind === 'raw' ? 'Raw 安装' : '一键导入') + '链接');
    if (urls.some(url => url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.pathname !== pluginPath || url.searchParams.get('v') !== metadata.version)) {
      problems.push('README.md：' + (kind === 'raw' ? 'Raw 安装' : '一键导入') + '链接地址或缓存版本不一致');
    }
  }
  const hint = /日志首行[^`\n]*`(?:节点速度测试\s+)?v([^`]+)`/.exec(readme);
  if (!hint || hint[1] !== metadata.version) problems.push('README.md：更新后的日志版本提示应为 v' + metadata.version);
  return problems;
}

// Checks only write disposable build directories, never the tracked dist files.
const directory = await mkdtemp(path.join(tmpdir(), 'loon-speedtest-check-'));
try {
  const remote = path.join(directory, 'remote');
  const local = path.join(directory, 'local');
  runNode([buildScript, '--out-dir', remote]);
  runNode(['--check', path.join(remote, 'loon-speedtest.js')]);
  runNode([buildScript, '--local', '--out-dir', local]);
  runNode(['--check', path.join(local, 'loon-speedtest.js')]);

  const problems = [];
  for (const name of artifacts) {
    const generated = await readFile(path.join(remote, name));
    let checkedIn;
    try { checkedIn = await readFile(path.join(root, 'dist', name)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      problems.push('dist/' + name + '：文件缺失');
      continue;
    }
    if (!checkedIn.equals(generated)) problems.push('dist/' + name + '：与默认发行构建不一致');
  }
  problems.push(...readmeProblems(await readFile(path.join(root, 'README.md'), 'utf8')));
  if (problems.length) {
    throw new Error(problems.join('\n') + '\n请更新 README 安装链接/版本提示，并运行 npm run build 后重新检查；检查不会自动改写发行文件。');
  }
  console.log('发行文件与默认 GitHub Raw 构建一致；README 安装链接和版本提示正确。');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
