import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import view from '../src/presentation.js';

const directory = path.resolve(process.argv[2] || 'work/previews');
await mkdir(directory, { recursive: true });
const single = {
  version: '0.1.2', node: '示例节点 · US', testSource: 'cf', state: 'ok', comparisonRatio: null,
  runs: [{ state: 'ok', concurrency: 1, completedBytes: 18000000, elapsedMs: 10376, targetDurationMs: 10000,
    bytesPerSecond: 18000000 / 10.376, stopReason: 'duration', errors: [], warnings: [],
    warmup: { completedBytes: 4000000, elapsedMs: 2100 }, totalCompletedBytes: 22000000, totalElapsedMs: 12476 }]
};
const compare = JSON.parse(JSON.stringify(single));
compare.runs.push({ ...compare.runs[0], concurrency: 4, bytesPerSecond: 5500000, completedBytes: 24000000, elapsedMs: 24000000 / 5500, totalElapsedMs: 24000000 / 5500 + 2100, totalCompletedBytes: 28000000, stopReason: 'budget' });
compare.comparisonRatio = compare.runs[1].bytesPerSecond / compare.runs[0].bytesPerSecond;
for (const [name, html] of [
  ['single.html', view.render(single)],
  ['compare.html', view.render(compare)],
  ['error.html', view.error('HEAD 200 正常，但测速源未声明 Accept-Ranges: bytes。\n未继续下载正文。')]
]) {
  const preview = html.replace('<main>', '<main><p style="font-size:11px;color:var(--muted);margin:0 0 16px">界面预览 · 示例数据</p>');
  await writeFile(path.join(directory, name), preview);
}
console.log('已生成示例结果页：' + directory);
