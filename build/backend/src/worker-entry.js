// The worker entry point.
//
// Raycast passes the API package's own file to `new Worker(...)`:
//
//   yIr = bwt(KOe, "@raycast", "api", "index.js")
//   new Worker(yIr, { workerData: this.context, env: { NODE_PATH: …/api/node_modules, … } })
//
// so `@raycast/api` is simultaneously the library extension authors import *and* the program that
// runs their command. This file reproduces that: loading the API starts its `parentPort` RPC loop
// and registers `initialize` / `nativeCallback` / `terminate`. Nothing else happens here.
//
// `NODE_PATH` (set by the worker factory) is what lets the extension bundle in
// <extRoot>/dist/<command>.js resolve `@raycast/api` and `react`.

"use strict";

const path = require("node:path");
const { workerData } = require("node:worker_threads");

const apiRoot = path.resolve(workerData?.apiRoot ?? path.join(__dirname, "..", "..", "api"));

const api = require(path.join(apiRoot, "node_modules", "@raycast", "api"));

module.exports = api;
