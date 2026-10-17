/* Shared engine. No browser APIs and no Loon globals in this file. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LoonSpeedtest = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SOURCE = "https://speed.cloudflare.com/__down";
  var UPLOAD_SOURCE = "https://speed.cloudflare.com/__up";
  var APPLE_SOURCE = "https://mensura.cdn-apple.com/api/v1/gm/large";
  var APPLE_UPLOAD_SOURCE = "https://mensura.cdn-apple.com/api/v1/gm/slurp";
  var MB = 1000000;

  function parseArgument(value) {
    if (value == null || value === "") return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value !== "string") throw new Error("脚本参数需要是对象、JSON 或查询字符串");
    if (value.trim().charAt(0) === "{") return parseArgument(JSON.parse(value));
    var result = Object.create(null);
    value.split("&").forEach(function (part) {
      var index = part.indexOf("=");
      if (index <= 0) throw new Error("参数格式应为 name=value，并以 & 分隔");
      var decode = function (text) { return decodeURIComponent(text.replace(/\+/g, " ")); };
      result[decode(part.slice(0, index))] = decode(part.slice(index + 1));
    });
    return result;
  }

  function numberOption(value, fallback, min, max, name, integer) {
    if (value == null || value === "") value = fallback;
    if (typeof value !== "number" && typeof value !== "string") throw new Error(name + " 需要是数字");
    var number = Number(value);
    if (!isFinite(number) || number < min || number > max || (integer && Math.floor(number) !== number)) {
      throw new Error(name + " 应为 " + min + "–" + max + (integer ? " 的整数" : " 的数字"));
    }
    return number;
  }

  function normalizeOptions(input) {
    var raw = parseArgument(input);
    var direction = raw.direction == null || raw.direction === "" ? "both" : raw.direction;
    if (["both", "download", "upload"].indexOf(direction) < 0) throw new Error("direction 应为 both、download 或 upload");
    var mode = raw.mode == null || raw.mode === "" ? "single" : raw.mode;
    if (["single", "concurrent", "compare"].indexOf(mode) < 0) throw new Error("mode 应为 single、concurrent 或 compare");
    if (raw.node != null && typeof raw.node !== "string") throw new Error("node 需要是节点或策略组名称");
    var sources = { cf: "cf", Cloudflare: "cf", apple: "apple", "Apple CDN": "apple", custom: "custom", "自定义": "custom" };
    var sourceName = raw.test_source == null || raw.test_source === "" ? "apple" : raw.test_source;
    if (typeof sourceName !== "string") throw new Error("test_source 需要是测速源名称");
    var testSource = Object.prototype.hasOwnProperty.call(sources, sourceName) ? sources[sourceName] : null;
    if (!testSource) throw new Error("test_source 应为 Cloudflare、Apple CDN 或 自定义");
    var testUrl = testSource === "cf" ? SOURCE : APPLE_SOURCE;
    if (testSource === "custom" && direction !== "upload") {
      if (typeof raw.test_url !== "string" || !/^https?:\/\/[^\s/?#@]+(?:[/?][^\s#]*)?$/i.test(raw.test_url.trim())) {
        throw new Error("选择自定义时请填写有效的 HTTP(S) test_url（不能含 URL 用户信息或片段）");
      }
      testUrl = raw.test_url.trim();
    }
    var uploadName = raw.upload_source;
    if (uploadName == null || uploadName === "") {
      // Keep existing installations with an explicitly configured custom upload URL.
      uploadName = testSource === "custom" && typeof raw.upload_url === "string" && raw.upload_url.trim() ? "custom" : "apple";
    }
    var uploadSource = typeof uploadName === "string" && Object.prototype.hasOwnProperty.call(sources, uploadName) ? sources[uploadName] : null;
    if (!uploadSource) throw new Error("upload_source 应为 Apple CDN、Cloudflare 或 自定义");
    var uploadUrl = uploadSource === "cf" ? UPLOAD_SOURCE : APPLE_UPLOAD_SOURCE;
    if (uploadSource === "custom" && direction !== "download") {
      if (typeof raw.upload_url !== "string" || !/^https?:\/\/[^\s/?#@]+(?:[/?][^\s#]*)?$/i.test(raw.upload_url.trim())) {
        throw new Error("upload_url 需要有效的 HTTP(S) POST 接收地址");
      }
      uploadUrl = raw.upload_url.trim();
    }
    if (raw.adaptive != null && [true, false, "true", "false"].indexOf(raw.adaptive) < 0) throw new Error("adaptive 需要布尔值");
    if (raw.httpVersion != null && raw.httpVersion !== "" && ["auto", "h1", "h2"].indexOf(raw.httpVersion) < 0) throw new Error("httpVersion 应为 auto、h1 或 h2");
    return {
      direction: direction,
      adaptive: raw.adaptive !== false && raw.adaptive !== "false",
      httpVersion: raw.httpVersion == null || raw.httpVersion === "" ? "auto" : raw.httpVersion,
      uploadUrl: uploadUrl,
      uploadSource: uploadSource,
      mode: mode,
      node: (raw.node || "").trim(),
      testSource: testSource,
      testUrl: testUrl,
      concurrency: numberOption(raw.concurrency, 4, 2, 8, "concurrency", true),
      durationMs: numberOption(raw.duration, 10, 3, 30, "duration", true) * 1000,
      chunkBytes: numberOption(raw.chunkKB, 4000, 64, 4000, "chunkKB", true) * 1000,
      uploadChunkBytes: numberOption(raw.uploadChunkKB, 1000, 64, 4000, "uploadChunkKB", true) * 1000,
      maxBytes: numberOption(raw.maxMB, 64, 4, 256, "maxMB", true) * MB,
      requestTimeoutMs: numberOption(raw.requestTimeout, 10, 1, 15, "requestTimeout", true) * 1000,
      warmupMs: numberOption(raw.warmup, 2, 0, 5, "warmup", true) * 1000,
      notify: raw.notify !== false && raw.notify !== "false"
    };
  }

  // Preserve explicit routing; nodeInfo is read separately for display only.
  function resolveTarget(explicit, environment) {
    if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
    var params = environment && environment.params || {};
    if (typeof params.node === "string" && params.node.trim()) return params.node.trim();
    if (typeof params.policyGroup === "string" && params.policyGroup.trim()) return params.policyGroup.trim();
    throw new Error("未指定测速目标：请填写 node，或从提供节点/策略组名称的入口运行；直连请明确填写 DIRECT");
  }

  function resolveNodeProtocol(target, environment) {
    if (target === "DIRECT") return "直连";
    var params = environment && environment.params || {};
    var info = params.nodeInfo;
    // Loon's official generic_example.js documents the name/type object fields.
    // Accept JSON-serialized objects for compatibility; never parse node names.
    if (typeof info === "string") {
      try { info = JSON.parse(info); } catch (_) { return null; }
    }
    if (!info || typeof info !== "object" || Array.isArray(info)) return null;
    if (typeof info.name !== "string" || info.name.trim() !== target) return null;
    if (typeof params.node === "string" && params.node.trim() && params.node.trim() !== target) return null;
    if (typeof info.type !== "string") return null;
    var types = {
      shadowsocks: "Shadowsocks", ss: "Shadowsocks", shadowsocksr: "ShadowsocksR", ssr: "ShadowsocksR",
      vmess: "VMess", vless: "VLESS", trojan: "Trojan", hysteria: "Hysteria", hysteria2: "Hysteria2", hy2: "Hysteria2",
      tuic: "TUIC", tuicv5: "TUIC v5", snell: "Snell", socks5: "SOCKS5", http: "HTTP", https: "HTTPS", wireguard: "WireGuard", ssh: "SSH"
    };
    var key = info.type.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(types, key) ? types[key] : null;
  }

  function formatRate(bytesPerSecond) {
    return (bytesPerSecond / MB).toFixed(2) + " MB/s (" + (bytesPerSecond * 8 / MB).toFixed(2) + " Mbps)";
  }

  function modeLabel(concurrency) { return concurrency === 1 ? "单路" : concurrency + " 路并发"; }

  function sourceLabel(source) { return source === "apple" ? "Apple CDN" : source === "custom" ? "自定义" : "Cloudflare"; }

  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].toLowerCase() === name.toLowerCase()) return String(headers[keys[i]]);
    }
    return null;
  }

  function validateRange(response, bytes) {
    if (!response || response.status !== 206) throw new Error("GET 分块下载需要 HTTP 206；实际 HTTP " + (response ? response.status : "无响应") + "，本次不作为有效测速数据");
    var range = header(response.headers, "content-range");
    var match = range && /^bytes\s+0-(\d+)\/(\d+)$/i.exec(range);
    if (!match || Number(match[1]) !== bytes - 1 || Number(match[2]) < bytes) throw new Error("测速源 Content-Range 与请求分块不符");
    var length = header(response.headers, "content-length");
    if (length != null && Number(length) !== bytes) throw new Error("测速源 Content-Length 与分块大小不符");
  }

  function preflight(options, runtime) {
    if (options.direction === "upload" || options.testSource === "cf") return Promise.resolve(null);
    if (runtime.log) runtime.log("检查 " + sourceLabel(options.testSource) + " 的范围能力声明（HEAD 不带 Range，不下载正文）");
    return new Promise(function (resolve, reject) {
      var settled = false;
      function settle(error, info) {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve(info);
      }
      runtime.setTimeout(function () {
        var error = new Error("测速源分段检查超时；没有发起正文下载"); error.unresolvedRequests = 1; settle(error);
      }, options.requestTimeoutMs + 1000);
      Promise.resolve().then(function () {
        return runtime.request({ method: "HEAD", url: options.testUrl, node: options.node, timeout: options.requestTimeoutMs, bytes: 0, headers: {}, alpn: options.alpn });
      }).then(function (response) {
        if (settled) return;
        var status = response && response.status;
        var ranges = header(response && response.headers, "accept-ranges");
        var length = header(response && response.headers, "content-length");
        if (runtime.log) runtime.log("HEAD 检查：HTTP " + status + " | Accept-Ranges=" + ranges + " | Content-Length=" + length);
        if (status === 206) {
          // Some endpoints return a partial HEAD response. Accept valid metadata,
          // but never require 206: Range semantics are defined for GET (RFC 9110).
          var range = header(response.headers, "content-range");
          var match = range && /^bytes\s+0-(\d+)\/(\d+)$/i.exec(range);
          if (!match) throw new Error("HEAD 206 的 Content-Range 无效");
          validateRange(response, Number(match[1]) + 1);
        } else if (status !== 200) {
          throw new Error("HEAD 返回 HTTP " + status);
        } else if (ranges && /^\s*none\s*$/i.test(ranges)) {
          throw new Error("测速源明确声明 Accept-Ranges: none；未请求下载正文");
        } else if (!ranges || !/(^|,)\s*bytes\s*(,|$)/i.test(ranges)) {
          // RFC 9110 §14.3: Accept-Ranges is advice, not a prerequisite.
          // Only the actual GET 206, Content-Range and body length prove support.
          if (runtime.log) runtime.log("HEAD 未声明字节范围能力；继续用 Range GET 的实际响应校验");
        }
        if (length != null && (!/^\d+$/.test(length) || Number(length) <= 0)) throw new Error("HEAD 返回的文件大小无效");
        settle(null, { status: status, acceptRanges: ranges, contentLength: length });
      }).catch(function (error) { settle(new Error("HEAD 检查失败：" + String(error.message || error))); });
    });
  }

  function recoverable(phase) {
    if (!phase || phase.unresolvedRequests || phase.state === "incomplete") return false;
    return phase.errors.length > 0 && phase.errors.every(function (message) {
      if (/HTTP\s*(?:4\d\d|50[015-9])/i.test(message)) return false;
      return /timeout|timed out|超时|socket closed|reset|ECONN|network|protocol error|ERR_HTTP2|ALPN|协议错误|连接|请求失败|HTTP\s*50[234]/i.test(message);
    });
  }

  function runPhase(config, runtime) {
    return new Promise(function (resolve) {
      var transferName = config.direction === "upload" ? "上传" : "下载";
      var startedAt = runtime.now();
      var deadline = startedAt + config.durationMs;
      var active = 0, scheduledBytes = 0, completedBytes = 0, requests = 0, successful = 0;
      var finished = false, halted = false, retired = 0;
      var lastProgress = startedAt;
      var samples = [], errors = [], requestReports = [];
      var token = String(startedAt) + "-" + String(runtime.random ? runtime.random() : Math.random()).slice(2);
      var phaseName = config.phase === "warmup" ? "预热" : "正式测速";
      // Complete-body callbacks can otherwise buffer N large chunks at once.
      var chunkLimit = config.adaptive ? Math.min(config.chunkBytes, Math.floor(4000000 / config.concurrency)) : config.chunkBytes;
      var minChunk = Math.min(16000, chunkLimit);
      var nextChunk = Math.min(chunkLimit, config.initialChunkBytes || 64000);
      var rateEstimate = null;
      var fastestMs = null;
      var baseTargetMs = config.direction === "upload" ? 500 : 750;
      var targetMs = baseTargetMs;
      var retiredWorkers = {};
      function log(text) { if (runtime.log) runtime.log(text); }
      function finish(incomplete) {
        if (finished) return;
        finished = true;
        var elapsedMs = Math.max(1, runtime.now() - startedAt);
        var state = incomplete ? "incomplete" : errors.length ? "failed" : successful ? "ok" : "failed";
        if (!successful && !errors.length) errors.push("没有获得可用" + transferName + "样本");
        var warnings = [];
        var drainMs = Math.max(0, elapsedMs - config.durationMs);
        if (config.phase !== "warmup" && state === "ok" && elapsedMs < 2000) warnings.push("正式样本不足 2 秒；可提高数据预算后复测");
        if (config.phase !== "warmup" && drainMs > 1000) warnings.push("收尾等待 " + (drainMs / 1000).toFixed(1) + " 秒，已计入平均速度");
        if (incomplete) requestReports.forEach(function (report) { if (report.state === "pending") { report.state = "unresolved"; report.errorKind = "callback-timeout"; report.elapsedMs = runtime.now() - startedAt - report.startMs; } });
        var result = {
          state: state, direction: config.direction, phase: config.phase, node: config.node, source: config.testUrl, testSource: config.testSource, concurrency: config.concurrency,
          alpn: config.alpn, adaptive: config.adaptive, startedAt: startedAt, elapsedMs: elapsedMs, targetDurationMs: config.durationMs, drainMs: drainMs,
          budgetBytes: config.maxBytes, scheduledBytes: scheduledBytes, completedBytes: completedBytes,
          requests: requests, successfulRequests: successful, unresolvedRequests: active,
          bytesPerSecond: state === "ok" ? completedBytes * 1000 / elapsedMs : null,
          stopReason: incomplete ? "callback-timeout" : errors.length ? "error" : scheduledBytes >= config.maxBytes ? "budget" : "duration",
          errors: errors, warnings: warnings, samples: samples, requestReports: requestReports, nextChunkBytes: nextChunk
        };
        log(modeLabel(config.concurrency) + transferName + phaseName + "结束 | " + state + " | 成功 " + successful + "/" + requests + " | 未回调 " + active + " | 确认数据 " + (completedBytes / MB).toFixed(2) + " MB | 耗时 " + (elapsedMs / 1000).toFixed(2) + "s | 收尾 " + (drainMs / 1000).toFixed(2) + "s");
        if (config.phase !== "warmup" && result.bytesPerSecond != null) log("正式平均应用层" + transferName + "速度：" + formatRate(result.bytesPerSecond));
        resolve(result);
      }
      function maybeFinish() {
        if (active === 0 && (halted || retired === config.concurrency || runtime.now() >= deadline || scheduledBytes >= config.maxBytes)) finish(false);
      }
      function retire(worker) {
        if (!retiredWorkers[worker]) { retiredWorkers[worker] = true; retired += 1; }
        maybeFinish();
      }
      function launch(worker) {
        if (finished || halted || runtime.now() >= deadline || scheduledBytes >= config.maxBytes) { maybeFinish(); return; }
        var remaining = deadline - runtime.now();
        if (config.adaptive && requests > 0 && remaining < Math.max(100, Math.min(1000, fastestMs || 100))) { retire(worker); return; }
        var size = config.adaptive ? nextChunk : config.chunkBytes;
        if (config.adaptive && rateEstimate != null) size = Math.min(size, Math.max(minChunk, Math.floor(rateEstimate * remaining * 0.6)));
        var bytes = Math.min(size, config.maxBytes - scheduledBytes);
        scheduledBytes += bytes;
        active += 1; requests += 1;
        var requestId = requests;
        var requestStart = runtime.now();
        var report = { requestId: requestId, worker: worker, bytes: bytes, startMs: requestStart - startedAt, state: "pending" };
        requestReports.push(report);
        var spec = {
          method: config.direction === "upload" ? "POST" : "GET", direction: config.direction, phase: config.phase,
          url: config.direction === "upload" ? config.testUrl : config.testSource === "cf" ? config.testUrl + "?bytes=" + bytes + "&loon_test=" + token + "-" + requestId : config.testUrl,
          headers: config.direction === "upload" ? Object.assign({ "Content-Type": "application/octet-stream" }, config.testSource === "cf" ? { "User-Agent": "Mozilla/5.0", "Origin": "https://speed.cloudflare.com" } : {}) : config.testSource === "cf" ? {} : { Range: "bytes=0-" + (bytes - 1) },
          body: config.direction === "upload" ? config.uploadBody.subarray(0, bytes) : undefined,
          node: config.node, timeout: config.adaptive && config.phase !== "warmup" ? Math.min(config.requestTimeoutMs, Math.max(3000, Math.ceil((rateEstimate == null ? targetMs : bytes / rateEstimate) * 4))) : config.requestTimeoutMs, alpn: config.alpn,
          bytes: bytes, worker: worker, requestId: requestId
        };
        log(phaseName + " #" + requestId + " 发出 | " + spec.method + " | " + bytes + " B | " + config.alpn + " | 超时 " + spec.timeout + "ms");
        // This deadline never pretends to cancel the underlying request. If it
        // does not call back, the whole run stops with unresolvedRequests > 0.
        runtime.setTimeout(function () {
          if (!finished && report.state === "pending") {
            halted = true;
            report.state = "unresolved";
            report.errorKind = "callback-timeout";
            report.elapsedMs = runtime.now() - requestStart;
            errors.push("请求 #" + requestId + " 未按时回调；传输量未知，已停止后续测量");
            finish(true);
          }
        }, spec.timeout + 1000);
        Promise.resolve().then(function () { return runtime.request(spec); }).then(function (response) {
          if (finished) return;
          report.status = response && response.status;
          var transferred;
          if (config.direction === "upload") {
            if (!response || (response.status !== 200 && response.status !== 204)) throw new Error("上传 HTTP " + (response ? response.status : "无响应"));
            if (config.testSource === "apple" && response.uploadBytes !== spec.body.byteLength) throw new Error("Apple 上传字节回执不符：期望 " + spec.body.byteLength + "，实际 " + (response.uploadBytes == null ? "缺少 Bytes 回执" : response.uploadBytes));
            transferred = spec.body.byteLength;
          } else {
            if (config.testSource === "cf") { if (!response || response.status !== 200) throw new Error("HTTP " + (response ? response.status : "无响应")); }
            else validateRange(response, bytes);
            if (!response.binary) throw new Error("响应不是 Uint8Array；请检查 binary-mode 与 Loon 版本");
            if (response.bytes !== bytes) throw new Error("响应字节数不符：期望 " + bytes + "，实际 " + response.bytes);
            transferred = response.bytes;
          }
          var elapsed = Math.max(1, runtime.now() - requestStart);
          report.state = "ok";
          completedBytes += transferred; successful += 1;
          samples.push({ requestId: requestId, worker: worker, bytes: transferred, startMs: requestStart - startedAt, endMs: runtime.now() - startedAt });
          if (config.adaptive) {
            var rate = transferred / elapsed;
            rateEstimate = rateEstimate == null ? rate : rateEstimate * 0.7 + rate * 0.3;
            fastestMs = fastestMs == null ? elapsed : Math.min(fastestMs, elapsed);
            // A fixed sub-RTT target would trap high-latency paths in tiny blocks.
            // Allow longer useful transfers while keeping bounded end-of-window tails.
            targetMs = Math.max(baseTargetMs, Math.min(1500, fastestMs * 3, config.durationMs / 3));
            nextChunk = Math.max(minChunk, Math.min(chunkLimit, Math.floor(Math.min(bytes * 2, Math.max(bytes / 2, rateEstimate * targetMs)))));
          }
          if (runtime.now() - lastProgress >= 1000) {
            lastProgress = runtime.now();
            log(modeLabel(config.concurrency) + transferName + phaseName + " | " + ((runtime.now() - startedAt) / 1000).toFixed(1) + "s | 已确认 " + (completedBytes / MB).toFixed(2) + " MB（完成回调统计，非逐秒速率）");
          }
        }).catch(function (error) {
          if (finished) return;
          halted = true; report.state = "failed";
          report.error = String(error.message || error);
          report.errorKind = /timeout|timed out|超时/i.test(report.error) ? "timeout" : /socket closed|reset|ECONN/i.test(report.error) ? "connection" : report.status >= 400 ? "http" : /protocol error|ERR_HTTP2|ALPN|协议错误/i.test(report.error) ? "protocol" : /Range|字节|Uint8Array/i.test(report.error) ? "invalid-response" : "network";
          errors.push("请求 #" + requestId + "：" + report.error);
        }).then(function () {
          if (finished) return;
          report.endMs = runtime.now() - startedAt; report.elapsedMs = runtime.now() - requestStart;
          log(phaseName + " #" + requestId + " " + report.state + " | " + report.elapsedMs + "ms | HTTP " + (report.status || "无响应") + (report.error ? " | " + report.error : ""));
          active -= 1; launch(worker);
        });
      }
      log("开始" + modeLabel(config.concurrency) + transferName + phaseName + " | 目标：" + config.node);
      log("源：" + config.testUrl + " | " + config.alpn + " | " + (config.adaptive ? "自适应" : "固定分块") + " | 窗口 " + (config.durationMs / 1000) + "s | 预算 " + (config.maxBytes / MB) + " MB | 分块上限 " + config.chunkBytes + " B");
      runtime.setTimeout(function () { if (!finished) { if (active) log(phaseName + "窗口结束，等待 " + active + " 个在途请求；收尾计入均值"); maybeFinish(); } }, config.durationMs);
      for (var worker = 0; worker < config.concurrency; worker += 1) {
        if (config.adaptive && worker > 0) (function (index) { runtime.setTimeout(function () { launch(index); }, index * 150); })(worker);
        else launch(worker);
      }
    });
  }

  async function runDirection(options, runtime) {
    if (options.direction === "upload") options = Object.assign({}, options, { testUrl: options.uploadUrl, testSource: options.uploadSource, chunkBytes: options.uploadChunkBytes });
    options = Object.assign({}, options, { alpn: /^http:\/\//i.test(options.testUrl) ? "h1" : options.httpVersion === "h1" ? "h1" : "h2" });
    if (!options.node) throw new Error("测速必须指定目标 node");
    var recoveryLeft = options.adaptive ? 1 : 0;
    function fallback() { if (options.httpVersion === "auto") options.alpn = "h1"; recoveryLeft -= 1; }
    var sourceInfo;
    try { sourceInfo = await preflight(options, runtime); }
    catch (error) {
      if (!recoveryLeft || !recoverable({ state: "failed", unresolvedRequests: error.unresolvedRequests || 0, errors: [String(error.message || error)] })) throw error;
      if (runtime.log) runtime.log("HEAD 明确失败，尝试一次兼容检查：" + String(error.message || error));
      fallback(); sourceInfo = await preflight(options, runtime);
    }
    var levels = options.mode === "compare" ? [1, options.concurrency] : [options.mode === "single" ? 1 : options.concurrency];
    var runs = [];
    for (var i = 0; i < levels.length; i += 1) {
      var phaseBudget = Math.floor(options.maxBytes / levels.length);
      var warmup = null, discarded = [], used = 0, recovered = false;
      if (options.warmupMs > 0) {
        var warmupBudget = options.adaptive ? Math.min(1000000, Math.floor(phaseBudget / 8)) : Math.floor(phaseBudget / 4);
        var warmupConcurrency = options.adaptive ? 1 : levels[i];
        warmup = await runPhase(Object.assign({}, options, {
          phase: "warmup", concurrency: warmupConcurrency, durationMs: options.warmupMs, maxBytes: warmupBudget,
          initialChunkBytes: 64000, chunkBytes: Math.min(options.chunkBytes, options.adaptive ? 256000 : Math.max(1, Math.floor(warmupBudget / levels[i])))
        }), runtime);
        used += warmup.scheduledBytes;
        if (warmup.state !== "ok" && recoveryLeft && recoverable(warmup) && phaseBudget - used >= 16000) {
          discarded.push(warmup); fallback(); recovered = true;
          if (runtime.log) runtime.log("预热已回调结束，改用小块单路做一次恢复探测；旧数据不计正式速度");
          warmup = await runPhase(Object.assign({}, options, { phase: "warmup", concurrency: 1, durationMs: 1000, maxBytes: 16000, chunkBytes: 16000, initialChunkBytes: 16000 }), runtime);
          used += warmup.scheduledBytes;
        }
      }
      var result;
      if (warmup && warmup.state !== "ok") {
        result = Object.assign({}, warmup, { phase: "measurement", concurrency: levels[i], elapsedMs: 0, drainMs: 0, completedBytes: 0, scheduledBytes: 0, requests: 0, successfulRequests: 0, unresolvedRequests: 0, samples: [], requestReports: [], bytesPerSecond: null, targetDurationMs: options.durationMs, stopReason: "warmup-error", errors: ["预热未完成，未开始正式测量"].concat(warmup.errors) });
      } else {
        result = await runPhase(Object.assign({}, options, {
          phase: "measurement", concurrency: levels[i], maxBytes: phaseBudget - used,
          initialChunkBytes: warmup && options.adaptive ? Math.max(16000, Math.floor(warmup.nextChunkBytes / levels[i])) : 64000
        }), runtime);
        used += result.scheduledBytes;
        var remainingMs = options.durationMs - result.elapsedMs;
        if (result.state !== "ok" && recoveryLeft && recoverable(result) && remainingMs >= 2000 && phaseBudget - used >= 16000) {
          discarded.push(result); fallback(); recovered = true;
          var lowerConcurrency = Math.max(1, Math.floor(levels[i] / 2));
          if (runtime.log) runtime.log("正式阶段已明确结束，降低并发为 " + lowerConcurrency + " 后独立重测一次；失败阶段不计新速度");
          result = await runPhase(Object.assign({}, options, { phase: "measurement", concurrency: lowerConcurrency, durationMs: remainingMs, maxBytes: phaseBudget - used, initialChunkBytes: 16000, chunkBytes: Math.min(options.chunkBytes, 256000) }), runtime);
          used += result.scheduledBytes;
        }
      }
      result.warmup = warmup; result.discardedPhases = discarded; result.requestedConcurrency = levels[i]; result.recovered = recovered;
      result.totalElapsedMs = result.elapsedMs + (warmup ? warmup.elapsedMs : 0) + discarded.reduce(function (sum, phase) { return sum + phase.elapsedMs; }, 0);
      result.totalCompletedBytes = result.completedBytes + (warmup ? warmup.completedBytes : 0) + discarded.reduce(function (sum, phase) { return sum + phase.completedBytes; }, 0);
      result.totalScheduledBytes = used; result.budgetBytes = phaseBudget;
      if (recovered) result.warnings.unshift("已降低负载重测，当前最多 " + result.concurrency + " 路；详情见日志");
      runs.push(result);
      if (result.state !== "ok") break;
    }
    return {
      version: "0.4.0", direction: options.direction, mode: options.mode, node: options.node, nodeProtocol: options.nodeProtocol || null, source: options.testUrl, testSource: options.testSource, sourceInfo: sourceInfo,
      state: runs.length === levels.length && runs.every(function (result) { return result.state === "ok"; }) ? "ok" : "failed",
      budgetBytes: options.maxBytes, runs: runs,
      comparisonRatio: runs.length === 2 && runs.every(function (result) { return result.state === "ok"; }) && runs[1].alpn === runs[0].alpn && runs[1].concurrency > runs[0].concurrency && runs[0].bytesPerSecond > 0 ? runs[1].bytesPerSecond / runs[0].bytesPerSecond : null
    };
  }

  async function run(options, runtime) {
    if (!options.node) throw new Error("测速必须指定目标 node");
    var directions = options.direction === "both" ? ["download", "upload"] : [options.direction];
    var uploadBody;
    if (directions.indexOf("upload") >= 0) {
      uploadBody = new Uint8Array(options.uploadChunkBytes);
      var seed = 0x6d2b79f5;
      for (var n = 0; n < uploadBody.length; n += 1) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        uploadBody[n] = seed & 255;
      }
    }
    if (directions.length === 1) return runDirection(Object.assign({}, options, { uploadBody: uploadBody }), runtime);
    var parts = [];
    for (var i = 0; i < directions.length; i += 1) {
      var direction = directions[i];
      try {
        parts.push(await runDirection(Object.assign({}, options, {
          direction: direction, maxBytes: Math.floor(options.maxBytes / directions.length), uploadBody: uploadBody
        }), runtime));
      } catch (error) {
        parts.push({ state: "failed", runs: [{ direction: direction, concurrency: options.mode === "concurrent" ? options.concurrency : 1,
          testSource: direction === "upload" ? options.uploadSource : options.testSource, state: "failed", bytesPerSecond: null,
          completedBytes: 0, elapsedMs: 0, totalCompletedBytes: 0, totalElapsedMs: 0, totalScheduledBytes: 0,
          unresolvedRequests: error.unresolvedRequests || 0, stopReason: "error", warnings: [], errors: [String(error.message || error)] }] });
      }
      var last = parts[parts.length - 1];
      if (last.runs.some(function (item) { return item.unresolvedRequests > 0 || item.warmup && item.warmup.unresolvedRequests > 0; })) break;
    }
    var runs = [].concat.apply([], parts.map(function (part) { return part.runs; }));
    var ok = parts.length === directions.length && parts.every(function (part) { return part.state === "ok"; });
    return { version: "0.4.0", direction: "both", mode: options.mode, node: options.node, nodeProtocol: options.nodeProtocol || null,
      testSource: options.testSource, uploadSource: options.uploadSource, source: options.testUrl, uploadUrl: options.uploadUrl,
      state: ok ? "ok" : runs.some(function (item) { return item.state === "ok"; }) ? "partial" : "failed",
      budgetBytes: options.maxBytes, runs: runs, comparisonRatio: null };
  }

  function summary(result) {
    var lines = ["节点速度测试 · " + result.node, result.direction === "both" ? "下载源：" + sourceLabel(result.testSource) + " · 上传源：" + sourceLabel(result.uploadSource) : "测速源：" + sourceLabel(result.testSource)];
    lines.splice(1, 0, "节点协议：" + (result.nodeProtocol || "未知"));
    result.runs.forEach(function (item) {
      lines.push(modeLabel(item.concurrency) + (item.direction === "upload" ? "上传" : "下载") + " · " + sourceLabel(item.testSource) + "：" + (item.state === "ok" ? formatRate(item.bytesPerSecond) : "无有效速度结果（" + item.state + "）"));
      lines.push("测量数据 " + (item.completedBytes / MB).toFixed(2) + " MB · 测量耗时 " + (item.elapsedMs / 1000).toFixed(2) + " 秒");
      if (item.warmup) lines.push("预热 " + (item.warmup.completedBytes / MB).toFixed(2) + " MB · " + (item.warmup.elapsedMs / 1000).toFixed(2) + " 秒（不计平均速度）");
      lines.push(stopReasonLabel(item.stopReason));
      if (item.errors.length) lines.push(item.errors.join("\n"));
      if (item.warnings.length) lines.push(item.warnings.join("\n"));
    });
    if (result.comparisonRatio != null) lines.push("本次并发/单路：" + result.comparisonRatio.toFixed(2) + " 倍（顺序采样，仅供参考）");
    return lines.join("\n");
  }

  function stopReasonLabel(reason) {
    return { duration: "已达到测量时长", budget: "已达到数据预算", error: "传输出现异常", "callback-timeout": "传输回调超时", "warmup-error": "预热未完成" }[reason] || "测试结束";
  }

  return { parseArgument: parseArgument, normalizeOptions: normalizeOptions, resolveTarget: resolveTarget, resolveNodeProtocol: resolveNodeProtocol, formatRate: formatRate, run: run, summary: summary, stopReasonLabel: stopReasonLabel };
});
