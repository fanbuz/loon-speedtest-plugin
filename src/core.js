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
    return {
      direction: direction,
      uploadUrl: uploadUrl,
      uploadSource: uploadSource,
      mode: mode,
      node: (raw.node || "").trim(),
      testSource: testSource,
      testUrl: testUrl,
      concurrency: numberOption(raw.concurrency, 4, 2, 8, "concurrency", true),
      durationMs: numberOption(raw.duration, 10, 3, 30, "duration", true) * 1000,
      chunkBytes: numberOption(raw.chunkKB, 1000, 64, 4000, "chunkKB", true) * 1000,
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
        return runtime.request({ method: "HEAD", url: options.testUrl, node: options.node, timeout: options.requestTimeoutMs, bytes: 0, headers: {} });
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

  function runPhase(config, runtime) {
    return new Promise(function (resolve) {
      var transferName = config.direction === "upload" ? "上传" : "下载";
      var startedAt = runtime.now();
      var deadline = startedAt + config.durationMs;
      var active = 0;
      var scheduledBytes = 0;
      var completedBytes = 0;
      var requests = 0;
      var successful = 0;
      var finished = false;
      var halted = false;
      var lastProgress = startedAt;
      var samples = [];
      var errors = [];
      var token = String(startedAt) + "-" + String(runtime.random ? runtime.random() : Math.random()).slice(2);
      var phaseName = config.phase === "warmup" ? "预热" : "正式测速";

      function log(text) { if (runtime.log) runtime.log(text); }

      function finish(incomplete) {
        if (finished) return;
        finished = true;
        var elapsedMs = Math.max(1, runtime.now() - startedAt);
        var state = incomplete ? "incomplete" : errors.length ? "failed" : successful ? "ok" : "failed";
        if (!successful && !errors.length) errors.push("没有获得可用" + transferName + "样本");
        var warnings = [];
        if (config.phase !== "warmup" && state === "ok" && elapsedMs < 2000) warnings.push("正式样本不足 2 秒；可提高数据预算后复测");
        var result = {
          state: state, direction: config.direction, phase: config.phase, node: config.node, source: config.testUrl, testSource: config.testSource, concurrency: config.concurrency,
          startedAt: startedAt, elapsedMs: elapsedMs, targetDurationMs: config.durationMs,
          budgetBytes: config.maxBytes, scheduledBytes: scheduledBytes,
          completedBytes: completedBytes, requests: requests, successfulRequests: successful,
          unresolvedRequests: active, bytesPerSecond: state === "ok" ? completedBytes * 1000 / elapsedMs : null,
          stopReason: incomplete ? "callback-timeout" : errors.length ? "error" : scheduledBytes >= config.maxBytes ? "budget" : "duration",
          errors: errors, warnings: warnings, samples: samples
        };
        log(modeLabel(config.concurrency) + transferName + phaseName + "结束 | " + state + " | 有效数据 " + (completedBytes / MB).toFixed(2) + " MB | 耗时 " + (elapsedMs / 1000).toFixed(2) + "s");
        if (config.phase !== "warmup" && result.bytesPerSecond != null) log("正式平均应用层" + transferName + "速度：" + formatRate(result.bytesPerSecond));
        resolve(result);
      }

      function maybeFinish() {
        if (active === 0 && (halted || runtime.now() >= deadline || scheduledBytes >= config.maxBytes)) finish(false);
      }

      function launch(worker) {
        if (finished || halted || runtime.now() >= deadline || scheduledBytes >= config.maxBytes) {
          maybeFinish();
          return;
        }
        var bytes = Math.min(config.chunkBytes, config.maxBytes - scheduledBytes);
        scheduledBytes += bytes; // Reserve before launch; failures never refund the budget.
        active += 1;
        requests += 1;
        var requestId = requests;
        var requestStart = runtime.now();
        var spec = {
          method: config.direction === "upload" ? "POST" : "GET",
          direction: config.direction, phase: config.phase,
          url: config.direction === "upload" ? config.testUrl : config.testSource === "cf" ? config.testUrl + "?bytes=" + bytes + "&loon_test=" + token + "-" + requestId : config.testUrl,
          headers: config.direction === "upload" ? Object.assign({ "Content-Type": "application/octet-stream" }, config.testSource === "cf" ? { "User-Agent": "Mozilla/5.0", "Origin": "https://speed.cloudflare.com" } : {}) : config.testSource === "cf" ? {} : { Range: "bytes=0-" + (bytes - 1) },
          body: config.direction === "upload" ? config.uploadBody.subarray(0, bytes) : undefined,
          node: config.node, timeout: config.requestTimeoutMs,
          bytes: bytes, worker: worker, requestId: requestId
        };
        Promise.resolve().then(function () { return runtime.request(spec); }).then(function (response) {
          if (finished) return;
          var transferred;
          if (config.direction === "upload") {
            // Always count the binary request payload, never the small response body.
            if (!response || (response.status !== 200 && response.status !== 204)) throw new Error("上传 HTTP " + (response ? response.status : "无响应"));
            if (config.testSource === "apple" && response.uploadBytes !== spec.body.byteLength) {
              throw new Error("Apple 上传字节回执不符：期望 " + spec.body.byteLength + "，实际 " + (response.uploadBytes == null ? "缺少 Bytes 回执" : response.uploadBytes));
            }
            transferred = spec.body.byteLength;
          } else {
            if (config.testSource === "cf") {
              if (!response || response.status !== 200) throw new Error("HTTP " + (response ? response.status : "无响应"));
            } else validateRange(response, bytes);
            if (!response.binary) throw new Error("响应不是 Uint8Array；请检查 binary-mode 与 Loon 版本");
            if (response.bytes !== bytes) throw new Error("响应字节数不符：期望 " + bytes + "，实际 " + response.bytes);
            transferred = response.bytes;
          }
          completedBytes += transferred;
          successful += 1;
          samples.push({ requestId: requestId, worker: worker, bytes: transferred, startMs: requestStart - startedAt, endMs: runtime.now() - startedAt });
          if (runtime.now() - lastProgress >= 1000) {
            lastProgress = runtime.now();
            log(modeLabel(config.concurrency) + transferName + phaseName + " | " + ((runtime.now() - startedAt) / 1000).toFixed(1) + "s | 已完成 " + (completedBytes / MB).toFixed(2) + " MB（完成回调统计，非逐秒速率）");
          }
        }).catch(function (error) {
          if (finished) return;
          halted = true;
          errors.push("请求 #" + requestId + "：" + String(error.message || error));
          log(errors[errors.length - 1]);
        }).then(function () {
          if (finished) return;
          active -= 1;
          launch(worker);
        });
      }

      log("开始" + modeLabel(config.concurrency) + transferName + phaseName + " | 目标：" + config.node);
      log("源：" + config.testUrl + " | 发请求窗口 " + (config.durationMs / 1000) + "s | 请求数据预算 " + (config.maxBytes / MB) + " MB");
      // No clearTimeout/setInterval dependency; Loon releases timers at $done().
      runtime.setTimeout(function () {
        if (!finished) {
          if (active) log(phaseName + "已达到发请求时长，等待 " + active + " 个在途请求结束");
          maybeFinish();
        }
      }, config.durationMs);
      runtime.setTimeout(function () {
        if (!finished) {
          halted = true;
          errors.push("在途请求未按时回调；部分传输量未知，本轮无有效速度结果");
          finish(true);
        }
      }, config.durationMs + config.requestTimeoutMs + 1000);
      for (var worker = 0; worker < config.concurrency; worker += 1) launch(worker);
    });
  }

  async function runDirection(options, runtime) {
    if (options.direction === "upload") options = Object.assign({}, options, { testUrl: options.uploadUrl, testSource: options.uploadSource });
    if (!options.node) throw new Error("测速必须指定目标 node");
    var sourceInfo = await preflight(options, runtime);
    var levels = options.mode === "compare" ? [1, options.concurrency] : [options.mode === "single" ? 1 : options.concurrency];
    var runs = [];
    for (var i = 0; i < levels.length; i += 1) {
      var phaseBudget = Math.floor(options.maxBytes / levels.length);
      var warmup = null;
      if (options.warmupMs > 0) {
        var warmupBudget = Math.floor(phaseBudget / 4);
        warmup = await runPhase(Object.assign({}, options, {
          phase: "warmup", concurrency: levels[i], durationMs: options.warmupMs, maxBytes: warmupBudget,
          chunkBytes: Math.min(options.chunkBytes, Math.max(1, Math.floor(warmupBudget / levels[i])))
        }), runtime);
      }
      var result;
      if (warmup && warmup.state !== "ok") {
        result = Object.assign({}, warmup, {
          phase: "measurement", elapsedMs: 0, completedBytes: 0, scheduledBytes: 0,
          requests: 0, successfulRequests: 0, unresolvedRequests: 0, samples: [], bytesPerSecond: null,
          targetDurationMs: options.durationMs, stopReason: "warmup-error", errors: ["预热未完成，未开始正式测量"].concat(warmup.errors)
        });
      } else {
        result = await runPhase(Object.assign({}, options, {
          phase: "measurement", concurrency: levels[i], maxBytes: phaseBudget - (warmup ? warmup.scheduledBytes : 0)
        }), runtime);
      }
      result.warmup = warmup;
      result.totalElapsedMs = result.elapsedMs + (warmup ? warmup.elapsedMs : 0);
      result.totalCompletedBytes = result.completedBytes + (warmup ? warmup.completedBytes : 0);
      result.totalScheduledBytes = result.scheduledBytes + (warmup ? warmup.scheduledBytes : 0);
      result.budgetBytes = phaseBudget;
      runs.push(result);
      // A failed/timed-out phase cannot safely or fairly precede another phase.
      if (result.state !== "ok") break;
    }
    return {
      version: "0.3.1", direction: options.direction, mode: options.mode, node: options.node, nodeProtocol: options.nodeProtocol || null, source: options.testUrl, testSource: options.testSource, sourceInfo: sourceInfo,
      state: runs.length === levels.length && runs.every(function (result) { return result.state === "ok"; }) ? "ok" : "failed",
      budgetBytes: options.maxBytes, runs: runs,
      comparisonRatio: runs.length === 2 && runs.every(function (result) { return result.state === "ok"; }) && runs[0].bytesPerSecond > 0 ? runs[1].bytesPerSecond / runs[0].bytesPerSecond : null
    };
  }

  async function run(options, runtime) {
    if (!options.node) throw new Error("测速必须指定目标 node");
    var directions = options.direction === "both" ? ["download", "upload"] : [options.direction];
    var uploadBody;
    if (directions.indexOf("upload") >= 0) {
      uploadBody = new Uint8Array(options.chunkBytes);
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
    return { version: "0.3.1", direction: "both", mode: options.mode, node: options.node, nodeProtocol: options.nodeProtocol || null,
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
