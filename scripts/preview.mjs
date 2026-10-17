import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import view from '../src/presentation.js';
const directory = path.resolve(process.argv[2] || 'work/previews');
await mkdir(directory, { recursive: true });
const base = { state: 'ok', concurrency: 1, completedBytes: 36000000, elapsedMs: 10280, targetDurationMs: 10000,
  bytesPerSecond: 36000000 / 10.28, stopReason: 'duration', errors: [], warnings: [],
  warmup: { state: 'ok', completedBytes: 1000000, elapsedMs: 2180 }, totalCompletedBytes: 37000000, totalElapsedMs: 12460 };
const single = { version: '0.4.0', direction: 'both', mode: 'single', node: '示例节点 · US', nodeProtocol: 'Hysteria2', testSource: 'apple', state: 'ok', budgetBytes: 128000000,
  runs: [{ ...base, direction: 'download', testSource: 'apple' }, { ...base, direction: 'upload', testSource: 'apple', bytesPerSecond: 2240000, completedBytes: 23027200, totalCompletedBytes: 24027200 }] };
const compare = { ...single, mode: 'compare', budgetBytes: 256000000, runs: single.runs.flatMap(run => [run, { ...run, concurrency: 4, bytesPerSecond: run.bytesPerSecond * 2.1, elapsedMs: run.elapsedMs / 2.1, totalElapsedMs: run.elapsedMs / 2.1 + run.warmup.elapsedMs }]) };
const partial = { ...single, state: 'partial', runs: [single.runs[0], { ...single.runs[1], state: 'failed', errors: ['上传 HTTP 403'], completedBytes: 0, totalCompletedBytes: 0, elapsedMs: 200, totalElapsedMs: 200, warmup: null, bytesPerSecond: null }] };
const recovered = { ...single, runs: [single.runs[0], { ...single.runs[1], concurrency: 2, recovered: true, warnings: ['已降低负载重测，当前最多 2 路；详情见日志'] }] };
const pending = { ...single, state: 'failed', runs: [{ ...single.runs[0], state: 'incomplete', completedBytes: 0, totalCompletedBytes: 7000000, elapsedMs: 0, totalElapsedMs: 13050, errors: [], warmup: { state: 'incomplete', completedBytes: 7000000, unresolvedRequests: 1, errors: ['请求 #8 未按时回调；传输量未知，已停止后续测量'] } }] };
for (const [name, html] of [['recovered.html', view.render(recovered)], ['pending.html', view.render(pending)], ['single.html', view.render(single)], ['compare.html', view.render(compare)], ['partial.html', view.render(partial)], ['error.html', view.error('无法连接测速源，请检查节点后重试。')]]) {
  await writeFile(path.join(directory, name), html);
}
console.log('已生成示例数据的结果预览：' + directory);
