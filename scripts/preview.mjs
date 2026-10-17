import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import view from '../src/presentation.js';
const directory = path.resolve(process.argv[2] || 'work/previews');
await mkdir(directory, { recursive: true });
const base = { state: 'ok', concurrency: 1, completedBytes: 36000000, elapsedMs: 10280, targetDurationMs: 10000,
  bytesPerSecond: 36000000 / 10.28, stopReason: 'duration', errors: [], warnings: [],
  warmup: { completedBytes: 6000000, elapsedMs: 2180 }, totalCompletedBytes: 42000000, totalElapsedMs: 12460 };
const single = { version: '0.2.0', direction: 'both', mode: 'single', node: '示例节点 · US', testSource: 'cf', state: 'ok', budgetBytes: 128000000,
  runs: [{ ...base, direction: 'download', testSource: 'cf' }, { ...base, direction: 'upload', testSource: 'cf', bytesPerSecond: 2240000, completedBytes: 23027200, totalCompletedBytes: 29027200 }] };
const compare = { ...single, mode: 'compare', budgetBytes: 256000000, runs: single.runs.flatMap(run => [run, { ...run, concurrency: 4, bytesPerSecond: run.bytesPerSecond * 2.1, elapsedMs: run.elapsedMs / 2.1, totalElapsedMs: run.elapsedMs / 2.1 + run.warmup.elapsedMs }]) };
const partial = { ...single, state: 'partial', runs: [single.runs[0], { ...single.runs[1], state: 'failed', errors: ['上传 HTTP 403'], completedBytes: 0, totalCompletedBytes: 0, elapsedMs: 200, totalElapsedMs: 200, warmup: null, bytesPerSecond: null }] };
for (const [name, html] of [['single.html', view.render(single)], ['compare.html', view.render(compare)], ['partial.html', view.render(partial)], ['error.html', view.error('无法连接测速源，请检查节点后重试。')]]) {
  await writeFile(path.join(directory, name), html);
}
console.log('已生成示例数据的结果预览：' + directory);
