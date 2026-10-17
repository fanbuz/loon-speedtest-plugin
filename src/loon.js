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
        payload = { title: title, htmlMessage: result ? LoonSpeedtestView.render(result) : LoonSpeedtestView.error(content) };
      } catch (error) {
        log("结果页生成失败，使用文本摘要：" + String(error.message || error));
        payload = { title: title, content: content };
      }
      $done(payload);
    }
  }
  function notify(title, text) {
    if (options && !options.notify) return;
    if (typeof $notification !== "undefined") {
      try { $notification.post("速度测试", title, text); }
      catch (error) { log("通知未发送：" + String(error.message || error)); }
    }
  }

  Promise.resolve().then(function () {
    log("速度测试 v0.2.1 | 脚本已加载");
    options = LoonSpeedtest.normalizeOptions(typeof $argument === "undefined" ? null : $argument);
    options.node = LoonSpeedtest.resolveTarget(options.node, typeof $environment === "undefined" ? null : $environment);
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
            insecure: false, alpn: "h1",
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
            resolve({ status: response && response.status, headers: response && response.headers, binary: binary, bytes: binary ? data.byteLength : null });
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
    var title = result.state === "ok" ? "速度测试" : result.state === "partial" ? "速度测试 · 部分完成" : "速度测试 · 未完成";
    notify(title, text);
    done(title, text, result);
  }).catch(function (error) {
    var message = String(error.message || error);
    log("测速失败：" + message);
    notify("测速失败", message);
    done("测速失败", message);
  });
})();
