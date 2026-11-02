/* Loon adapter, concatenated after core.js by scripts/build.mjs. */
(function () {
  "use strict";
  var finished = false;
  var options;

  function log(text) { console.log(text); }
  function done(title, content, result) {
    if (!finished) {
      finished = true;
      var payload;
      try {
        payload = { title: title, htmlMessage: result ? LoonSpeedtestView.render(result) : LoonSpeedtestView.error(content, options) };
      } catch (error) {
        log("结果页生成失败，使用文本摘要：" + String(error.message || error));
        var notice = !result && LoonSpeedtest.targetNotice(options);
        payload = { title: title, content: notice ? notice + "\n" + content : content };
      }
      $done(payload);
    }
  }
  function notify(subtitle, text) {
    if (options && !options.notify) return;
    if (typeof $notification !== "undefined") {
      try { $notification.post("节点速度测试", subtitle, text); }
      catch (error) { log("通知未发送：" + String(error.message || error)); }
    }
  }

  Promise.resolve().then(function () {
    log("节点速度测试 v" + LoonSpeedtest.version + " | 脚本已加载");
    if (typeof $loon === "string") log("Loon 运行时 | " + $loon);
    options = LoonSpeedtest.normalizeOptions(typeof $argument === "undefined" ? null : $argument);
    var environment = typeof $environment === "undefined" ? null : $environment;
    var target = LoonSpeedtest.resolveTargetDetails(options.node, environment);
    options.node = target.node;
    options.targetSource = target.source;
    options.targetConflict = target.conflict;
    var protocol = LoonSpeedtest.resolveNodeProtocolDetails(options.node, environment);
    options.nodeProtocol = protocol.protocol;
    log("目标 | " + JSON.stringify({ node: target.node, source: target.source, conflict: target.conflict, entryTarget: target.entryTarget }));
    var protocolReasons = {
      direct: "明确直连", recognized: "匹配目标且类型已识别", "missing-metadata": "入口未提供协议信息",
      "invalid-json": "协议信息 JSON 无效", "invalid-metadata": "协议信息结构无效", "invalid-name": "协议信息缺少有效名称",
      "entry-mismatch": "入口节点与实际目标不匹配", "name-mismatch": "协议信息名称与实际目标不匹配",
      "invalid-type": "协议类型字段无效", "unsupported-type": "协议类型尚未识别"
    };
    log("节点协议诊断 | " + protocol.reason + " | " + protocolReasons[protocol.reason]);
    log("参数 | " + JSON.stringify({ direction: options.direction, mode: options.mode, adaptive: options.adaptive, httpVersion: options.httpVersion, concurrency: options.concurrency, durationMs: options.durationMs, warmupMs: options.warmupMs, downloadChunkLimit: options.chunkBytes, uploadChunkLimit: options.uploadChunkBytes, budgetBytes: options.maxBytes, requestTimeoutMs: options.requestTimeoutMs }));
    return LoonSpeedtest.run(options, {
      now: function () { return Date.now(); },
      setTimeout: function (callback, ms) { setTimeout(callback, ms); },
      log: log,
      request: function (spec) {
        return new Promise(function (resolve, reject) {
          var method = spec.method === "POST" ? "post" : spec.method === "HEAD" ? "head" : "get";
          $httpClient[method]({
            url: spec.url, node: spec.node, timeout: spec.timeout, body: spec.body,
            "binary-mode": true, "auto-redirect": false, "auto-cookie": false,
            insecure: false, alpn: spec.alpn,
            headers: Object.assign({ "Cache-Control": "no-cache, no-store", "Accept-Encoding": "identity" }, spec.headers)
          }, function (error, response, data) {
            if (error) {
              var detail = typeof error === "string" ? error : error.message || error.localizedDescription || error.description;
              if (!detail) { try { detail = JSON.stringify(error); } catch (_) { detail = String(error); } }
              var status = response && response.status;
              reject(new Error(spec.method + " 请求失败：" + detail + (status ? "（HTTP " + status + "）" : "")));
              return;
            }
            var binary = Object.prototype.toString.call(data) === "[object Uint8Array]";
            var uploadBytes = null;
            if (spec.method === "POST" && data != null && (binary ? data.byteLength : typeof data === "string" ? data.length : 4097) <= 4096) {
              // Apple's small ASCII JSON reply contains the number of bytes received.
              // Avoid depending on TextDecoder, which is not a documented Loon global.
              try {
                var json = typeof data === "string" ? data : Array.prototype.map.call(data, function (byte) { return String.fromCharCode(byte); }).join("");
                var receipt = JSON.parse(json);
                if (receipt && typeof receipt.Bytes === "number" && isFinite(receipt.Bytes) && receipt.Bytes >= 0 && Math.floor(receipt.Bytes) === receipt.Bytes) uploadBytes = receipt.Bytes;
              } catch (_) { /* Non-Apple endpoints may have an empty or non-JSON response. */ }
            }
            resolve({ status: response && response.status, headers: response && response.headers, binary: binary, bytes: binary ? data.byteLength : null, uploadBytes: uploadBytes });
          });
        });
      }
    });
  }).then(function (result) {
    var text = LoonSpeedtest.summary(result);
    log(text);
    if (typeof $persistentStore !== "undefined") {
      try {
        if (!$persistentStore.write(JSON.stringify(result), "loon-speedtest:lastResult")) log("本次结果未保存到本地存储");
      } catch (error) { log("本地存储失败：" + String(error.message || error)); }
    }
    var status = result.state === "ok" ? "" : result.state === "partial" ? "部分完成" : "未完成";
    var title = "节点速度测试" + (status ? " · " + status : "");
    notify(status, text);
    done(title, text, result);
  }).catch(function (error) {
    var message = String(error.message || error);
    log("测速失败：" + message);
    var notice = LoonSpeedtest.targetNotice(options);
    notify("测速失败", notice ? notice + "\n" + message : message);
    done("测速失败", message);
  });
})();
