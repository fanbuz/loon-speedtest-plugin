/* Compact inline HTML for Loon's native result dialog, not a browser layout. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LoonSpeedtestView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function escape(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function conciseError(message) {
    return /Socket closed by remote peer/i.test(message) ? '连接被对端关闭，请切换测速源或查看脚本日志' : message;
  }
  function sourceName(source) { return source === "apple" ? "Apple CDN" : source === "custom" ? "自定义" : "Cloudflare"; }
  function text(value, size, weight, color) {
    return '<font face="Helvetica" color="' + (color || '#777777') + '"><span style="font-family:Helvetica;font-size:' + size + 'px;font-weight:' + (weight || 400) + ';color:' + (color || '#777777') + '">' + escape(value) + '</span></font>';
  }
  function paragraph(body) { return '<p style="margin:0 0 14px;line-height:1.4">' + body + '</p>'; }
  function documentHtml(body) {
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body>' + body + '</body></html>';
  }
  function render(result) {
    var body = paragraph(text(result.node, 13, 500) + '<br>' + text('协议 · ' + (result.nodeProtocol || '未知'), 11));
    var warnings = [];
    var elapsed = 0;
    var bytes = 0;
    ['download', 'upload'].forEach(function (direction) {
      var runs = result.runs.filter(function (run) { return (run.direction || 'download') === direction; });
      if (!runs.length) {
        if (result.direction === 'both') body += paragraph(text(direction === 'upload' ? '↑ 上传 · 未开始' : '↓ 下载 · 未开始', 14, 500));
        return;
      }
      var color = direction === 'download' ? '#338276' : '#527caa';
      var heading = (direction === 'download' ? '↓ 下载' : '↑ 上传') + '  ·  ' + sourceName(runs[0].testSource || result.testSource);
      var lines = [text(heading, 13, 500, color)];
      runs.forEach(function (run) {
        var valid = run.state === 'ok' && typeof run.bytesPerSecond === 'number' && isFinite(run.bytesPerSecond);
        var mode = run.concurrency === 1 ? '单路' : run.concurrency + ' 路并发';
        var rate = valid ? (run.bytesPerSecond * 8 / 1000000).toFixed(2) : '—';
        lines.push((runs.length > 1 ? text(mode + '  ', 12) : '') + text(rate, 30, 600, color) + text(' Mbps', 12));
        if (!valid) {
          var warmupFailed = run.warmup && run.warmup.state !== 'ok';
          var errors = warmupFailed && run.warmup.errors && run.warmup.errors.length ? run.warmup.errors : run.errors || [];
          lines.push(text((warmupFailed ? '预热失败 · ' : '') + conciseError(errors[0] || '本项未完成'), 12));
        }
        if ((run.warnings || []).length) warnings.push('样本较短，建议提高流量预算复测');
        elapsed += run.totalElapsedMs == null ? run.elapsedMs || 0 : run.totalElapsedMs;
        bytes += run.totalCompletedBytes == null ? run.completedBytes || 0 : run.totalCompletedBytes;
      });
      body += paragraph(lines.join('<br>'));
    });
    var mode = result.mode === 'compare' ? '单路 / 并发对比' : result.mode === 'concurrent' ? '并发' : '单路';
    body += paragraph(text(mode + ' · ' + (elapsed / 1000).toFixed(1) + ' 秒 · ' + (bytes / 1000000).toFixed(1) + ' MB', 11));
    if (warnings.length) body += paragraph(text(warnings[0], 11));
    return documentHtml(body);
  }
  function error(message) {
    return documentHtml(paragraph(text('本次测试未完成', 15, 600)) + paragraph(text(message, 13)));
  }
  return { render: render, error: error };
});
