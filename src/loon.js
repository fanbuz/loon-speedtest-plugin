/* Loon adapter, concatenated after core.js by scripts/build.mjs. */
(function () {
  "use strict";
  var finished = false;
  var options;

  function log(text) { console.log(text); }
  function done(title, content) {
    if (!finished) {
      finished = true;
      $done({ title: title, content: content });
    }
  }
  function notify(title, text) {
    if (options && !options.notify) return;
    if (typeof $notification !== "undefined") {
      try { $notification.post("Loon 下载测速", title, text); }
      catch (error) { log("通知未发送：" + String(error.message || error)); }
    }
  }

  Promise.resolve().then(function () {
    log("Loon 下载测速 v0.1.1 | 脚本已加载");
    options = LoonSpeedtest.normalizeOptions(typeof $argument === "undefined" ? null : $argument);
    options.node = LoonSpeedtest.resolveTarget(options.node, typeof $environment === "undefined" ? null : $environment);
    return LoonSpeedtest.run(options, {
      now: function () { return Date.now(); },
      setTimeout: function (callback, ms) { setTimeout(callback, ms); },
      log: log,
      request: function (spec) {
        return new Promise(function (resolve, reject) {
          var method = spec.method === "HEAD" ? "head" : "get";
          $httpClient[method]({
            url: spec.url, node: spec.node, timeout: spec.timeout,
            "binary-mode": true, "auto-redirect": false, "auto-cookie": false,
            insecure: false, alpn: "h1",
            headers: Object.assign({ "Cache-Control": "no-cache, no-store", "Accept-Encoding": "identity" }, spec.headers)
          }, function (error, response, data) {
            if (error) { reject(new Error(String(error))); return; }
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
    var title = result.state === "ok" ? "测速完成" : "测速未完成";
    notify(title, text);
    done(title, text);
  }).catch(function (error) {
    var message = String(error.message || error);
    log("测速失败：" + message);
    notify("测速失败", message);
    done("测速失败", message);
  });
})();
