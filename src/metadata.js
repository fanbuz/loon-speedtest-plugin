/* Node-only release metadata. The builder injects these plain values into Loon. */
"use strict";

var packageInfo = require("../package.json");
var version = packageInfo.version;
var releaseDate = packageInfo.releaseDate;
var component = "(?:0|[1-9][0-9]*)";
var prerelease = "(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)";
var versionPattern = new RegExp("^" + component + "\\." + component + "\\." + component +
  "(?:-" + prerelease + "(?:\\." + prerelease + ")*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$");

if (typeof version !== "string" || version.trim() !== version || !versionPattern.test(version)) {
  throw new Error("package.json 的 version 必须是有效的语义版本号");
}
if (typeof releaseDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ||
    !isFinite(Date.parse(releaseDate + "T00:00:00.000Z")) ||
    new Date(releaseDate + "T00:00:00.000Z").toISOString().slice(0, 10) !== releaseDate) {
  throw new Error("package.json 的 releaseDate 必须是有效的 YYYY-MM-DD 日期");
}

module.exports = Object.freeze({ version: version, releaseDate: releaseDate });
