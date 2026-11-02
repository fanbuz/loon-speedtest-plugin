/* Shared engine. No browser APIs and no Loon globals in this file. */
(function (root, factory) {
  // A host may wrap the bundle in a function; injected var is then lexical,
  // not a property of globalThis. Read the same-scope binding directly.
  var metadata = typeof module === "object" && module.exports ? require("./metadata.js") : LoonSpeedtestMetadata;
  var api = factory(metadata);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.LoonSpeedtest = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (metadata) {
  "use strict";

  var SOURCE = "https://speed.cloudflare.com/__down";
  var UPLOAD_SOURCE = "https://speed.cloudflare.com/__up";
  var APPLE_SOURCE = "https://mensura.cdn-apple.com/api/v1/gm/large";
  var APPLE_UPLOAD_SOURCE = "https://mensura.cdn-apple.com/api/v1/gm/slurp";
  var MB = 1000000;
  // 完整响应回调会同时持有多个分块；这些上限与起始值的单位均为字节。
  var MAX_INFLIGHT_BUFFER_BYTES = 4000000;
  var MIN_ADAPTIVE_CHUNK_BYTES = 16000;
  var INITIAL_ADAPTIVE_CHUNK_BYTES = 64000;
  var RECOVERY_CHUNK_BYTES = 16000;
  // 自适应请求的错峰、目标传输时间与最短超时，单位为毫秒。
  var WORKER_STAGGER_MS = 150;
  var DOWNLOAD_TARGET_MS = 750;
  var UPLOAD_TARGET_MS = 500;
  var MIN_ADAPTIVE_TIMEOUT_MS = 3000;
  var ADAPTIVE_TIMEOUT_FACTOR = 4;
  // 估速采用历史/当前样本加权；尾块只使用剩余窗口的一部分。
  var RATE_HISTORY_WEIGHT = 0.7;
  var RATE_SAMPLE_WEIGHT = 0.3;
  var REMAINING_WINDOW_FACTOR = 0.6;

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

  function customUrl(value, message) {
    if (typeof value !== "string" || !/^https?:\/\/[^\s/?#@]+(?:[/?][^\s#]*)?$/i.test(value.trim())) {
      throw new Error(message);
    }
    return value.trim();
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
      testUrl = customUrl(raw.test_url, "选择自定义时请填写有效的 HTTP(S) test_url（不能含 URL 用户信息或片段）");
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
      uploadUrl = customUrl(raw.upload_url, "upload_url 需要有效的 HTTP(S) POST 接收地址");
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
  function resolveTargetDetails(explicit, environment) {
    var params = environment && environment.params || {};
    var configured = typeof explicit === "string" ? explicit.trim() : "";
    var entryNode = typeof params.node === "string" ? params.node.trim() : "";
    var entryGroup = typeof params.policyGroup === "string" ? params.policyGroup.trim() : "";
    var entryTarget = entryNode || entryGroup || null;
    if (configured) return { node: configured, source: "configuration", conflict: !!entryTarget && configured !== entryTarget, entryTarget: entryTarget };
    if (entryTarget) return { node: entryTarget, source: entryNode ? "entry-node" : "entry-policy-group", conflict: false, entryTarget: entryTarget };
    throw new Error("未指定测速目标：请填写 node，或从提供节点/策略组名称的入口运行；直连请明确填写 DIRECT");
  }

  function resolveTarget(explicit, environment) { return resolveTargetDetails(explicit, environment).node; }

  function resolveNodeProtocolDetails(target, environment) {
    if (target === "DIRECT") return { protocol: "直连", reason: "direct" };
    var params = environment && environment.params || {};
    function unknown(reason) { return { protocol: null, reason: reason }; }
    var type;
    try {
      var entryNode = params.node;
      if (typeof entryNode === "string" && entryNode.trim() && entryNode.trim() !== target) return unknown("entry-mismatch");
      var info = params.nodeInfo;
      // Only read name first, then type after the target matches. Never copy or
      // serialize nodeInfo; even unrelated getters may contain sensitive data.
      if (info == null || info === "") return unknown("missing-metadata");
      if (typeof info === "string") {
        try { info = JSON.parse(info); } catch (_) { return unknown("invalid-json"); }
      }
      if (!info || typeof info !== "object" || Array.isArray(info)) return unknown("invalid-metadata");
      var name = info.name;
      if (typeof name !== "string" || !name.trim()) return unknown("invalid-name");
      if (name.trim() !== target) return unknown("name-mismatch");
      type = info.type;
      if (typeof type !== "string" || !type.trim()) return unknown("invalid-type");
    } catch (_) {
      return unknown("invalid-metadata");
    }
    var types = {
      shadowsocks: "Shadowsocks", ss: "Shadowsocks", shadowsocksr: "ShadowsocksR", ssr: "ShadowsocksR",
      vmess: "VMess", vless: "VLESS", trojan: "Trojan", hysteria: "Hysteria", hysteria2: "Hysteria2", hy2: "Hysteria2",
      tuic: "TUIC", tuicv5: "TUIC v5", snell: "Snell", socks5: "SOCKS5", http: "HTTP", https: "HTTPS", wireguard: "WireGuard", ssh: "SSH", anytls: "AnyTLS"
    };
    var key = type.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(types, key) ? { protocol: types[key], reason: "recognized" } : unknown("unsupported-type");
  }

  function resolveNodeProtocol(target, environment) { return resolveNodeProtocolDetails(target, environment).protocol; }

  function targetNotice(result) {
    return result && result.targetConflict ? "实际测试 " + String(result.node).replace(/[\r\n\u2028\u2029]+/g, " ") + "，来自插件配置" : "";
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

  // 只构造请求；预算预留、请求体切片和超时决策由调用方显式传入。
  function buildRequestSpec(input) {
    if (input.method === "HEAD") {
      return { method: "HEAD", url: input.url, node: input.node, timeout: input.timeout, bytes: 0, headers: {}, alpn: input.alpn };
    }
    var upload = input.direction === "upload";
    var spec = {
      method: upload ? "POST" : "GET", direction: input.direction, phase: input.phase,
      url: input.url, headers: {}, body: undefined,
      node: input.node, timeout: input.timeout, alpn: input.alpn,
      bytes: input.bytes, worker: input.worker, requestId: input.requestId
    };
    if (upload) {
      spec.headers["Content-Type"] = "application/octet-stream";
      if (input.source === "cf") {
        spec.headers["User-Agent"] = "Mozilla/5.0";
        spec.headers.Origin = "https://speed.cloudflare.com";
      }
      spec.body = input.body;
    } else if (input.source === "cf") {
      spec.url += "?bytes=" + input.bytes + "&loon_test=" + input.token + "-" + input.requestId;
    } else {
      spec.headers.Range = "bytes=0-" + (input.bytes - 1);
    }
    return spec;
  }

  function requestTimeout(config, bytes, rateEstimate, targetMs) {
    if (!config.adaptive || config.phase === "warmup") return config.requestTimeoutMs;
    var estimatedMs = rateEstimate == null ? targetMs : bytes / rateEstimate;
    var adaptiveTimeout = Math.max(MIN_ADAPTIVE_TIMEOUT_MS, Math.ceil(estimatedMs * ADAPTIVE_TIMEOUT_FACTOR));
    return Math.min(config.requestTimeoutMs, adaptiveTimeout);
  }

  function classifyError(error, status, alpn) {
    var message = String(error && error.message || error || "");
    var text = message.replace(/^(?:(?:HEAD 检查失败|(?:GET|HEAD|POST) 请求失败|请求 #\d+)：\s*)+/, "").trim();
    function classification(kind, retry) { return { kind: kind, recoverable: retry === true }; }
    if (error && error.unresolvedRequests || /未按时回调|未回调|callback[- ]timeout/i.test(text)) return classification("callback-timeout");
    // Rejection categories take precedence even if the message also says timeout/reset.
    if (/certificate|cert[_ -](?:expired|invalid|verify|authority)|self[- ]signed|trust|证书|信任链|SSL.*(?:verify|validation)/i.test(text)) return classification("certificate");
    if (/\bDNS\b|\bEAI_[A-Z_]+\b|\bENOTFOUND\b|\bgetaddrinfo\b|name resolution|(?:could not|cannot|can't) resolve|host(?:name)? (?:not found|could not be found)|找不到.*(?:主机|服务器)|域名|解析.*(?:失败|超时)|无法解析/i.test(text)) return classification("dns");
    if (/Content-Range|Content-Length|Accept-Ranges|Uint8Array|Bytes 回执|字节|文件大小无效|范围.*(?:无效|不符)/i.test(text)) return classification("invalid-response");
    if (/unauthorized|forbidden|authentication|authorization|too many requests|rate[- ]limit|鉴权|认证失败|限流/i.test(text)) return classification("http");
    var statuses = [], match, pattern = /HTTP\s+(\d{3})(?=\D|$)/ig;
    if (status != null && isFinite(Number(status))) statuses.push(Number(status));
    while ((match = pattern.exec(text))) statuses.push(Number(match[1]));
    if (statuses.some(function (code) { return code >= 400 && [502, 503, 504].indexOf(code) < 0; })) return classification("http");
    if (/unknown|unclassified|invalid (?:argument|parameter|configuration)|unsupported|not supported|permission denied|access denied|\bEACCES\b|\bEPERM\b|未知|参数.*(?:无效|错误)|配置.*(?:无效|错误)|不支持/i.test(text)) return classification("unknown");
    if (statuses.some(function (code) { return [502, 503, 504].indexOf(code) >= 0; })) return classification("http", true);
    if (/需要 HTTP 206|HEAD 206.*无效/i.test(text)) return classification("invalid-response");
    // Loon's known NSError wrapper repeats the same localized description.
    var nativeMessage = /^Error Domain=[A-Za-z][A-Za-z0-9._]* Code=-?\d+ "([^"\n]+)" UserInfo=\{NSLocalizedDescription=([^{}\n]+)\}$/.exec(text);
    if (nativeMessage && nativeMessage[1] === nativeMessage[2]) text = nativeMessage[1];
    // Match complete known messages; an unexplained suffix must not inherit recovery.
    var transport = text.replace(/[.!。]+$/, "").trim();
    if (/^(?:(?:the )?(?:request|connection|connect|read|write|operation|transfer|socket) (?:timed out|timeout)|ETIMEDOUT|timeout|timed out|Node 冒烟请求超时|(?:请求|连接|传输|读取|写入|操作)超时)$/i.test(transport)) return classification("timeout", true);
    if (/^(?:ECONNRESET|(?:connection|network|socket) reset(?: by (?:remote )?peer)?|(?:socket|connection) closed by (?:remote peer|server)|连接被(?:对端关闭|重置)|连接重置)$/i.test(transport)) return classification("connection", true);
    if (/^(?:ERR_HTTP2_(?:ERROR|PROTOCOL_ERROR|STREAM_ERROR|SESSION_ERROR|GOAWAY_SESSION)|HTTP\/?2 protocol error|ALPN (?:mismatch|negotiation failed|no common protocol|no supported protocol)|(?:HTTP2|HTTP\/2|ALPN)\s*协议错误)$/i.test(transport) || alpn === "h2" && /^protocol error$/i.test(transport)) return classification("protocol", true);
    return classification("unknown");
  }

  function preflight(options, runtime, reports) {
    if (options.direction === "upload" || options.testSource === "cf") return Promise.resolve(null);
    if (runtime.log) runtime.log("检查 " + sourceLabel(options.testSource) + " 的范围能力声明（HEAD 不带 Range，不下载正文）");
    return new Promise(function (resolve, reject) {
      var settled = false;
      var report = { direction: options.direction, method: "HEAD", alpn: options.alpn, startedAt: runtime.now(), state: "pending" };
      reports.push(report);
      function settle(error, info) {
        if (settled) return;
        settled = true;
        report.elapsedMs = Math.max(0, runtime.now() - report.startedAt);
        report.state = error ? "failed" : "ok";
        if (error) {
          var classified = classifyError(error, error.status == null ? report.status : error.status, options.alpn);
          report.error = String(error.message || error);
          report.errorKind = classified.kind;
          report.recoverable = classified.recoverable;
          report.unresolvedRequests = error.unresolvedRequests || 0;
        }
        if (runtime.log) runtime.log("HEAD 结束 | " + report.state + " | HTTP 配置 " + report.alpn + " | HTTP " + (report.status || "无响应") + " | " + report.elapsedMs + "ms" + (error ? " | " + report.errorKind + " | " + report.error : ""));
        if (error) reject(error); else resolve(info);
      }
      runtime.setTimeout(function () {
        var error = new Error("测速源分段检查超时；没有发起正文下载"); error.unresolvedRequests = 1; settle(error);
      }, options.requestTimeoutMs + 1000);
      Promise.resolve().then(function () {
        return runtime.request(buildRequestSpec({
          method: "HEAD", url: options.testUrl, node: options.node,
          timeout: options.requestTimeoutMs, alpn: options.alpn
        }));
      }).then(function (response) {
        if (settled) return;
        var status = response && response.status;
        report.status = status;
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
      }).catch(function (error) {
        if (settled) return;
        var failure = new Error("HEAD 检查失败：" + String(error.message || error));
        failure.status = error.status == null ? report.status : error.status;
        report.status = failure.status;
        failure.unresolvedRequests = error.unresolvedRequests || 0;
        settle(failure);
      });
    });
  }

  function recoverable(phase) {
    if (!phase || phase.unresolvedRequests || phase.state === "incomplete") return false;
    var failed = phase.requestReports.filter(function (report) { return report.state === "failed"; });
    return failed.length > 0 && failed.length === phase.errors.length && failed.every(function (report) { return report.recoverable; });
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
      var chunkLimit = config.chunkBytes;
      if (config.adaptive) chunkLimit = Math.min(chunkLimit, Math.floor(MAX_INFLIGHT_BUFFER_BYTES / config.concurrency));
      var minChunk = Math.min(MIN_ADAPTIVE_CHUNK_BYTES, chunkLimit);
      var nextChunk = Math.min(chunkLimit, config.initialChunkBytes || INITIAL_ADAPTIVE_CHUNK_BYTES);
      var rateEstimate = null;
      var fastestMs = null;
      var baseTargetMs = config.direction === "upload" ? UPLOAD_TARGET_MS : DOWNLOAD_TARGET_MS;
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
        if (incomplete) requestReports.forEach(function (report) { if (report.state === "pending") { report.state = "unresolved"; report.errorKind = "callback-timeout"; report.recoverable = false; report.elapsedMs = runtime.now() - startedAt - report.startMs; } });
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
        if (config.adaptive && rateEstimate != null) size = Math.min(size, Math.max(minChunk, Math.floor(rateEstimate * remaining * REMAINING_WINDOW_FACTOR)));
        var bytes = Math.min(size, config.maxBytes - scheduledBytes);
        scheduledBytes += bytes;
        active += 1; requests += 1;
        var requestId = requests;
        var requestStart = runtime.now();
        var report = { requestId: requestId, worker: worker, bytes: bytes, alpn: config.alpn, startMs: requestStart - startedAt, state: "pending" };
        requestReports.push(report);
        var body;
        if (config.direction === "upload") body = config.uploadBody.subarray(0, bytes);
        var spec = buildRequestSpec({
          direction: config.direction, phase: config.phase, source: config.testSource, url: config.testUrl,
          body: body, bytes: bytes, token: token, worker: worker, requestId: requestId,
          node: config.node, alpn: config.alpn,
          timeout: requestTimeout(config, bytes, rateEstimate, targetMs)
        });
        log(phaseName + " #" + requestId + " 发出 | " + spec.method + " | " + bytes + " B | HTTP 配置 " + config.alpn + " | 超时 " + spec.timeout + "ms");
        // This deadline never pretends to cancel the underlying request. If it
        // does not call back, the whole run stops with unresolvedRequests > 0.
        runtime.setTimeout(function () {
          if (!finished && report.state === "pending") {
            halted = true;
            report.state = "unresolved";
            report.errorKind = "callback-timeout";
            report.recoverable = false;
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
            rateEstimate = rateEstimate == null ? rate : rateEstimate * RATE_HISTORY_WEIGHT + rate * RATE_SAMPLE_WEIGHT;
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
          if (error.status != null) report.status = error.status;
          var classified = classifyError(error, report.status, config.alpn);
          report.errorKind = classified.kind;
          report.recoverable = classified.recoverable;
          errors.push("请求 #" + requestId + "：" + report.error);
        }).then(function () {
          if (finished) return;
          report.endMs = runtime.now() - startedAt; report.elapsedMs = runtime.now() - requestStart;
          log(phaseName + " #" + requestId + " " + report.state + " | " + report.elapsedMs + "ms | HTTP " + (report.status || "无响应") + (report.error ? " | " + report.error : ""));
          active -= 1; launch(worker);
        });
      }
      log("开始" + modeLabel(config.concurrency) + transferName + phaseName + " | 目标：" + config.node);
      log("源：" + config.testUrl + " | HTTP 配置 " + config.alpn + " | " + (config.adaptive ? "自适应" : "固定分块") + " | 窗口 " + (config.durationMs / 1000) + "s | 预算 " + (config.maxBytes / MB) + " MB | 分块上限 " + config.chunkBytes + " B");
      runtime.setTimeout(function () { if (!finished) { if (active) log(phaseName + "窗口结束，等待 " + active + " 个在途请求；收尾计入均值"); maybeFinish(); } }, config.durationMs);
      for (var worker = 0; worker < config.concurrency; worker += 1) {
        if (config.adaptive && worker > 0) (function (index) { runtime.setTimeout(function () { launch(index); }, index * WORKER_STAGGER_MS); })(worker);
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
    var sourceInfo, preflightReports = [], preflightRecoveryAttempted = false;
    try {
      try { sourceInfo = await preflight(options, runtime, preflightReports); }
      catch (error) {
        var lastReport = preflightReports[preflightReports.length - 1];
        if (!recoveryLeft || !lastReport || !lastReport.recoverable) throw error;
        if (runtime.log) runtime.log("HEAD 明确失败，尝试一次兼容检查：" + String(error.message || error));
        preflightRecoveryAttempted = true;
        fallback(); sourceInfo = await preflight(options, runtime, preflightReports);
      }
    }
    catch (error) {
      error.preflightReports = preflightReports;
      error.recoveryAttempted = preflightRecoveryAttempted;
      throw error;
    }
    var levels = options.mode === "compare" ? [1, options.concurrency] : [options.mode === "single" ? 1 : options.concurrency];
    var runs = [];
    for (var i = 0; i < levels.length; i += 1) {
      var phaseBudget = Math.floor(options.maxBytes / levels.length);
      var warmup = null, discarded = [], used = 0, recoveryAttempted = i === 0 && preflightRecoveryAttempted;
      if (options.warmupMs > 0) {
        var warmupBudget = options.adaptive ? Math.min(1000000, Math.floor(phaseBudget / 8)) : Math.floor(phaseBudget / 4);
        var warmupConcurrency = options.adaptive ? 1 : levels[i];
        warmup = await runPhase(Object.assign({}, options, {
          phase: "warmup", concurrency: warmupConcurrency, durationMs: options.warmupMs, maxBytes: warmupBudget,
          initialChunkBytes: INITIAL_ADAPTIVE_CHUNK_BYTES, chunkBytes: Math.min(options.chunkBytes, options.adaptive ? 256000 : Math.max(1, Math.floor(warmupBudget / levels[i])))
        }), runtime);
        used += warmup.scheduledBytes;
        if (warmup.state !== "ok" && recoveryLeft && recoverable(warmup) && phaseBudget - used >= RECOVERY_CHUNK_BYTES) {
          discarded.push(warmup); fallback(); recoveryAttempted = true;
          if (runtime.log) runtime.log("预热已回调结束，改用小块单路做一次恢复探测；旧数据不计正式速度");
          warmup = await runPhase(Object.assign({}, options, { phase: "warmup", concurrency: 1, durationMs: 1000, maxBytes: RECOVERY_CHUNK_BYTES, chunkBytes: RECOVERY_CHUNK_BYTES, initialChunkBytes: RECOVERY_CHUNK_BYTES }), runtime);
          used += warmup.scheduledBytes;
        }
      }
      var result;
      if (warmup && warmup.state !== "ok") {
        result = Object.assign({}, warmup, { phase: "measurement", concurrency: levels[i], elapsedMs: 0, drainMs: 0, completedBytes: 0, scheduledBytes: 0, requests: 0, successfulRequests: 0, unresolvedRequests: 0, samples: [], requestReports: [], bytesPerSecond: null, targetDurationMs: options.durationMs, stopReason: "warmup-error", errors: ["预热未完成，未开始正式测量"].concat(warmup.errors) });
      } else {
        result = await runPhase(Object.assign({}, options, {
          phase: "measurement", concurrency: levels[i], maxBytes: phaseBudget - used,
          initialChunkBytes: warmup && options.adaptive ? Math.max(MIN_ADAPTIVE_CHUNK_BYTES, Math.floor(warmup.nextChunkBytes / levels[i])) : INITIAL_ADAPTIVE_CHUNK_BYTES
        }), runtime);
        used += result.scheduledBytes;
        var remainingMs = options.durationMs - result.elapsedMs;
        if (result.state !== "ok" && recoveryLeft && recoverable(result) && remainingMs >= 2000 && phaseBudget - used >= RECOVERY_CHUNK_BYTES) {
          discarded.push(result); fallback(); recoveryAttempted = true;
          var lowerConcurrency = Math.max(1, Math.floor(levels[i] / 2));
          if (runtime.log) runtime.log("正式阶段已明确结束，降低并发为 " + lowerConcurrency + " 后独立重测一次；失败阶段不计新速度");
          result = await runPhase(Object.assign({}, options, { phase: "measurement", concurrency: lowerConcurrency, durationMs: remainingMs, maxBytes: phaseBudget - used, initialChunkBytes: RECOVERY_CHUNK_BYTES, chunkBytes: Math.min(options.chunkBytes, 256000) }), runtime);
          used += result.scheduledBytes;
        }
      }
      result.warmup = warmup; result.discardedPhases = discarded; result.requestedConcurrency = levels[i];
      result.recoveryAttempted = recoveryAttempted;
      result.recovered = recoveryAttempted && result.state === "ok";
      result.totalElapsedMs = result.elapsedMs + (warmup ? warmup.elapsedMs : 0) + discarded.reduce(function (sum, phase) { return sum + phase.elapsedMs; }, 0);
      result.totalCompletedBytes = result.completedBytes + (warmup ? warmup.completedBytes : 0) + discarded.reduce(function (sum, phase) { return sum + phase.completedBytes; }, 0);
      result.totalScheduledBytes = used; result.budgetBytes = phaseBudget;
      if (discarded.length) result.warnings.unshift(result.recovered ? "已降低负载重测，当前最多 " + result.concurrency + " 路；详情见日志" : "已尝试降低负载重测，本项仍未完成；详情见日志");
      runs.push(result);
      if (result.state !== "ok") break;
    }
    return {
      version: metadata.version, direction: options.direction, mode: options.mode, node: options.node, nodeProtocol: options.nodeProtocol || null, source: options.testUrl, testSource: options.testSource, sourceInfo: sourceInfo,
      targetSource: options.targetSource || null, targetConflict: options.targetConflict === true,
      state: runs.length === levels.length && runs.every(function (result) { return result.state === "ok"; }) ? "ok" : "failed",
      budgetBytes: options.maxBytes, runs: runs, preflightReports: preflightReports,
      comparisonRatio: runs.length === 2 && runs.every(function (result) { return result.state === "ok"; }) && runs[1].alpn === runs[0].alpn && runs[1].concurrency > runs[0].concurrency && runs[0].bytesPerSecond > 0 ? runs[1].bytesPerSecond / runs[0].bytesPerSecond : null
    };
  }

  async function run(options, runtime) {
    if (!options.node) throw new Error("测速必须指定目标 node");
    if (runtime.log) runtime.log("并发表示在途请求数；实际协商协议与 TCP 连接数不可由脚本确认");
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
        parts.push({ state: "failed", preflightReports: error.preflightReports || [], runs: [{ direction: direction, concurrency: options.mode === "concurrent" ? options.concurrency : 1,
          testSource: direction === "upload" ? options.uploadSource : options.testSource, state: "failed", bytesPerSecond: null,
          completedBytes: 0, elapsedMs: 0, totalCompletedBytes: 0, totalElapsedMs: 0, totalScheduledBytes: 0,
          unresolvedRequests: error.unresolvedRequests || 0, recoveryAttempted: error.recoveryAttempted === true, recovered: false,
          stopReason: "error", warnings: [], errors: [String(error.message || error)] }] });
      }
      var last = parts[parts.length - 1];
      if (last.runs.some(function (item) { return item.unresolvedRequests > 0 || item.warmup && item.warmup.unresolvedRequests > 0; })) break;
    }
    var runs = [].concat.apply([], parts.map(function (part) { return part.runs; }));
    var ok = parts.length === directions.length && parts.every(function (part) { return part.state === "ok"; });
    return { version: metadata.version, direction: "both", mode: options.mode, node: options.node, nodeProtocol: options.nodeProtocol || null,
      targetSource: options.targetSource || null, targetConflict: options.targetConflict === true,
      testSource: options.testSource, uploadSource: options.uploadSource, source: options.testUrl, uploadUrl: options.uploadUrl,
      state: ok ? "ok" : runs.some(function (item) { return item.state === "ok"; }) ? "partial" : "failed",
      budgetBytes: options.maxBytes, runs: runs, preflightReports: [].concat.apply([], parts.map(function (part) { return part.preflightReports || []; })), comparisonRatio: null };
  }

  function summary(result) {
    var lines = ["节点：" + result.node, result.direction === "both" ? "下载源：" + sourceLabel(result.testSource) + " · 上传源：" + sourceLabel(result.uploadSource) : "测速源：" + sourceLabel(result.testSource)];
    lines.splice(1, 0, "节点协议：" + (result.nodeProtocol || "未知"));
    if (result.targetConflict) lines.splice(1, 0, targetNotice(result));
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

  return { version: metadata.version, releaseDate: metadata.releaseDate, parseArgument: parseArgument, normalizeOptions: normalizeOptions, resolveTarget: resolveTarget, resolveTargetDetails: resolveTargetDetails, resolveNodeProtocol: resolveNodeProtocol, resolveNodeProtocolDetails: resolveNodeProtocolDetails, targetNotice: targetNotice, formatRate: formatRate, run: run, summary: summary, stopReasonLabel: stopReasonLabel };
});
