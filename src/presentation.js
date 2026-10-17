/* Static, offline HTML for Loon Generic's documented htmlMessage result. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LoonSpeedtestView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }
  function mb(bytes) { return (bytes / 1000000).toFixed(2); }
  function seconds(ms) { return (ms / 1000).toFixed(2); }
  function sourceName(source) { return source === "apple" ? "Apple CDN" : source === "custom" ? "自定义" : "Cloudflare"; }

  var styles = [
    ":root{color-scheme:light dark;--bg:#f3f5f6;--panel:#fff;--ink:#17272c;--muted:#586c72;--line:#e1e8e9;--accent:#126c60;--tint:#e7f2ee;--warn:#855813;--warn-bg:#fff3de;--error:#a94039}",
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;-webkit-text-size-adjust:100%;font-size:14px;line-height:1.5}",
    "main{max-width:760px;margin:auto;padding:26px 20px 24px}.brand{font-size:10px;letter-spacing:2.4px;font-weight:700;color:var(--muted)}.topline{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:22px}.status{font-size:11px;font-weight:600;color:var(--accent);background:var(--tint);padding:5px 10px;border-radius:20px;white-space:nowrap}.status.fail{color:var(--error);background:var(--warn-bg)}",
    "h1{font-size:24px;letter-spacing:-.6px;line-height:1.3;margin:0 0 8px;font-weight:650;overflow-wrap:anywhere}.source{color:var(--muted);font-size:13px;margin:0 0 22px}.runs{display:grid;gap:14px}.run{background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:22px;box-shadow:0 8px 30px rgba(20,40,48,.025)}.run-name{font-size:13px;color:var(--muted);font-weight:600}.measure-label{font-size:11px;color:var(--muted);margin-top:24px;letter-spacing:.5px}",
    ".speed-display{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin:0 0 1px}.speed{font-size:clamp(40px,13vw,68px);line-height:1.2;letter-spacing:-2.8px;font-weight:600;font-variant-numeric:tabular-nums}.unit{font-size:15px;font-weight:500;color:var(--muted)}.secondary{font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums;margin:0 0 23px}",
    ".stats{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:15px 0;margin-bottom:14px;gap:12px}.stat-label{font-size:11px;color:var(--muted);margin-bottom:4px}.stat-value{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}.stat-unit{font-size:11px;color:var(--muted);font-weight:400;margin-left:4px}.reason{font-size:12px;margin:0;color:var(--accent)}.drain,.warmup,.total{font-size:11px;color:var(--muted);margin:5px 0 0}.warmup{margin-top:13px;padding-top:13px;border-top:1px solid var(--line)}",
    ".notice{border-radius:12px;padding:10px 12px;background:var(--warn-bg);color:var(--warn);font-size:12px;line-height:1.6;margin:14px 0 0;overflow-wrap:anywhere;white-space:pre-wrap}.notice.error{color:var(--error)}.comparison{padding:16px 2px 0;color:var(--accent);font-size:13px;font-weight:600}.comparison span{font-weight:400;color:var(--muted);font-size:11px;margin-left:7px}.footnote{font-size:11px;color:var(--muted);line-height:1.8;margin:20px 3px 0}.error-card h2{font-size:20px;margin:0 0 12px}.error-card p{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--muted);margin:0}",
    "@media(min-width:620px){.runs.compare{grid-template-columns:1fr 1fr}.runs.compare .speed{font-size:48px}}@media(max-width:340px){main{padding:20px 14px}.run{padding:18px}.brand{letter-spacing:1.6px}h1{font-size:21px}}",
    "@media(prefers-color-scheme:dark){:root{--bg:#11191d;--panel:#192429;--ink:#edf4f4;--muted:#a1b3b8;--line:#2a3b42;--accent:#89cbb9;--tint:#213f37;--warn:#ebc88e;--warn-bg:#382f20;--error:#f3a69e}}"
  ].join("");

  function documentHtml(title, body) {
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>' + escape(title) + '</title><style>' + styles + '</style></head><body><main>' + body + '</main></body></html>';
  }

  function runCard(item) {
    var valid = item.state === "ok" && typeof item.bytesPerSecond === "number" && isFinite(item.bytesPerSecond);
    var label = item.concurrency === 1 ? "单路下载" : item.concurrency + " 路并发下载";
    var reasons = { duration: "达到测量时长", budget: "达到数据预算", error: "下载出现异常", "callback-timeout": "下载回调超时", "warmup-error": "预热未完成" };
    var html = '<section class="run"><div class="run-name">' + escape(label) + '</div><div class="measure-label">正式平均下载速度</div><div class="speed-display"><span class="speed">' + (valid ? (item.bytesPerSecond * 8 / 1000000).toFixed(2) : '—') + '</span><span class="unit">Mbps</span></div><p class="secondary">' + (valid ? (item.bytesPerSecond / 1000000).toFixed(3) + ' MB/s' : '本轮无有效速度结果') + '</p>';
    html += '<div class="stats"><div><div class="stat-label">正式数据</div><div class="stat-value">' + mb(item.completedBytes) + '<span class="stat-unit">MB</span></div></div><div><div class="stat-label">测量耗时</div><div class="stat-value">' + seconds(item.elapsedMs) + '<span class="stat-unit">秒</span></div></div></div>';
    html += '<p class="reason"' + (valid ? '' : ' style="color:var(--error)"') + '>' + escape(reasons[item.stopReason] || "测试结束") + '</p>';
    if (item.stopReason === "duration" && item.elapsedMs > item.targetDurationMs) {
      html += '<p class="drain">测量窗口 ' + (item.targetDurationMs / 1000) + ' 秒 · 在途收尾 ' + seconds(item.elapsedMs - item.targetDurationMs) + ' 秒</p>';
    }
    if (item.warmup) {
      html += '<p class="warmup">预热 ' + seconds(item.warmup.elapsedMs) + ' 秒 · ' + mb(item.warmup.completedBytes) + ' MB，不计入平均速度</p>';
      html += '<p class="total">本轮已确认数据 ' + mb(item.totalCompletedBytes) + ' MB · 总耗时 ' + seconds(item.totalElapsedMs) + ' 秒</p>';
    }
    if (item.errors && item.errors.length) html += '<div class="notice error">' + escape(item.errors.join("\n")) + '</div>';
    if (item.warnings && item.warnings.length) html += '<div class="notice">' + escape(item.warnings.join("\n")) + '</div>';
    return html + '</section>';
  }

  function render(result) {
    var ok = result.state === "ok";
    var body = '<header><div class="topline"><span class="brand">LOON / SPEEDTEST</span><span class="status' + (ok ? '' : ' fail') + '">' + (ok ? '测量完成' : '测量未完成') + '</span></div><h1>' + escape(result.node) + '</h1><p class="source">' + escape(sourceName(result.testSource)) + ' · 下载测速</p></header>';
    body += '<div class="runs' + (result.runs.length > 1 ? ' compare' : '') + '">' + result.runs.map(runCard).join("") + '</div>';
    if (result.comparisonRatio != null && isFinite(result.comparisonRatio)) body += '<div class="comparison">并发 / 单路 ' + result.comparisonRatio.toFixed(2) + ' ×<span>本次顺序采样</span></div>';
    body += '<p class="footnote">统计正式阶段的应用层平均吞吐，包含请求等待和在途收尾。<br>预热不计速度，但计入数据预算。1 MB = 1,000,000 B。</p>';
    return documentHtml("下载测速结果", body);
  }

  function error(message) {
    return documentHtml("测速未完成", '<header class="topline"><span class="brand">LOON / SPEEDTEST</span><span class="status fail">未完成</span></header><section class="run error-card"><h2>本次测速未完成</h2><p>' + escape(message) + '</p></section><p class="footnote">详细过程可查看脚本日志。</p>');
  }
  return { render: render, error: error };
});
