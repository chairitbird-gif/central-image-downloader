/*!
 * Dicut PS client — shared across Central Creative Tools.
 * Canonical source: dicut-bridge/client/dicut-ps.js
 * Contract: docs/contracts/DICUT_PS.md — copies in the tool repositories must
 * stay byte-identical to this file.
 *
 * Talks to the local Dicut PS Bridge (dicut_bridge.py) which drives the
 * Photoshop "Remove Background" command on Windows and macOS alike.
 * No dependencies, no build step: load it with a plain <script> tag.
 *
 * The install dialog hands out a one-file setup script with the whole bridge
 * embedded, so a first-time user never has to find or copy the source folder.
 * BRIDGE_SOURCE_B64 below is generated — after editing dicut_bridge.py run
 * `python tools/sync_client.py` to re-embed it and refresh every copy.
 */
(function () {
  'use strict';
  if (window.DicutPS) return;

  var VERSION = '1.1.3';
  // The bridge lives on the user's machine and is not updated by a site deploy,
  // so the client has to notice an old one and send them back to the installer.
  var REQUIRED_BRIDGE = '1.1.2';
  var ENDPOINT = 'http://127.0.0.1:8799';
  // document.currentScript is only readable while the script is executing, and
  // the stylesheet sits next to this file whatever path a tool serves it from.
  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || '';
  var PROBE_TIMEOUT_MS = 2500;
  var CUT_TIMEOUT_MS = 240000;   // Photoshop's first launch can take minutes
  var PROBE_TTL_OK_MS = 15000;
  var PROBE_TTL_FAIL_MS = 3000;

  /* BRIDGE_SOURCE_B64_START */
  var BRIDGE_SOURCE_B64 = 'IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMw0KIyAtKi0gY29kaW5nOiB1dGYtOCAtKi0NCiIiIkRpY3V0IFBTIEJyaWRnZSAtIGxvY2FsIEhUVFAgc2VydmljZSB0aGF0IHJ1bnMgUGhvdG9zaG9wICJSZW1vdmUgQmFja2dyb3VuZCIuDQoNClRoZSBDZW50cmFsIENyZWF0aXZlIFRvb2xzIHdlYiBhcHBzIGNhbm5vdCB0YWxrIHRvIGEgbG9jYWxseSBpbnN0YWxsZWQNClBob3Rvc2hvcCwgc28gdGhleSBQT1NUIGFuIGltYWdlIGhlcmUgYW5kIGdldCBhIHRyYW5zcGFyZW50IFBORyBiYWNrLg0KVGhlIHNhbWUgc2VydmljZSBydW5zIG9uIFdpbmRvd3MgKENPTSkgYW5kIG1hY09TIChBcHBsZSBldmVudHMpLCB3aGljaCBpcyB3aGF0DQpsZXRzIG9uZSBidXR0b24gd29yayBvbiBib3RoIHBsYXRmb3Jtcy4NCg0KUnVuOiAgICAgICAgcHl0aG9uIGRpY3V0X2JyaWRnZS5weQ0KT3B0aW9uczogICAgLS1wb3J0IDg3OTkgIC0taG9zdCAxMjcuMC4wLjEgIC0tdGltZW91dCAxODAgIC0ta2VlcC13b3JrDQpIZWFsdGg6ICAgICBjdXJsIGh0dHA6Ly8xMjcuMC4wLjE6ODc5OS9oZWFsdGgNClNlbGYgdGVzdDogIHB5dGhvbiBkaWN1dF9icmlkZ2UucHkgLS1zZWxmdGVzdCBwYXRoL3RvL2ltYWdlLmpwZw0KDQpPbmx5IHRoZSBsb29wYmFjayBpbnRlcmZhY2UgaXMgYm91bmQgYW5kIG9ubHkgYWxsb3ctbGlzdGVkIGJyb3dzZXIgb3JpZ2lucyBhcmUNCmFjY2VwdGVkLCBzbyBhIHJhbmRvbSB3ZWIgcGFnZSBjYW5ub3QgZHJpdmUgdGhlIGxvY2FsIFBob3Rvc2hvcC4NCiIiIg0KDQppbXBvcnQgYXJncGFyc2UNCmltcG9ydCBiYXNlNjQNCmltcG9ydCBqc29uDQppbXBvcnQgb3MNCmltcG9ydCBwbGF0Zm9ybQ0KaW1wb3J0IHJlDQppbXBvcnQgc2h1dGlsDQppbXBvcnQgc3VicHJvY2Vzcw0KaW1wb3J0IHN5cw0KaW1wb3J0IHRlbXBmaWxlDQppbXBvcnQgdGhyZWFkaW5nDQppbXBvcnQgdGltZQ0KaW1wb3J0IHV1aWQNCmZyb20gaHR0cC5zZXJ2ZXIgaW1wb3J0IEJhc2VIVFRQUmVxdWVzdEhhbmRsZXIsIFRocmVhZGluZ0hUVFBTZXJ2ZXINCmZyb20gcGF0aGxpYiBpbXBvcnQgUGF0aA0KDQpWRVJTSU9OID0gIjEuMS4yIg0KREVGQVVMVF9QT1JUID0gODc5OQ0KREVGQVVMVF9IT1NUID0gIjEyNy4wLjAuMSINCkRFRkFVTFRfVElNRU9VVCA9IDE4MA0KTUFYX0JPRFlfQllURVMgPSA0OCAqIDEwMjQgKiAxMDI0DQoNCklTX1dJTkRPV1MgPSBzeXMucGxhdGZvcm0uc3RhcnRzd2l0aCgid2luIikNCklTX01BQyA9IHN5cy5wbGF0Zm9ybSA9PSAiZGFyd2luIg0KDQojIFByb2R1Y3Rpb24gb3JpZ2lucyBvZiB0aGUgZm91ciB0b29scyB0aGF0IG93biBhIERpY3V0IFBTIGJ1dHRvbi4gUHJldmlldw0KIyBkZXBsb3ltZW50cyBsaXZlIG9uIHN1YmRvbWFpbnMgb2YgdGhlIHNhbWUgUGFnZXMgcHJvamVjdHMsIHNvIHRob3NlIGFyZQ0KIyBtYXRjaGVkIGJ5IHN1ZmZpeC4gRXh0cmEgb3JpZ2lucyBjYW4gYmUgYWRkZWQgd2l0aCBESUNVVF9CUklER0VfT1JJR0lOUy4NCkFMTE9XRURfT1JJR0lOUyA9IHsNCiAgICAiaHR0cHM6Ly9jZW50cmFsLWltYWdlLWRvd25sb2FkZXIucGFnZXMuZGV2IiwNCiAgICAiaHR0cHM6Ly9jZW50cmFsLXN0cmlwLWJhbm5lci5wYWdlcy5kZXYiLA0KICAgICJodHRwczovL2NlbnRyYWwtb3ZlcmxheS1nZW5lcmF0b3IucGFnZXMuZGV2IiwNCiAgICAiaHR0cHM6Ly9jZW50cmFsLWZpcnN0LWltYWdlLmNoYWlyaXQtYmlyZC53b3JrZXJzLmRldiIsDQp9DQpBTExPV0VEX09SSUdJTl9TVUZGSVhFUyA9ICgNCiAgICAiLmNlbnRyYWwtaW1hZ2UtZG93bmxvYWRlci5wYWdlcy5kZXYiLA0KICAgICIuY2VudHJhbC1zdHJpcC1iYW5uZXIucGFnZXMuZGV2IiwNCiAgICAiLmNlbnRyYWwtb3ZlcmxheS1nZW5lcmF0b3IucGFnZXMuZGV2IiwNCikNCkxPQ0FMX09SSUdJTl9SRSA9IHJlLmNvbXBpbGUociJeaHR0cHM/Oi8vKGxvY2FsaG9zdHwxMjdcLjBcLjBcLjF8XFs6OjFcXSkoOlxkKyk/JCIpDQoNCkVYVEVOU0lPTl9CWV9NSU1FID0gew0KICAgICJpbWFnZS9wbmciOiAiLnBuZyIsDQogICAgImltYWdlL2pwZWciOiAiLmpwZyIsDQogICAgImltYWdlL2pwZyI6ICIuanBnIiwNCiAgICAiaW1hZ2Uvd2VicCI6ICIud2VicCIsDQogICAgImltYWdlL3RpZmYiOiAiLnRpZiIsDQogICAgImltYWdlL2JtcCI6ICIuYm1wIiwNCn0NCg0KREFUQV9VUkxfUkUgPSByZS5jb21waWxlKHIiXmRhdGE6KD9QPG1pbWU+W1x3ListXSsvW1x3ListXSspPztiYXNlNjQsKD9QPHBheWxvYWQ+LispJCIsIHJlLlMpDQoNCiMgUGhvdG9zaG9wIGlzIHNpbmdsZS1pbnN0YW5jZTogdHdvIG92ZXJsYXBwaW5nIERvSmF2YVNjcmlwdCBjYWxscyBmaWdodCBvdmVyDQojIHRoZSBzYW1lIGFwcGxpY2F0aW9uLCBzbyBldmVyeSBjdXQgaXMgc2VyaWFsaXNlZC4NClBIT1RPU0hPUF9MT0NLID0gdGhyZWFkaW5nLkxvY2soKQ0KDQojIFRyaW1taW5nIGlzIG9wdGlvbmFsOiBhIGNhbGxlciB0aGF0IHdhbnRzIGEgYmVmb3JlL2FmdGVyIGNvbXBhcmlzb24gbmVlZHMgdGhlDQojIHJlc3VsdCBvbiB0aGUgb3JpZ2luYWwgY2FudmFzLCBiZWNhdXNlIGEgdHJpbW1lZCBjdXRvdXQgbm8gbG9uZ2VyIGxpbmVzIHVwDQojIHdpdGggdGhlIGltYWdlIGl0IGNhbWUgZnJvbS4NCkpTWF9URU1QTEFURSA9ICIiImFwcC5kaXNwbGF5RGlhbG9ncyA9IERpYWxvZ01vZGVzLk5POw0KdmFyIF9zcmMgPSBuZXcgRmlsZSgiJShzcmMpcyIpOw0KdmFyIF9vdXQgPSBuZXcgRmlsZSgiJShvdXQpcyIpOw0KdmFyIGRvYyA9IGFwcC5vcGVuKF9zcmMpOw0KdHJ5IHsNCiAgICBpZiAoZG9jLmxheWVyc1swXS5pc0JhY2tncm91bmRMYXllcikgZG9jLmxheWVyc1swXS5pc0JhY2tncm91bmRMYXllciA9IGZhbHNlOw0KICAgIGV4ZWN1dGVBY3Rpb24oc3RyaW5nSURUb1R5cGVJRCgncmVtb3ZlQmFja2dyb3VuZCcpLCB1bmRlZmluZWQsIERpYWxvZ01vZGVzLk5PKTsNCiUodHJpbSlzICAgIGRvYy5zYXZlQXMoX291dCwgbmV3IFBOR1NhdmVPcHRpb25zKCksIHRydWUsIEV4dGVuc2lvbi5MT1dFUkNBU0UpOw0KfSBmaW5hbGx5IHsNCiAgICBkb2MuY2xvc2UoU2F2ZU9wdGlvbnMuRE9OT1RTQVZFQ0hBTkdFUyk7DQp9DQoiIiINClRSSU1fTElORSA9ICIgICAgZG9jLnRyaW0oVHJpbVR5cGUuVFJBTlNQQVJFTlQpO1xuIg0KDQoNCkxPR19QQVRIID0gUGF0aC5ob21lKCkgLyAiLmRpY3V0LWJyaWRnZSIgLyAiYnJpZGdlLmxvZyINCg0KDQpkZWYgZW1pdChtZXNzYWdlKToNCiAgICAiIiJSZXBvcnQgYSBsaW5lIHdpdGhvdXQgYXNzdW1pbmcgdGhlcmUgaXMgYSBjb25zb2xlLg0KDQogICAgcHl0aG9udy5leGUgLSB3aGljaCB0aGUgV2luZG93cyBpbnN0YWxsZXIgdXNlcyBzbyB0aGUgYnJpZGdlIGhhcyBubyB2aXNpYmxlDQogICAgd2luZG93IC0gbGVhdmVzIHN5cy5zdGRvdXQgYXMgTm9uZSwgc28gd3JpdGluZyB0byBpdCByYWlzZWQgQXR0cmlidXRlRXJyb3INCiAgICBhbmQga2lsbGVkIHRoZSBzZXJ2aWNlIGJlZm9yZSBpdCBldmVyIGJvdW5kIHRoZSBwb3J0LiBBbnl0aGluZyB0aGF0IGNhbm5vdA0KICAgIHJlYWNoIGEgc3RyZWFtIGdvZXMgdG8gYSBsb2cgZmlsZSBpbnN0ZWFkLCB3aGljaCBpcyBhbHNvIHdoYXQgbWFrZXMgYQ0KICAgIGhlYWRsZXNzIGZhaWx1cmUgZGlhZ25vc2FibGUgYXQgYWxsLg0KICAgICIiIg0KICAgIGxpbmUgPSAiJXMgJXMiICUgKHRpbWUuc3RyZnRpbWUoIiVIOiVNOiVTIiksIG1lc3NhZ2UpDQogICAgc3RyZWFtID0gc3lzLnN0ZG91dA0KICAgIGlmIHN0cmVhbSBpcyBub3QgTm9uZToNCiAgICAgICAgdHJ5Og0KICAgICAgICAgICAgc3RyZWFtLndyaXRlKGxpbmUgKyAiXG4iKQ0KICAgICAgICAgICAgc3RyZWFtLmZsdXNoKCkNCiAgICAgICAgICAgIHJldHVybg0KICAgICAgICBleGNlcHQgRXhjZXB0aW9uOiAgIyBub3FhOiBCTEUwMDEgLSBhIGJyb2tlbiBjb25zb2xlIG11c3Qgbm90IHN0b3AgdGhlIHNlcnZpY2UNCiAgICAgICAgICAgIHBhc3MNCiAgICB0cnk6DQogICAgICAgIExPR19QQVRILnBhcmVudC5ta2RpcihwYXJlbnRzPVRydWUsIGV4aXN0X29rPVRydWUpDQogICAgICAgIHdpdGggTE9HX1BBVEgub3BlbigiYSIsIGVuY29kaW5nPSJ1dGYtOCIpIGFzIGhhbmRsZToNCiAgICAgICAgICAgIGhhbmRsZS53cml0ZShsaW5lICsgIlxuIikNCiAgICBleGNlcHQgT1NFcnJvcjoNCiAgICAgICAgcGFzcw0KDQoNCmNsYXNzIERpY3V0RXJyb3IoUnVudGltZUVycm9yKToNCiAgICAiIiJBIGZhaWx1cmUgdGhlIGJyb3dzZXIgaXMgZXhwZWN0ZWQgdG8gc2hvdyB0byB0aGUgdXNlciBhcy1pcy4iIiINCg0KDQpkZWYganN4X3BhdGgodmFsdWUpOg0KICAgICIiIkVzY2FwZSBhIGZpbGVzeXN0ZW0gcGF0aCBmb3IgZW1iZWRkaW5nIGluIGEgSlNYIHN0cmluZyBsaXRlcmFsLiIiIg0KICAgIHJldHVybiBzdHIodmFsdWUpLnJlcGxhY2UoIlxcIiwgIlxcXFwiKS5yZXBsYWNlKCciJywgJ1xcIicpDQoNCg0KZGVmIG9yaWdpbl9hbGxvd2VkKG9yaWdpbik6DQogICAgaWYgbm90IG9yaWdpbjoNCiAgICAgICAgcmV0dXJuIFRydWUgICMgY3VybCAvIHNlbGYgdGVzdDogbm8gYnJvd3NlciBvcmlnaW4gdG8gY2hlY2sNCiAgICBpZiBvcmlnaW4gaW4gQUxMT1dFRF9PUklHSU5TIG9yIExPQ0FMX09SSUdJTl9SRS5tYXRjaChvcmlnaW4pOg0KICAgICAgICByZXR1cm4gVHJ1ZQ0KICAgIHJldHVybiBhbnkob3JpZ2luLmVuZHN3aXRoKHN1ZmZpeCkgZm9yIHN1ZmZpeCBpbiBBTExPV0VEX09SSUdJTl9TVUZGSVhFUykNCg0KDQpkZWYgbG9hZF9leHRyYV9vcmlnaW5zKCk6DQogICAgcmF3ID0gb3MuZW52aXJvbi5nZXQoIkRJQ1VUX0JSSURHRV9PUklHSU5TIiwgIiIpDQogICAgZm9yIGl0ZW0gaW4gcmF3LnJlcGxhY2UoIiwiLCAiICIpLnNwbGl0KCk6DQogICAgICAgIEFMTE9XRURfT1JJR0lOUy5hZGQoaXRlbS5yc3RyaXAoIi8iKSkNCg0KDQojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQojIFBob3Rvc2hvcCBkaXNjb3ZlcnkNCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCg0KZGVmIGZpbmRfcGhvdG9zaG9wX21hYygpOg0KICAgIGNhbmRpZGF0ZXMgPSBbXQ0KICAgIGFwcHMgPSBQYXRoKCIvQXBwbGljYXRpb25zIikNCiAgICBpZiBhcHBzLmlzX2RpcigpOg0KICAgICAgICBmb3IgZW50cnkgaW4gc29ydGVkKGFwcHMuZ2xvYigiQWRvYmUgUGhvdG9zaG9wKiIpKToNCiAgICAgICAgICAgIGlmIGVudHJ5LnN1ZmZpeCA9PSAiLmFwcCI6DQogICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5hcHBlbmQoZW50cnkpDQogICAgICAgICAgICBlbGlmIGVudHJ5LmlzX2RpcigpOg0KICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMuZXh0ZW5kKHNvcnRlZChlbnRyeS5nbG9iKCJBZG9iZSBQaG90b3Nob3AqLmFwcCIpKSkNCiAgICByZXR1cm4gY2FuZGlkYXRlc1stMV0gaWYgY2FuZGlkYXRlcyBlbHNlIE5vbmUNCg0KDQpkZWYgZmluZF9waG90b3Nob3Bfd2luZG93cygpOg0KICAgICIiIlJldHVybiB0aGUgcmVnaXN0ZXJlZCBQaG90b3Nob3AgYXBwbGljYXRpb24gbmFtZSwgb3IgTm9uZS4iIiINCiAgICB0cnk6DQogICAgICAgIGltcG9ydCB3aW5yZWcNCiAgICBleGNlcHQgSW1wb3J0RXJyb3I6ICAjIHByYWdtYTogbm8gY292ZXIgLSBXaW5kb3dzIG9ubHkNCiAgICAgICAgcmV0dXJuIE5vbmUNCiAgICBmb3Igcm9vdCBpbiAod2lucmVnLkhLRVlfQ0xBU1NFU19ST09ULCk6DQogICAgICAgIHRyeToNCiAgICAgICAgICAgIHdpdGggd2lucmVnLk9wZW5LZXkocm9vdCwgciJQaG90b3Nob3AuQXBwbGljYXRpb25cQ3VyVmVyIikgYXMga2V5Og0KICAgICAgICAgICAgICAgIHZlcnNpb24gPSB3aW5yZWcuUXVlcnlWYWx1ZUV4KGtleSwgIiIpWzBdDQogICAgICAgICAgICAgICAgcmV0dXJuIHN0cih2ZXJzaW9uKQ0KICAgICAgICBleGNlcHQgT1NFcnJvcjoNCiAgICAgICAgICAgIGNvbnRpbnVlDQogICAgdHJ5Og0KICAgICAgICB3aXRoIHdpbnJlZy5PcGVuS2V5KHdpbnJlZy5IS0VZX0NMQVNTRVNfUk9PVCwgIlBob3Rvc2hvcC5BcHBsaWNhdGlvbiIpOg0KICAgICAgICAgICAgcmV0dXJuICJQaG90b3Nob3AuQXBwbGljYXRpb24iDQogICAgZXhjZXB0IE9TRXJyb3I6DQogICAgICAgIHJldHVybiBOb25lDQoNCg0KZGVmIHBob3Rvc2hvcF9zdGF0dXMoKToNCiAgICBpZiBJU19NQUM6DQogICAgICAgIGFwcCA9IGZpbmRfcGhvdG9zaG9wX21hYygpDQogICAgICAgIHJldHVybiB7ImZvdW5kIjogYm9vbChhcHApLCAibmFtZSI6IGFwcC5zdGVtIGlmIGFwcCBlbHNlICIiLCAicGF0aCI6IHN0cihhcHApIGlmIGFwcCBlbHNlICIifQ0KICAgIGlmIElTX1dJTkRPV1M6DQogICAgICAgIG5hbWUgPSBmaW5kX3Bob3Rvc2hvcF93aW5kb3dzKCkNCiAgICAgICAgcmV0dXJuIHsiZm91bmQiOiBib29sKG5hbWUpLCAibmFtZSI6IG5hbWUgb3IgIiIsICJwYXRoIjogIiJ9DQogICAgcmV0dXJuIHsiZm91bmQiOiBGYWxzZSwgIm5hbWUiOiAiIiwgInBhdGgiOiAiIn0NCg0KDQojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQojIFBob3Rvc2hvcCBleGVjdXRpb24NCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCg0KZGVmIHdhaXRfZm9yX291dHB1dChvdXRfZmlsZSwgYXBwZWFyX3RpbWVvdXQsIHNldHRsZV90aW1lb3V0PTE4MCwgcG9sbD0wLjMpOg0KICAgICIiIldhaXQgdW50aWwgdGhlIFBORyBleGlzdHMgYW5kIGhhcyBzdG9wcGVkIGdyb3dpbmcuDQoNCiAgICBQaG90b3Nob3AgY3JlYXRlcyB0aGUgb3V0cHV0IGZpbGUgYmVmb3JlIGl0IGhhcyBmaW5pc2hlZCB3cml0aW5nIGl0LCBzbw0KICAgIHRlc3RpbmcgYGV4aXN0cygpYCBhbG9uZSBoYW5kcyBiYWNrIGEgemVyby1ieXRlIG9yIGhhbGYtd3JpdHRlbiBQTkcuIFRoYXQgaXMNCiAgICB3aGF0IG1hZGUgYSBtYWNPUyBiYXRjaCByZXR1cm4gIlBob3Rvc2hvcCDguITguLfguJnguYTguJ/guKXguYzguKfguYjguLLguIciIGZvciBldmVyeSBpbWFnZSBleGNlcHQNCiAgICB0aGUgb25lIHRoYXQgaGFwcGVuZWQgdG8gd2luIHRoZSByYWNlLg0KICAgICIiIg0KICAgIGFwcGVhcl9kZWFkbGluZSA9IHRpbWUudGltZSgpICsgYXBwZWFyX3RpbWVvdXQNCiAgICB3aGlsZSB0aW1lLnRpbWUoKSA8IGFwcGVhcl9kZWFkbGluZSBhbmQgbm90IG91dF9maWxlLmV4aXN0cygpOg0KICAgICAgICB0aW1lLnNsZWVwKHBvbGwpDQogICAgaWYgbm90IG91dF9maWxlLmV4aXN0cygpOg0KICAgICAgICByZXR1cm4gRmFsc2UNCg0KICAgIHNldHRsZV9kZWFkbGluZSA9IHRpbWUudGltZSgpICsgc2V0dGxlX3RpbWVvdXQNCiAgICBsYXN0LCBzdGFibGUgPSAtMSwgMA0KICAgIHdoaWxlIHRpbWUudGltZSgpIDwgc2V0dGxlX2RlYWRsaW5lOg0KICAgICAgICB0cnk6DQogICAgICAgICAgICBzaXplID0gb3V0X2ZpbGUuc3RhdCgpLnN0X3NpemUNCiAgICAgICAgZXhjZXB0IE9TRXJyb3I6DQogICAgICAgICAgICBzaXplID0gLTENCiAgICAgICAgaWYgc2l6ZSA+IDAgYW5kIHNpemUgPT0gbGFzdDoNCiAgICAgICAgICAgIHN0YWJsZSArPSAxDQogICAgICAgICAgICBpZiBzdGFibGUgPj0gMjoNCiAgICAgICAgICAgICAgICByZXR1cm4gVHJ1ZQ0KICAgICAgICBlbHNlOg0KICAgICAgICAgICAgc3RhYmxlID0gMA0KICAgICAgICBsYXN0ID0gc2l6ZQ0KICAgICAgICB0aW1lLnNsZWVwKHBvbGwpDQogICAgcmV0dXJuIEZhbHNlDQoNCg0KZGVmIHJ1bl9waG90b3Nob3Bfd2luZG93cyhzY3JpcHQsIG91dF9maWxlLCB0aW1lb3V0KToNCiAgICAiIiJEcml2ZSBQaG90b3Nob3AgdGhyb3VnaCBDT006IHB5d2luMzIgd2hlbiBwcmVzZW50LCBQb3dlclNoZWxsIG90aGVyd2lzZS4iIiINCiAgICBlcnJvcnMgPSBbXQ0KICAgIHRyeToNCiAgICAgICAgaW1wb3J0IHdpbjMyY29tLmNsaWVudCAgIyB0eXBlOiBpZ25vcmUNCg0KICAgICAgICBhcHAgPSB3aW4zMmNvbS5jbGllbnQuRGlzcGF0Y2goIlBob3Rvc2hvcC5BcHBsaWNhdGlvbiIpDQogICAgICAgICMgRG9KYXZhU2NyaXB0IHdpdGggdGhlIHNvdXJjZSB0ZXh0IGlzIHRoZSBjYWxsIHBhdGggYWxyZWFkeSBwcm92ZW4gYnkNCiAgICAgICAgIyB0b29scy9kaWN1dC5weTsgdGhlIHBhdGhzIGFyZSBiYWtlZCBpbnRvIHRoZSBzY3JpcHQgc28gbm8gYXJndW1lbnRzDQogICAgICAgICMgaGF2ZSB0byBzdXJ2aXZlIHRoZSBDT00gYm91bmRhcnkuDQogICAgICAgIGFwcC5Eb0phdmFTY3JpcHQoc2NyaXB0LnJlYWRfdGV4dChlbmNvZGluZz0idXRmLTgiKSkNCiAgICAgICAgaWYgd2FpdF9mb3Jfb3V0cHV0KG91dF9maWxlLCA1KToNCiAgICAgICAgICAgIHJldHVybiAiY29tIg0KICAgICAgICBlcnJvcnMuYXBwZW5kKCJweXdpbjMyIHJhbiB0aGUgc2NyaXB0IGJ1dCBwcm9kdWNlZCBubyB1c2FibGUgb3V0cHV0IGZpbGUiKQ0KICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZXJyb3I6ICAjIG5vcWE6IEJMRTAwMSAtIHJlcG9ydGVkIHRvIHRoZSB1c2VyIHZlcmJhdGltDQogICAgICAgIGVycm9ycy5hcHBlbmQoInB5d2luMzI6ICVzIiAlIGVycm9yKQ0KDQogICAgcG93ZXJzaGVsbCA9IHNodXRpbC53aGljaCgicG93ZXJzaGVsbCIpIG9yIHNodXRpbC53aGljaCgicHdzaCIpDQogICAgaWYgcG93ZXJzaGVsbDoNCiAgICAgICAgY29tbWFuZCA9ICgNCiAgICAgICAgICAgICIkRXJyb3JBY3Rpb25QcmVmZXJlbmNlPSdTdG9wJzsiDQogICAgICAgICAgICAiJGFwcCA9IE5ldy1PYmplY3QgLUNvbU9iamVjdCBQaG90b3Nob3AuQXBwbGljYXRpb247Ig0KICAgICAgICAgICAgIiRhcHAuRG9KYXZhU2NyaXB0RmlsZSgnJXMnKSIgJSBzdHIoc2NyaXB0KS5yZXBsYWNlKCInIiwgIicnIikNCiAgICAgICAgKQ0KICAgICAgICB0cnk6DQogICAgICAgICAgICBkb25lID0gc3VicHJvY2Vzcy5ydW4oDQogICAgICAgICAgICAgICAgW3Bvd2Vyc2hlbGwsICItTm9Qcm9maWxlIiwgIi1Ob25JbnRlcmFjdGl2ZSIsICItQ29tbWFuZCIsIGNvbW1hbmRdLA0KICAgICAgICAgICAgICAgIGNhcHR1cmVfb3V0cHV0PVRydWUsIHRleHQ9VHJ1ZSwgdGltZW91dD10aW1lb3V0LA0KICAgICAgICAgICAgKQ0KICAgICAgICAgICAgaWYgd2FpdF9mb3Jfb3V0cHV0KG91dF9maWxlLCA1KToNCiAgICAgICAgICAgICAgICByZXR1cm4gInBvd2Vyc2hlbGwiDQogICAgICAgICAgICBlcnJvcnMuYXBwZW5kKCJwb3dlcnNoZWxsOiAlcyIgJSAoZG9uZS5zdGRlcnIgb3IgZG9uZS5zdGRvdXQgb3IgIm5vIG91dHB1dCBmaWxlIikuc3RyaXAoKSkNCiAgICAgICAgZXhjZXB0IHN1YnByb2Nlc3MuVGltZW91dEV4cGlyZWQ6DQogICAgICAgICAgICBlcnJvcnMuYXBwZW5kKCJwb3dlcnNoZWxsOiB0aW1lb3V0IGFmdGVyICVzcyIgJSB0aW1lb3V0KQ0KICAgICAgICBleGNlcHQgT1NFcnJvciBhcyBlcnJvcjoNCiAgICAgICAgICAgIGVycm9ycy5hcHBlbmQoInBvd2Vyc2hlbGw6ICVzIiAlIGVycm9yKQ0KICAgIGVsc2U6DQogICAgICAgIGVycm9ycy5hcHBlbmQoInBvd2Vyc2hlbGwgbm90IGZvdW5kIG9uIFBBVEgiKQ0KDQogICAgcmFpc2UgRGljdXRFcnJvcigiUGhvdG9zaG9wIOC5hOC4oeC5iOC4leC4reC4muC4quC4meC4reC4hyDigJQgIiArICIgfCAiLmpvaW4oZXJyb3JzKSkNCg0KDQpkZWYgcnVuX3Bob3Rvc2hvcF9tYWMoc2NyaXB0LCBvdXRfZmlsZSwgdGltZW91dCwgYXBwX3BhdGgpOg0KICAgIGlmIG5vdCBhcHBfcGF0aDoNCiAgICAgICAgcmFpc2UgRGljdXRFcnJvcigi4LmE4Lih4LmI4Lie4LiaIEFkb2JlIFBob3Rvc2hvcCDguYPguJkgL0FwcGxpY2F0aW9ucyIpDQogICAgbmFtZSA9IGFwcF9wYXRoLnN0ZW0NCiAgICBlcnJvcnMgPSBbXQ0KICAgIHRyeToNCiAgICAgICAgZG9uZSA9IHN1YnByb2Nlc3MucnVuKA0KICAgICAgICAgICAgWw0KICAgICAgICAgICAgICAgICJvc2FzY3JpcHQiLA0KICAgICAgICAgICAgICAgICItZSIsICd0ZWxsIGFwcGxpY2F0aW9uICIlcyIgdG8gYWN0aXZhdGUnICUgbmFtZSwNCiAgICAgICAgICAgICAgICAiLWUiLCAndGVsbCBhcHBsaWNhdGlvbiAiJXMiIHRvIGRvIGphdmFzY3JpcHQgKFBPU0lYIGZpbGUgIiVzIiknICUgKG5hbWUsIHNjcmlwdCksDQogICAgICAgICAgICBdLA0KICAgICAgICAgICAgY2FwdHVyZV9vdXRwdXQ9VHJ1ZSwgdGV4dD1UcnVlLCB0aW1lb3V0PXRpbWVvdXQsDQogICAgICAgICkNCiAgICAgICAgIyBBIHNob3J0IGFwcGVhciB3aW5kb3c6IGlmIG9zYXNjcmlwdCByZWFsbHkgZGlkIHJ1biB0aGUgc2NyaXB0IHRoZSBmaWxlDQogICAgICAgICMgaXMgYWxyZWFkeSB0aGVyZSwgYW5kIHdhaXRpbmcgbG9uZ2VyIG9ubHkgZGVsYXlzIHRoZSBvcGVuIC1hIGZhbGxiYWNrLg0KICAgICAgICBpZiB3YWl0X2Zvcl9vdXRwdXQob3V0X2ZpbGUsIDMpOg0KICAgICAgICAgICAgcmV0dXJuICJhcHBsZS1ldmVudHMiDQogICAgICAgIGVycm9ycy5hcHBlbmQoIm9zYXNjcmlwdDogJXMiICUgKGRvbmUuc3RkZXJyIG9yIGRvbmUuc3Rkb3V0IG9yICJubyBvdXRwdXQgZmlsZSIpLnN0cmlwKCkpDQogICAgZXhjZXB0IHN1YnByb2Nlc3MuVGltZW91dEV4cGlyZWQ6DQogICAgICAgIGVycm9ycy5hcHBlbmQoIm9zYXNjcmlwdDogdGltZW91dCBhZnRlciAlc3MiICUgdGltZW91dCkNCiAgICBleGNlcHQgT1NFcnJvciBhcyBlcnJvcjoNCiAgICAgICAgZXJyb3JzLmFwcGVuZCgib3Nhc2NyaXB0OiAlcyIgJSBlcnJvcikNCg0KICAgICMgRmFsbGJhY2s6IGhhbmQgdGhlIC5qc3ggdG8gUGhvdG9zaG9wLiBOZWVkcyBubyBBdXRvbWF0aW9uIHBlcm1pc3Npb24gYnV0DQogICAgIyBpcyBhc3luY2hyb25vdXMsIHNvIHRoZSBvdXRwdXQgZmlsZSBoYXMgdG8gYmUgcG9sbGVkIGZvci4NCiAgICB0cnk6DQogICAgICAgIHN1YnByb2Nlc3MucnVuKFsib3BlbiIsICItYSIsIHN0cihhcHBfcGF0aCksIHN0cihzY3JpcHQpXSwgY2FwdHVyZV9vdXRwdXQ9VHJ1ZSwgdGV4dD1UcnVlLCB0aW1lb3V0PTMwKQ0KICAgIGV4Y2VwdCAoc3VicHJvY2Vzcy5UaW1lb3V0RXhwaXJlZCwgT1NFcnJvcikgYXMgZXJyb3I6DQogICAgICAgIGVycm9ycy5hcHBlbmQoIm9wZW4gLWE6ICVzIiAlIGVycm9yKQ0KICAgICMgb3BlbiAtYSByZXR1cm5zIGFzIHNvb24gYXMgUGhvdG9zaG9wIGhhcyBiZWVuIGhhbmRlZCB0aGUgc2NyaXB0LCBzbyB0aGlzDQogICAgIyBoYXMgdG8gd2FpdCBmb3IgYSBjb21wbGV0ZSBmaWxlLCBub3QgbWVyZWx5IGZvciBvbmUgdG8gYXBwZWFyLg0KICAgIGlmIHdhaXRfZm9yX291dHB1dChvdXRfZmlsZSwgdGltZW91dCk6DQogICAgICAgIHJldHVybiAib3Blbi1hIg0KICAgIGVycm9ycy5hcHBlbmQoIm9wZW4gLWE6IG5vIGNvbXBsZXRlIG91dHB1dCBmaWxlIHdpdGhpbiAlc3MiICUgdGltZW91dCkNCg0KICAgIHJhaXNlIERpY3V0RXJyb3IoDQogICAgICAgICJQaG90b3Nob3Ag4LmE4Lih4LmI4LiV4Lit4Lia4Liq4LiZ4Lit4LiHIOKAlCAiICsgIiB8ICIuam9pbihlcnJvcnMpDQogICAgICAgICsgIiB8IOC4luC5ieC4suC4guC4tuC5ieC4mSBOb3QgYXV0aG9yaXplZCDguYPguKvguYnguYDguJvguLTguJQgU3lzdGVtIFNldHRpbmdzID4gUHJpdmFjeSAmIFNlY3VyaXR5ID4gQXV0b21hdGlvbiINCiAgICApDQoNCg0KZGVmIGRpY3V0X2J5dGVzKHBheWxvYWQsIG1pbWUsIHRpbWVvdXQsIGtlZXBfd29yaywgdHJpbT1UcnVlKToNCiAgICAiIiJSZW1vdmUgdGhlIGJhY2tncm91bmQgZnJvbSBpbWFnZSBieXRlcyBhbmQgcmV0dXJuIHRyYW5zcGFyZW50IFBORyBieXRlcy4iIiINCiAgICBzdGF0dXMgPSBwaG90b3Nob3Bfc3RhdHVzKCkNCiAgICBpZiBub3Qgc3RhdHVzWyJmb3VuZCJdOg0KICAgICAgICByYWlzZSBEaWN1dEVycm9yKCLguYTguKHguYjguJ7guJogQWRvYmUgUGhvdG9zaG9wIOC4muC4meC5gOC4hOC4o+C4t+C5iOC4reC4h+C4meC4teC5iSAo4LiV4LmJ4Lit4LiH4LmA4Lib4LmH4LiZIDIwMjIg4LiC4Li24LmJ4LiZ4LmE4LibKSIpDQoNCiAgICBzdWZmaXggPSBFWFRFTlNJT05fQllfTUlNRS5nZXQoKG1pbWUgb3IgIiIpLmxvd2VyKCksICIucG5nIikNCiAgICB3b3JrID0gUGF0aCh0ZW1wZmlsZS5nZXR0ZW1wZGlyKCkpIC8gImRpY3V0LWJyaWRnZSIgLyB1dWlkLnV1aWQ0KCkuaGV4DQogICAgd29yay5ta2RpcihwYXJlbnRzPVRydWUsIGV4aXN0X29rPVRydWUpDQogICAgc3JjID0gd29yayAvICgic291cmNlIiArIHN1ZmZpeCkNCiAgICBvdXQgPSB3b3JrIC8gInNvdXJjZV9kaWN1dC5wbmciDQogICAgc2NyaXB0ID0gd29yayAvICJydW4uanN4Ig0KICAgIHNyYy53cml0ZV9ieXRlcyhwYXlsb2FkKQ0KICAgIHNjcmlwdC53cml0ZV90ZXh0KA0KICAgICAgICBKU1hfVEVNUExBVEUgJSB7InNyYyI6IGpzeF9wYXRoKHNyYyksICJvdXQiOiBqc3hfcGF0aChvdXQpLCAidHJpbSI6IFRSSU1fTElORSBpZiB0cmltIGVsc2UgIiJ9LA0KICAgICAgICBlbmNvZGluZz0idXRmLTgiLA0KICAgICkNCg0KICAgIHN0YXJ0ZWQgPSB0aW1lLnRpbWUoKQ0KICAgIHRyeToNCiAgICAgICAgd2l0aCBQSE9UT1NIT1BfTE9DSzoNCiAgICAgICAgICAgIGlmIElTX1dJTkRPV1M6DQogICAgICAgICAgICAgICAgbWV0aG9kID0gcnVuX3Bob3Rvc2hvcF93aW5kb3dzKHNjcmlwdCwgb3V0LCB0aW1lb3V0KQ0KICAgICAgICAgICAgZWxpZiBJU19NQUM6DQogICAgICAgICAgICAgICAgbWV0aG9kID0gcnVuX3Bob3Rvc2hvcF9tYWMoc2NyaXB0LCBvdXQsIHRpbWVvdXQsIGZpbmRfcGhvdG9zaG9wX21hYygpKQ0KICAgICAgICAgICAgZWxzZToNCiAgICAgICAgICAgICAgICByYWlzZSBEaWN1dEVycm9yKCLguKPguK3guIfguKPguLHguJrguYDguInguJ7guLLguLAgV2luZG93cyDguYHguKXguLAgbWFjT1MiKQ0KICAgICAgICByZXN1bHQgPSBvdXQucmVhZF9ieXRlcygpDQogICAgICAgIGlmIG5vdCByZXN1bHQ6DQogICAgICAgICAgICByYWlzZSBEaWN1dEVycm9yKCJQaG90b3Nob3Ag4LiE4Li34LiZ4LmE4Lif4Lil4LmM4Lin4LmI4Liy4LiHIikNCiAgICAgICAgcmV0dXJuIHsNCiAgICAgICAgICAgICJwbmciOiByZXN1bHQsDQogICAgICAgICAgICAibWV0aG9kIjogbWV0aG9kLA0KICAgICAgICAgICAgIm1zIjogaW50KCh0aW1lLnRpbWUoKSAtIHN0YXJ0ZWQpICogMTAwMCksDQogICAgICAgICAgICAicGhvdG9zaG9wIjogc3RhdHVzWyJuYW1lIl0sDQogICAgICAgIH0NCiAgICBmaW5hbGx5Og0KICAgICAgICBpZiBub3Qga2VlcF93b3JrOg0KICAgICAgICAgICAgc2h1dGlsLnJtdHJlZSh3b3JrLCBpZ25vcmVfZXJyb3JzPVRydWUpDQoNCg0KZGVmIGRlY29kZV9yZXF1ZXN0X2ltYWdlKGJvZHkpOg0KICAgIGRhdGFfdXJsID0gYm9keS5nZXQoImRhdGFVcmwiKSBvciAiIg0KICAgIGlmIGRhdGFfdXJsOg0KICAgICAgICBtYXRjaCA9IERBVEFfVVJMX1JFLm1hdGNoKGRhdGFfdXJsLnN0cmlwKCkpDQogICAgICAgIGlmIG5vdCBtYXRjaDoNCiAgICAgICAgICAgIHJhaXNlIERpY3V0RXJyb3IoImRhdGFVcmwg4LmE4Lih4LmI4LiW4Li54LiB4LiV4LmJ4Lit4LiHICjguJXguYnguK3guIfguYDguJvguYfguJkgYmFzZTY0IGRhdGEgVVJMKSIpDQogICAgICAgIHJldHVybiBiYXNlNjQuYjY0ZGVjb2RlKG1hdGNoLmdyb3VwKCJwYXlsb2FkIikpLCBtYXRjaC5ncm91cCgibWltZSIpIG9yICJpbWFnZS9wbmciDQogICAgcmF3ID0gYm9keS5nZXQoImJhc2U2NCIpIG9yICIiDQogICAgaWYgcmF3Og0KICAgICAgICByZXR1cm4gYmFzZTY0LmI2NGRlY29kZShyYXcpLCBib2R5LmdldCgibWltZSIpIG9yICJpbWFnZS9wbmciDQogICAgcmFpc2UgRGljdXRFcnJvcigi4LmE4Lih4LmI4Lih4Li14LiC4LmJ4Lit4Lih4Li54Lil4Lij4Li54Lib4LmD4LiZIHJlcXVlc3QiKQ0KDQoNCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCiMgSFRUUCBsYXllcg0KIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KDQpjbGFzcyBCcmlkZ2VIYW5kbGVyKEJhc2VIVFRQUmVxdWVzdEhhbmRsZXIpOg0KICAgIHNlcnZlcl92ZXJzaW9uID0gIkRpY3V0UFNCcmlkZ2UvIiArIFZFUlNJT04NCiAgICBwcm90b2NvbF92ZXJzaW9uID0gIkhUVFAvMS4xIg0KICAgIHRpbWVvdXRfc2Vjb25kcyA9IERFRkFVTFRfVElNRU9VVA0KICAgIGtlZXBfd29yayA9IEZhbHNlDQoNCiAgICBkZWYgbG9nX21lc3NhZ2Uoc2VsZiwgZm10LCAqYXJncyk6DQogICAgICAgIGVtaXQoZm10ICUgYXJncykNCg0KICAgICMgLS0gaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCiAgICBkZWYgY29yc19oZWFkZXJzKHNlbGYsIG9yaWdpbik6DQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbiIsIG9yaWdpbiBvciAiKiIpDQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIlZhcnkiLCAiT3JpZ2luIikNCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyIsICJHRVQsIFBPU1QsIE9QVElPTlMiKQ0KICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzIiwgIkNvbnRlbnQtVHlwZSIpDQogICAgICAgICMgQ2hyb21lJ3MgUHJpdmF0ZSBOZXR3b3JrIEFjY2VzcyBwcmVmbGlnaHQgZm9yIGh0dHBzIC0+IDEyNy4wLjAuMS4NCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctUHJpdmF0ZS1OZXR3b3JrIiwgInRydWUiKQ0KICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1NYXgtQWdlIiwgIjYwMCIpDQoNCiAgICBkZWYgcmVwbHkoc2VsZiwgc3RhdHVzLCBwYXlsb2FkKToNCiAgICAgICAgb3JpZ2luID0gc2VsZi5oZWFkZXJzLmdldCgiT3JpZ2luIikNCiAgICAgICAgYm9keSA9IGpzb24uZHVtcHMocGF5bG9hZCwgZW5zdXJlX2FzY2lpPUZhbHNlKS5lbmNvZGUoInV0Zi04IikNCiAgICAgICAgc2VsZi5zZW5kX3Jlc3BvbnNlKHN0YXR1cykNCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1UeXBlIiwgImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLTgiKQ0KICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LUxlbmd0aCIsIHN0cihsZW4oYm9keSkpKQ0KICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDYWNoZS1Db250cm9sIiwgIm5vLXN0b3JlIikNCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiWC1Db250ZW50LVR5cGUtT3B0aW9ucyIsICJub3NuaWZmIikNCiAgICAgICAgc2VsZi5jb3JzX2hlYWRlcnMob3JpZ2luKQ0KICAgICAgICBzZWxmLmVuZF9oZWFkZXJzKCkNCiAgICAgICAgc2VsZi53ZmlsZS53cml0ZShib2R5KQ0KDQogICAgZGVmIGd1YXJkX29yaWdpbihzZWxmKToNCiAgICAgICAgb3JpZ2luID0gc2VsZi5oZWFkZXJzLmdldCgiT3JpZ2luIikNCiAgICAgICAgaWYgb3JpZ2luX2FsbG93ZWQob3JpZ2luKToNCiAgICAgICAgICAgIHJldHVybiBUcnVlDQogICAgICAgIHNlbGYucmVwbHkoNDAzLCB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJvcmlnaW4g4LmE4Lih4LmI4LmE4LiU4LmJ4Lij4Lix4Lia4Lit4LiZ4Li44LiN4Liy4LiVOiAlcyIgJSBvcmlnaW59KQ0KICAgICAgICByZXR1cm4gRmFsc2UNCg0KICAgICMgLS0gcm91dGVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0NCiAgICBkZWYgZG9fT1BUSU9OUyhzZWxmKTogICMgbm9xYTogTjgwMiAtIEJhc2VIVFRQUmVxdWVzdEhhbmRsZXIgbmFtaW5nDQogICAgICAgIG9yaWdpbiA9IHNlbGYuaGVhZGVycy5nZXQoIk9yaWdpbiIpDQogICAgICAgIGlmIG5vdCBvcmlnaW5fYWxsb3dlZChvcmlnaW4pOg0KICAgICAgICAgICAgc2VsZi5zZW5kX3Jlc3BvbnNlKDQwMykNCiAgICAgICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNvbnRlbnQtTGVuZ3RoIiwgIjAiKQ0KICAgICAgICAgICAgc2VsZi5lbmRfaGVhZGVycygpDQogICAgICAgICAgICByZXR1cm4NCiAgICAgICAgc2VsZi5zZW5kX3Jlc3BvbnNlKDIwNCkNCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1MZW5ndGgiLCAiMCIpDQogICAgICAgIHNlbGYuY29yc19oZWFkZXJzKG9yaWdpbikNCiAgICAgICAgc2VsZi5lbmRfaGVhZGVycygpDQoNCiAgICBkZWYgZG9fR0VUKHNlbGYpOiAgIyBub3FhOiBOODAyDQogICAgICAgIGlmIHNlbGYucGF0aC5zcGxpdCgiPyIpWzBdIG5vdCBpbiAoIi9oZWFsdGgiLCAiLyIpOg0KICAgICAgICAgICAgc2VsZi5yZXBseSg0MDQsIHsib2siOiBGYWxzZSwgImVycm9yIjogIm5vdCBmb3VuZCJ9KQ0KICAgICAgICAgICAgcmV0dXJuDQogICAgICAgIGlmIG5vdCBzZWxmLmd1YXJkX29yaWdpbigpOg0KICAgICAgICAgICAgcmV0dXJuDQogICAgICAgIHN0YXR1cyA9IHBob3Rvc2hvcF9zdGF0dXMoKQ0KICAgICAgICBzZWxmLnJlcGx5KDIwMCwgew0KICAgICAgICAgICAgIm9rIjogVHJ1ZSwNCiAgICAgICAgICAgICJuYW1lIjogImRpY3V0LXBzLWJyaWRnZSIsDQogICAgICAgICAgICAidmVyc2lvbiI6IFZFUlNJT04sDQogICAgICAgICAgICAicGxhdGZvcm0iOiBzeXMucGxhdGZvcm0sDQogICAgICAgICAgICAib3MiOiBwbGF0Zm9ybS5wbGF0Zm9ybSgpLA0KICAgICAgICAgICAgInBob3Rvc2hvcCI6IHN0YXR1c1sibmFtZSJdLA0KICAgICAgICAgICAgInBob3Rvc2hvcEZvdW5kIjogc3RhdHVzWyJmb3VuZCJdLA0KICAgICAgICAgICAgImJ1c3kiOiBQSE9UT1NIT1BfTE9DSy5sb2NrZWQoKSwNCiAgICAgICAgfSkNCg0KICAgIGRlZiBkb19QT1NUKHNlbGYpOiAgIyBub3FhOiBOODAyDQogICAgICAgIGlmIHNlbGYucGF0aC5zcGxpdCgiPyIpWzBdICE9ICIvZGljdXQiOg0KICAgICAgICAgICAgc2VsZi5yZXBseSg0MDQsIHsib2siOiBGYWxzZSwgImVycm9yIjogIm5vdCBmb3VuZCJ9KQ0KICAgICAgICAgICAgcmV0dXJuDQogICAgICAgIGlmIG5vdCBzZWxmLmd1YXJkX29yaWdpbigpOg0KICAgICAgICAgICAgcmV0dXJuDQogICAgICAgIHRyeToNCiAgICAgICAgICAgIGxlbmd0aCA9IGludChzZWxmLmhlYWRlcnMuZ2V0KCJDb250ZW50LUxlbmd0aCIpIG9yIDApDQogICAgICAgIGV4Y2VwdCBWYWx1ZUVycm9yOg0KICAgICAgICAgICAgbGVuZ3RoID0gMA0KICAgICAgICBpZiBsZW5ndGggPD0gMDoNCiAgICAgICAgICAgIHNlbGYucmVwbHkoNDAwLCB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJyZXF1ZXN0IOC4p+C5iOC4suC4hyJ9KQ0KICAgICAgICAgICAgcmV0dXJuDQogICAgICAgIGlmIGxlbmd0aCA+IE1BWF9CT0RZX0JZVEVTOg0KICAgICAgICAgICAgc2VsZi5yZXBseSg0MTMsIHsib2siOiBGYWxzZSwgImVycm9yIjogIuC4o+C4ueC4m+C5g+C4q+C4jeC5iOC5gOC4geC4tOC4mSAlZCBNQiIgJSAoTUFYX0JPRFlfQllURVMgLy8gMTAyNCAvLyAxMDI0KX0pDQogICAgICAgICAgICByZXR1cm4NCiAgICAgICAgdHJ5Og0KICAgICAgICAgICAgYm9keSA9IGpzb24ubG9hZHMoc2VsZi5yZmlsZS5yZWFkKGxlbmd0aCkuZGVjb2RlKCJ1dGYtOCIpKQ0KICAgICAgICBleGNlcHQgKFZhbHVlRXJyb3IsIFVuaWNvZGVEZWNvZGVFcnJvcikgYXMgZXJyb3I6DQogICAgICAgICAgICBzZWxmLnJlcGx5KDQwMCwgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiAi4Lit4LmI4Liy4LiZIEpTT04g4LmE4Lih4LmI4LmE4LiU4LmJOiAlcyIgJSBlcnJvcn0pDQogICAgICAgICAgICByZXR1cm4NCg0KICAgICAgICBuYW1lID0gc3RyKGJvZHkuZ2V0KCJuYW1lIikgb3IgImltYWdlIikNCiAgICAgICAgdHJpbSA9IGJvZHkuZ2V0KCJ0cmltIikgaXMgbm90IEZhbHNlDQogICAgICAgIHRyeToNCiAgICAgICAgICAgIHBheWxvYWQsIG1pbWUgPSBkZWNvZGVfcmVxdWVzdF9pbWFnZShib2R5KQ0KICAgICAgICAgICAgcmVzdWx0ID0gZGljdXRfYnl0ZXMocGF5bG9hZCwgbWltZSwgc2VsZi50aW1lb3V0X3NlY29uZHMsIHNlbGYua2VlcF93b3JrLCB0cmltKQ0KICAgICAgICBleGNlcHQgRGljdXRFcnJvciBhcyBlcnJvcjoNCiAgICAgICAgICAgIHNlbGYubG9nX21lc3NhZ2UoImRpY3V0IEZBSUxFRCAlcyAtICVzIiwgbmFtZSwgZXJyb3IpDQogICAgICAgICAgICBzZWxmLnJlcGx5KDUwMiwgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiBzdHIoZXJyb3IpfSkNCiAgICAgICAgICAgIHJldHVybg0KICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGVycm9yOiAgIyBub3FhOiBCTEUwMDEgLSBzdXJmYWNlIHRoZSByZWFsIGNhdXNlDQogICAgICAgICAgICBzZWxmLmxvZ19tZXNzYWdlKCJkaWN1dCBFUlJPUiAlcyAtICVzIiwgbmFtZSwgZXJyb3IpDQogICAgICAgICAgICBzZWxmLnJlcGx5KDUwMCwgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiAiJXM6ICVzIiAlICh0eXBlKGVycm9yKS5fX25hbWVfXywgZXJyb3IpfSkNCiAgICAgICAgICAgIHJldHVybg0KDQogICAgICAgIHNlbGYubG9nX21lc3NhZ2UoImRpY3V0IG9rICVzICglcywgJXNtcykiLCBuYW1lLCByZXN1bHRbIm1ldGhvZCJdLCByZXN1bHRbIm1zIl0pDQogICAgICAgIHNlbGYucmVwbHkoMjAwLCB7DQogICAgICAgICAgICAib2siOiBUcnVlLA0KICAgICAgICAgICAgIm5hbWUiOiBuYW1lLA0KICAgICAgICAgICAgIm1ldGhvZCI6IHJlc3VsdFsibWV0aG9kIl0sDQogICAgICAgICAgICAibXMiOiByZXN1bHRbIm1zIl0sDQogICAgICAgICAgICAicGhvdG9zaG9wIjogcmVzdWx0WyJwaG90b3Nob3AiXSwNCiAgICAgICAgICAgICJ0cmltbWVkIjogdHJpbSwNCiAgICAgICAgICAgICJieXRlcyI6IGxlbihyZXN1bHRbInBuZyJdKSwNCiAgICAgICAgICAgICJkYXRhVXJsIjogImRhdGE6aW1hZ2UvcG5nO2Jhc2U2NCwiICsgYmFzZTY0LmI2NGVuY29kZShyZXN1bHRbInBuZyJdKS5kZWNvZGUoImFzY2lpIiksDQogICAgICAgIH0pDQoNCg0KZGVmIHNlbGZ0ZXN0KGltYWdlX3BhdGgsIHRpbWVvdXQsIGtlZXBfd29yayk6DQogICAgc291cmNlID0gUGF0aChpbWFnZV9wYXRoKQ0KICAgIGlmIG5vdCBzb3VyY2UuaXNfZmlsZSgpOg0KICAgICAgICBlbWl0KCLguYTguKHguYjguJ7guJrguYTguJ/guKXguYw6ICVzIiAlIHNvdXJjZSkNCiAgICAgICAgcmV0dXJuIDENCiAgICBzdGF0dXMgPSBwaG90b3Nob3Bfc3RhdHVzKCkNCiAgICBlbWl0KCJwbGF0Zm9ybSAgOiAlcyIgJSBzeXMucGxhdGZvcm0pDQogICAgZW1pdCgicGhvdG9zaG9wIDogJXMiICUgKHN0YXR1c1sibmFtZSJdIG9yICJOT1QgRk9VTkQiKSkNCiAgICBpZiBub3Qgc3RhdHVzWyJmb3VuZCJdOg0KICAgICAgICByZXR1cm4gMQ0KICAgIG1pbWUgPSAiaW1hZ2UvcG5nIiBpZiBzb3VyY2Uuc3VmZml4Lmxvd2VyKCkgPT0gIi5wbmciIGVsc2UgImltYWdlL2pwZWciDQogICAgdHJ5Og0KICAgICAgICByZXN1bHQgPSBkaWN1dF9ieXRlcyhzb3VyY2UucmVhZF9ieXRlcygpLCBtaW1lLCB0aW1lb3V0LCBrZWVwX3dvcmspDQogICAgZXhjZXB0IERpY3V0RXJyb3IgYXMgZXJyb3I6DQogICAgICAgIGVtaXQoIkZBSUxFRDogJXMiICUgZXJyb3IpDQogICAgICAgIHJldHVybiAxDQogICAgb3V0ID0gc291cmNlLndpdGhfbmFtZShzb3VyY2Uuc3RlbSArICJfZGljdXQucG5nIikNCiAgICBvdXQud3JpdGVfYnl0ZXMocmVzdWx0WyJwbmciXSkNCiAgICBlbWl0KCJPSyAoJXMsICVzbXMpIC0+ICVzIiAlIChyZXN1bHRbIm1ldGhvZCJdLCByZXN1bHRbIm1zIl0sIG91dCkpDQogICAgcmV0dXJuIDANCg0KDQpkZWYgbWFpbigpOg0KICAgIHBhcnNlciA9IGFyZ3BhcnNlLkFyZ3VtZW50UGFyc2VyKGRlc2NyaXB0aW9uPSJEaWN1dCBQUyBCcmlkZ2UiKQ0KICAgIHBhcnNlci5hZGRfYXJndW1lbnQoIi0taG9zdCIsIGRlZmF1bHQ9REVGQVVMVF9IT1NUKQ0KICAgIHBhcnNlci5hZGRfYXJndW1lbnQoIi0tcG9ydCIsIHR5cGU9aW50LCBkZWZhdWx0PWludChvcy5lbnZpcm9uLmdldCgiRElDVVRfQlJJREdFX1BPUlQiLCBERUZBVUxUX1BPUlQpKSkNCiAgICBwYXJzZXIuYWRkX2FyZ3VtZW50KCItLXRpbWVvdXQiLCB0eXBlPWludCwgZGVmYXVsdD1ERUZBVUxUX1RJTUVPVVQpDQogICAgcGFyc2VyLmFkZF9hcmd1bWVudCgiLS1rZWVwLXdvcmsiLCBhY3Rpb249InN0b3JlX3RydWUiLCBoZWxwPSJrZWVwIHRoZSB0ZW1wIGZvbGRlciBmb3IgZGVidWdnaW5nIikNCiAgICBwYXJzZXIuYWRkX2FyZ3VtZW50KCItLXNlbGZ0ZXN0IiwgbWV0YXZhcj0iSU1BR0UiLCBoZWxwPSJjdXQgb25lIGZpbGUgYW5kIGV4aXQiKQ0KICAgIGFyZ3MgPSBwYXJzZXIucGFyc2VfYXJncygpDQoNCiAgICBsb2FkX2V4dHJhX29yaWdpbnMoKQ0KICAgIGlmIGFyZ3Muc2VsZnRlc3Q6DQogICAgICAgIHJhaXNlIFN5c3RlbUV4aXQoc2VsZnRlc3QoYXJncy5zZWxmdGVzdCwgYXJncy50aW1lb3V0LCBhcmdzLmtlZXBfd29yaykpDQoNCiAgICBCcmlkZ2VIYW5kbGVyLnRpbWVvdXRfc2Vjb25kcyA9IGFyZ3MudGltZW91dA0KICAgIEJyaWRnZUhhbmRsZXIua2VlcF93b3JrID0gYXJncy5rZWVwX3dvcmsNCiAgICBzZXJ2ZXIgPSBUaHJlYWRpbmdIVFRQU2VydmVyKChhcmdzLmhvc3QsIGFyZ3MucG9ydCksIEJyaWRnZUhhbmRsZXIpDQogICAgc3RhdHVzID0gcGhvdG9zaG9wX3N0YXR1cygpDQogICAgZW1pdCgiRGljdXQgUFMgQnJpZGdlICVzIiAlIFZFUlNJT04pDQogICAgZW1pdCgibGlzdGVuaW5nIDogaHR0cDovLyVzOiVkIiAlIChhcmdzLmhvc3QsIGFyZ3MucG9ydCkpDQogICAgZW1pdCgicGhvdG9zaG9wIDogJXMiICUgKHN0YXR1c1sibmFtZSJdIG9yICJOT1QgRk9VTkQgLSDguJXguLTguJTguJXguLHguYnguIcgUGhvdG9zaG9wIDIwMjIrIOC4geC5iOC4reC4mSIpKQ0KICAgIGVtaXQoInN0b3AgICAgICA6IEN0cmwrQyIpDQogICAgdHJ5Og0KICAgICAgICBzZXJ2ZXIuc2VydmVfZm9yZXZlcigpDQogICAgZXhjZXB0IEtleWJvYXJkSW50ZXJydXB0Og0KICAgICAgICBlbWl0KCJzdG9wcGVkIikNCiAgICBmaW5hbGx5Og0KICAgICAgICBzZXJ2ZXIuc2VydmVyX2Nsb3NlKCkNCg0KDQppZiBfX25hbWVfXyA9PSAiX19tYWluX18iOg0KICAgIG1haW4oKQ0K';
  /* BRIDGE_SOURCE_B64_END */

  var probeCache = null;
  var probeInFlight = null;

  // ---------------------------------------------------------------- helpers
  function isMac() {
    return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || '');
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    var settings = Object.assign({}, options, { signal: controller.signal });
    if (options && options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', function () { controller.abort(); }, { once: true });
    }
    return fetch(url, settings).finally(function () { clearTimeout(timer); });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('อ่านไฟล์รูปไม่สำเร็จ')); };
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    var comma = dataUrl.indexOf(',');
    var head = dataUrl.slice(0, comma);
    var mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    var binary = atob(dataUrl.slice(comma + 1));
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function canvasToDataUrl(canvas) {
    return canvas.toDataURL('image/png');
  }

  // Images that came from another origin have to go through a canvas anyway,
  // so a single normaliser covers every caller in the four tools.
  function toDataUrl(source) {
    if (!source) return Promise.reject(new Error('ไม่มีรูปให้ไดคัท'));
    if (typeof source === 'string') {
      if (source.indexOf('data:') === 0) return Promise.resolve(source);
      return fetch(source).then(function (response) {
        if (!response.ok) throw new Error('โหลดรูปไม่สำเร็จ (' + response.status + ')');
        return response.blob();
      }).then(blobToDataUrl);
    }
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      return Promise.resolve(canvasToDataUrl(source));
    }
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
      var canvas = document.createElement('canvas');
      canvas.width = source.naturalWidth || source.width;
      canvas.height = source.naturalHeight || source.height;
      canvas.getContext('2d').drawImage(source, 0, 0);
      return Promise.resolve(canvasToDataUrl(canvas));
    }
    if (typeof Blob !== 'undefined' && source instanceof Blob) return blobToDataUrl(source);
    return Promise.reject(new Error('รูปแบบรูปไม่รองรับ'));
  }

  // Plain numeric compare: the bridge only ever reports x.y.z.
  function olderThanRequired(version) {
    var have = String(version || '').split('.').map(Number);
    var need = REQUIRED_BRIDGE.split('.').map(Number);
    for (var i = 0; i < need.length; i += 1) {
      var a = have[i] || 0;
      if (a !== need[i]) return a < need[i];
    }
    return false;
  }

  // ----------------------------------------------------------------- probe
  function probe(options) {
    var force = options && options.force;
    var now = Date.now();
    if (!force && probeCache && now < probeCache.expires) return Promise.resolve(probeCache.value);
    if (!force && probeInFlight) return probeInFlight;

    probeInFlight = fetchWithTimeout(ENDPOINT + '/health', { cache: 'no-store' }, PROBE_TIMEOUT_MS)
      .then(function (response) {
        if (!response.ok) throw new Error('bridge ตอบ ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var stale = olderThanRequired(data.version || '');
        return {
          available: true,
          photoshopFound: !!data.photoshopFound,
          photoshop: data.photoshop || '',
          version: data.version || '',
          platform: data.platform || '',
          busy: !!data.busy,
          stale: stale,
          error: !data.photoshopFound
            ? 'ไม่พบ Adobe Photoshop บนเครื่องนี้ (ต้องเป็น 2022 ขึ้นไป)'
            : stale
              ? 'Dicut PS Bridge บนเครื่องนี้เป็นรุ่นเก่า (' + (data.version || 'ไม่ทราบรุ่น') + ') ต้องอัปเดตเป็น ' + REQUIRED_BRIDGE
              : ''
        };
      })
      .catch(function (error) {
        return {
          available: false,
          photoshopFound: false,
          photoshop: '',
          version: '',
          platform: '',
          busy: false,
          stale: false,
          error: error && error.name === 'AbortError'
            ? 'ต่อ Dicut PS Bridge ไม่ทัน (timeout)'
            : 'ยังไม่ได้เปิด Dicut PS Bridge บนเครื่องนี้'
        };
      })
      .then(function (value) {
        probeCache = { value: value, expires: Date.now() + (value.available ? PROBE_TTL_OK_MS : PROBE_TTL_FAIL_MS) };
        probeInFlight = null;
        return value;
      });
    return probeInFlight;
  }

  // ------------------------------------------------------------------- cut
  function cut(source, name, options) {
    var settings = options || {};
    return toDataUrl(source).then(function (dataUrl) {
      return fetchWithTimeout(ENDPOINT + '/dicut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // trim:false keeps the cut on the original canvas, which is what a
        // caller needs to show an aligned before/after comparison.
        body: JSON.stringify({ name: name || 'image', dataUrl: dataUrl, trim: settings.trim !== false }),
        signal: settings.signal
      }, settings.timeoutMs || CUT_TIMEOUT_MS);
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok || !data.ok) {
          throw new Error(data.error || ('Dicut PS ไม่สำเร็จ (' + response.status + ')'));
        }
        return {
          dataUrl: data.dataUrl,
          blob: dataUrlToBlob(data.dataUrl),
          bytes: data.bytes || 0,
          ms: data.ms || 0,
          method: data.method || '',
          photoshop: data.photoshop || ''
        };
      });
    }).catch(function (error) {
      probeCache = null;  // a failure may mean the bridge died: re-probe next time
      if (error && error.name === 'AbortError') throw new Error('ยกเลิกหรือรอ Photoshop นานเกินกำหนด');
      if (error instanceof TypeError) throw new Error('ติดต่อ Dicut PS Bridge ไม่ได้ — ตรวจว่าเปิดอยู่หรือยัง');
      throw error;
    });
  }

  // Photoshop is single-instance, so the queue is deliberately sequential.
  function cutMany(items, options) {
    var settings = options || {};
    var list = Array.prototype.slice.call(items || []);
    var results = [];
    var index = 0;

    function step() {
      if (index >= list.length) return Promise.resolve(results);
      if (settings.signal && settings.signal.aborted) return Promise.resolve(results);
      var item = list[index];
      if (settings.onProgress) settings.onProgress({ index: index, total: list.length, item: item, phase: 'start' });
      return cut(item.source, item.name, { signal: settings.signal, timeoutMs: settings.timeoutMs, trim: settings.trim })
        .then(function (result) {
          results.push({ item: item, ok: true, result: result });
          if (settings.onProgress) settings.onProgress({ index: index, total: list.length, item: item, phase: 'done', result: result });
        })
        .catch(function (error) {
          results.push({ item: item, ok: false, error: error });
          if (settings.onProgress) settings.onProgress({ index: index, total: list.length, item: item, phase: 'error', error: error });
        })
        .then(function () { index += 1; return step(); });
    }
    return step();
  }

  // ------------------------------------------------------------ help modal
  var helpNodes = null;
  var helpReturnFocus = null;

  // Shipped as a real stylesheet, not an injected <style> element: the Image
  // Downloader serves a Content-Security-Policy with style-src 'self' and no
  // 'unsafe-inline', which blocks inline style elements outright.
  function injectHelpStyles() {
    if (document.getElementById('dicut-ps-style')) return;
    var link = document.createElement('link');
    link.id = 'dicut-ps-style';
    link.rel = 'stylesheet';
    link.href = SCRIPT_URL ? SCRIPT_URL.replace(/dicut-ps\.js(\?.*)?$/, 'dicut-ps.css') : 'dicut-ps.css';
    document.head.appendChild(link);
  }

  // ------------------------------------------------- one-file installers
  // Both scripts carry the whole bridge as base64 and unpack it into
  // ~/.dicut-bridge, so the only thing a first-time user handles is one file.
  function wrapBase64(width) {
    var lines = [];
    for (var i = 0; i < BRIDGE_SOURCE_B64.length; i += width) lines.push(BRIDGE_SOURCE_B64.slice(i, i + width));
    return lines;
  }

  function windowsInstaller() {
    // certutil is the only base64 decoder guaranteed to exist before Python is
    // located, and it accepts the certificate envelope reliably.
    var lines = wrapBase64(76);
    var out = [
      '@echo off',
      'title Dicut PS Bridge setup',
      'setlocal',
      'set "DIR=%USERPROFILE%\\.dicut-bridge"',
      'if not exist "%DIR%" mkdir "%DIR%"',
      'set "B64=%DIR%\\bridge.b64"',
      'echo -----BEGIN CERTIFICATE----->"%B64%"'
    ];
    for (var i = 0; i < lines.length; i += 1) out.push('echo ' + lines[i] + '>>"%B64%"');
    out = out.concat([
      'echo -----END CERTIFICATE----->>"%B64%"',
      'certutil -f -decode "%B64%" "%DIR%\\dicut_bridge.py" >nul',
      'if errorlevel 1 (echo Could not unpack the bridge. & pause & exit /b 1)',
      'del "%B64%"',
      'set "PY="',
      'for /f "delims=" %%i in (\'where pythonw.exe 2^>nul\') do if not defined PY set "PY=%%i"',
      'if not defined PY for /f "delims=" %%i in (\'where python.exe 2^>nul\') do if not defined PY set "PY=%%i"',
      'if not defined PY for /f "delims=" %%i in (\'dir /b /ad "%LOCALAPPDATA%\\Programs\\Python" 2^>nul\') do ' +
        'if not defined PY if exist "%LOCALAPPDATA%\\Programs\\Python\\%%i\\pythonw.exe" set "PY=%LOCALAPPDATA%\\Programs\\Python\\%%i\\pythonw.exe"',
      'if not defined PY (echo Python 3 was not found. Install it from python.org and run this file again. & pause & exit /b 1)',
      // An already-running bridge owns the port, so a re-run to update would
      // otherwise leave the old build serving. Single quotes only: this line
      // has to survive being written into a .bat.
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*dicut_bridge.py*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1',
      'set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"',
      'echo @echo off>"%STARTUP%\\DicutPSBridge.cmd"',
      'echo start "" "%PY%" "%DIR%\\dicut_bridge.py">>"%STARTUP%\\DicutPSBridge.cmd"',
      'start "" "%PY%" "%DIR%\\dicut_bridge.py"',
      'echo.',
      'echo Starting the bridge...',
      // Do not claim success before the service actually answers: a bridge that
      // dies on startup used to print "installed and started" all the same.
      'set "OK="',
      'for /l %%i in (1,1,10) do (',
      '  if not defined OK (',
      '    curl -s -m 2 -o nul http://127.0.0.1:8799/health && set "OK=1"',
      '    if not defined OK ping -n 2 127.0.0.1 >nul',
      '  )',
      ')',
      'echo.',
      'if defined OK (',
      '  echo Dicut PS Bridge is running.',
      '  echo It will start again automatically every time you log in.',
      '  echo Go back to the browser and press the recheck button.',
      ') else (',
      '  echo PROBLEM: the bridge was installed but is not answering.',
      '  echo Run this line to see the reason, then send the output:',
      '  echo     "%PY:pythonw.exe=python.exe%" "%DIR%\\dicut_bridge.py"',
      '  echo A log is also written to "%DIR%\\bridge.log"',
      ')',
      'echo.',
      // "timeout" refuses to run whenever stdin is redirected, so the window
      // would close before the message could be read.
      'pause >nul'
    ]);
    return { name: 'dicut-ps-setup.bat', mime: 'application/octet-stream', text: out.join('\r\n') + '\r\n' };
  }

  function macInstaller() {
    // python3 is required by the bridge anyway, so it also decodes the payload
    // and the BSD/GNU base64 flag differences never come up.
    var out = [
      '#!/bin/bash',
      '# Dicut PS Bridge setup — unpacks and starts the bridge for this user.',
      'set -e',
      'DIR="$HOME/.dicut-bridge"',
      'LABEL="com.central.dicutps.bridge"',
      'PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"',
      'PY="$(command -v python3 || true)"',
      'if [ -z "$PY" ]; then echo "python3 not found — run: xcode-select --install"; exit 1; fi',
      'mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"',
      '"$PY" -c \'import base64,sys;open(sys.argv[1],"wb").write(base64.b64decode(sys.stdin.read()))\' "$DIR/dicut_bridge.py" <<\'DICUTB64\'',
      BRIDGE_SOURCE_B64,
      'DICUTB64',
      'launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true',
      'cat > "$PLIST" <<PLISTEOF',
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      '    <key>Label</key><string>$LABEL</string>',
      '    <key>ProgramArguments</key><array><string>$PY</string><string>$DIR/dicut_bridge.py</string></array>',
      '    <key>RunAtLoad</key><true/>',
      '    <key>KeepAlive</key><true/>',
      '    <key>StandardOutPath</key><string>$HOME/Library/Logs/dicut-ps-bridge.log</string>',
      '    <key>StandardErrorPath</key><string>$HOME/Library/Logs/dicut-ps-bridge.log</string>',
      '</dict>',
      '</plist>',
      'PLISTEOF',
      'launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST"',
      'sleep 2',
      'if curl -fsS http://127.0.0.1:8799/health >/dev/null 2>&1; then',
      '  echo "Dicut PS Bridge installed and running."',
      'else',
      '  echo "Installed, but it has not answered yet — check ~/Library/Logs/dicut-ps-bridge.log"',
      'fi',
      'echo "Go back to the browser and press the recheck button."',
      'echo "The first cut asks macOS for permission to control Photoshop."'
    ];
    return { name: 'dicut-ps-setup.command', mime: 'application/octet-stream', text: out.join('\n') + '\n' };
  }

  function downloadInstaller(target) {
    if (!BRIDGE_SOURCE_B64) throw new Error('ตัวติดตั้งยังไม่ถูกฝังไว้ในไฟล์นี้');
    var file = target === 'mac' ? macInstaller() : windowsInstaller();
    var url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
    var link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    return file.name;
  }

  // The async clipboard rejects whenever the document is not focused, so the
  // textarea route has to stay reachable as a fallback, not only as a polyfill.
  function copyViaTextarea(text) {
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
      document.body.removeChild(area);
      ok ? resolve() : reject(new Error('คัดลอกไม่สำเร็จ'));
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return copyViaTextarea(text); });
    }
    return copyViaTextarea(text);
  }

  // Finder will not run a downloaded .command until it is executable, and a
  // downloaded .bat trips SmartScreen, so each platform also gets the exact
  // terminal line that always works.
  var RUN_COMMAND = {
    windows: '"%USERPROFILE%\\Downloads\\dicut-ps-setup.bat"',
    mac: 'bash ~/Downloads/dicut-ps-setup.command'
  };

  function platformInstructions(target) {
    var isMacTarget = target === 'mac';
    return [
      '<li>กดปุ่มนี้เพื่อโหลดตัวติดตั้ง (ไฟล์เดียว มีทุกอย่างอยู่ข้างในแล้ว)',
      '<button type="button" class="dicut-ps-step-btn is-main dicut-ps-download">⬇ ดาวน์โหลดตัวติดตั้ง</button></li>',
      isMacTarget
        ? '<li>เปิด Terminal วางคำสั่งนี้แล้ว Enter<code>' + RUN_COMMAND.mac + '</code>' +
          '<button type="button" class="dicut-ps-step-btn dicut-ps-copy">คัดลอกคำสั่ง</button>' +
          '<div class="dicut-ps-note">ดับเบิลคลิกไฟล์ตรง ๆ ไม่ได้ เพราะไฟล์ที่โหลดมายังไม่มีสิทธิ์รัน</div></li>'
        : '<li>ดับเบิลคลิกไฟล์ที่โหลดมาได้เลย ถ้า Windows เตือนให้กด More info &gt; Run anyway' +
          '<button type="button" class="dicut-ps-step-btn dicut-ps-copy">คัดลอกคำสั่ง (ถ้าอยากรันจาก Command Prompt)</button></li>',
      '<li>ตัวติดตั้งจะเปิด Bridge ให้ทันที และเปิดเองทุกครั้งที่เข้าเครื่อง' +
        (isMacTarget ? ' ครั้งแรก macOS จะถามสิทธิ์ควบคุม Photoshop ให้กดอนุญาต' : '') + '</li>',
      '<li>กลับมาที่หน้านี้แล้วกด “ตรวจอีกครั้ง”</li>'
    ].join('');
  }

  function trapFocus(event) {
    if (event.key !== 'Tab' || !helpNodes) return;
    var focusable = helpNodes.dialog.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
    var items = Array.prototype.filter.call(focusable, function (node) { return node.offsetParent !== null; });
    if (!items.length) { event.preventDefault(); return; }
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function buildHelp() {
    if (helpNodes) return helpNodes;
    injectHelpStyles();
    var backdrop = document.createElement('div');
    backdrop.className = 'dicut-ps-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML =
      '<div class="dicut-ps-dialog" role="dialog" aria-modal="true" aria-labelledby="dicut-ps-title" tabindex="-1">' +
        '<h2 id="dicut-ps-title">Dicut PS ยังใช้ไม่ได้</h2>' +
        '<p class="dicut-ps-status" role="status"></p>' +
        '<p>ปุ่มนี้เรียก Photoshop บนเครื่องของคุณผ่านตัวช่วยเล็ก ๆ ชื่อ <b>Dicut PS Bridge</b> ' +
        'ต้องติดตั้งครั้งเดียวต่อเครื่อง (ใช้ได้ทั้ง Windows และ Mac) และต้องมี Photoshop 2022 ขึ้นไป</p>' +
        '<div class="dicut-ps-tabs" role="tablist">' +
          '<button class="dicut-ps-tab" type="button" role="tab" data-target="windows">Windows</button>' +
          '<button class="dicut-ps-tab" type="button" role="tab" data-target="mac">Mac</button>' +
        '</div>' +
        '<ol class="dicut-ps-steps"></ol>' +
        '<div class="dicut-ps-actions">' +
          '<button type="button" class="dicut-ps-recheck">ตรวจอีกครั้ง</button>' +
          '<button type="button" class="dicut-ps-primary dicut-ps-close">ปิด</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    helpNodes = {
      backdrop: backdrop,
      dialog: backdrop.querySelector('.dicut-ps-dialog'),
      title: backdrop.querySelector('#dicut-ps-title'),
      status: backdrop.querySelector('.dicut-ps-status'),
      steps: backdrop.querySelector('.dicut-ps-steps'),
      tabs: Array.prototype.slice.call(backdrop.querySelectorAll('.dicut-ps-tab')),
      recheck: backdrop.querySelector('.dicut-ps-recheck'),
      close: backdrop.querySelector('.dicut-ps-close')
    };

    helpNodes.tabs.forEach(function (tab) {
      tab.addEventListener('click', function () { selectPlatform(tab.dataset.target); });
    });
    helpNodes.close.addEventListener('click', closeHelp);
    helpNodes.recheck.addEventListener('click', function () {
      helpNodes.recheck.disabled = true;
      helpNodes.status.textContent = 'กำลังตรวจ…';
      probe({ force: true }).then(function (state) {
        helpNodes.recheck.disabled = false;
        if (state.available && state.photoshopFound && !state.stale) {
          helpNodes.status.textContent = 'เชื่อมต่อได้แล้ว (' + (state.photoshop || 'Photoshop') + ') — ปิดหน้าต่างนี้แล้วกด Dicut PS ได้เลย';
        } else {
          helpNodes.status.textContent = state.error || 'ยังเชื่อมต่อไม่ได้';
        }
      });
    });
    backdrop.addEventListener('click', function (event) { if (event.target === backdrop) closeHelp(); });
    backdrop.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); closeHelp(); }
      else trapFocus(event);
    });
    return helpNodes;
  }

  function selectPlatform(target) {
    helpNodes.tabs.forEach(function (tab) {
      tab.setAttribute('aria-selected', String(tab.dataset.target === target));
    });
    helpNodes.steps.innerHTML = platformInstructions(target);

    var download = helpNodes.steps.querySelector('.dicut-ps-download');
    download.addEventListener('click', function () {
      try {
        var name = downloadInstaller(target);
        helpNodes.status.textContent = 'ดาวน์โหลด ' + name + ' แล้ว — ทำขั้นตอนที่ 2 ต่อ';
      } catch (error) {
        helpNodes.status.textContent = error.message;
      }
    });

    var copy = helpNodes.steps.querySelector('.dicut-ps-copy');
    copy.addEventListener('click', function () {
      var label = copy.textContent;
      copyText(target === 'mac' ? RUN_COMMAND.mac : RUN_COMMAND.windows).then(function () {
        copy.textContent = 'คัดลอกแล้ว ✓';
        setTimeout(function () { copy.textContent = label; }, 2000);
      }).catch(function () {
        helpNodes.status.textContent = 'คัดลอกไม่สำเร็จ — เลือกข้อความในกรอบแล้วคัดลอกเอง';
      });
    });
  }

  function showHelp(message, trigger, isUpdate) {
    buildHelp();
    helpReturnFocus = trigger || document.activeElement;
    helpNodes.title.textContent = isUpdate ? 'ต้องอัปเดต Dicut PS Bridge' : 'Dicut PS ยังใช้ไม่ได้';
    helpNodes.status.textContent = message || 'ยังไม่ได้เปิด Dicut PS Bridge บนเครื่องนี้';
    selectPlatform(isMac() ? 'mac' : 'windows');
    helpNodes.backdrop.hidden = false;
    helpNodes.dialog.focus();
  }

  function closeHelp() {
    if (!helpNodes || helpNodes.backdrop.hidden) return;
    helpNodes.backdrop.hidden = true;
    if (helpReturnFocus && document.contains(helpReturnFocus)) helpReturnFocus.focus();
    helpReturnFocus = null;
  }

  // Probe first; on failure open the install dialog and report "not ready" so
  // callers never have to duplicate the error path.
  function ensureReady(trigger, options) {
    return probe(options).then(function (state) {
      if (state.available && state.photoshopFound && !state.stale) return true;
      showHelp(state.error, trigger, state.stale);
      return false;
    });
  }

  window.DicutPS = {
    VERSION: VERSION,
    ENDPOINT: ENDPOINT,
    probe: probe,
    cut: cut,
    cutMany: cutMany,
    ensureReady: ensureReady,
    showHelp: showHelp,
    closeHelp: closeHelp,
    downloadInstaller: downloadInstaller,
    toDataUrl: toDataUrl,
    dataUrlToBlob: dataUrlToBlob
  };

  // Load the stylesheet up front so the dialog is never painted unstyled.
  if (document.head) injectHelpStyles();
  else document.addEventListener('DOMContentLoaded', injectHelpStyles, { once: true });
})();
