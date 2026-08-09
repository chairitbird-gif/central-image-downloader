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

  var VERSION = '1.1.5';
  // The bridge lives on the user's machine and is not updated by a site deploy,
  // so the client has to notice an old one and send them back to the installer.
  var REQUIRED_BRIDGE = '1.1.4';
  var ENDPOINT = 'http://127.0.0.1:8799';
  // document.currentScript is only readable while the script is executing, and
  // the stylesheet sits next to this file whatever path a tool serves it from.
  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || '';
  var PROBE_TIMEOUT_MS = 2500;
  var CUT_TIMEOUT_MS = 240000;   // Photoshop's first launch can take minutes
  var PROBE_TTL_OK_MS = 15000;
  var PROBE_TTL_FAIL_MS = 3000;

  /* BRIDGE_SOURCE_B64_START */
  var BRIDGE_SOURCE_B64 = 'IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMw0KIyAtKi0gY29kaW5nOiB1dGYtOCAtKi0NCiIiIkRpY3V0IFBTIEJyaWRnZSAtIGxvY2FsIEhUVFAgc2VydmljZSB0aGF0IHJ1bnMgUGhvdG9zaG9wICJSZW1vdmUgQmFja2dyb3VuZCIuDQoNClRoZSBDZW50cmFsIENyZWF0aXZlIFRvb2xzIHdlYiBhcHBzIGNhbm5vdCB0YWxrIHRvIGEgbG9jYWxseSBpbnN0YWxsZWQNClBob3Rvc2hvcCwgc28gdGhleSBQT1NUIGFuIGltYWdlIGhlcmUgYW5kIGdldCBhIHRyYW5zcGFyZW50IFBORyBiYWNrLg0KVGhlIHNhbWUgc2VydmljZSBydW5zIG9uIFdpbmRvd3MgKENPTSkgYW5kIG1hY09TIChBcHBsZSBldmVudHMpLCB3aGljaCBpcyB3aGF0DQpsZXRzIG9uZSBidXR0b24gd29yayBvbiBib3RoIHBsYXRmb3Jtcy4NCg0KUnVuOiAgICAgICAgcHl0aG9uIGRpY3V0X2JyaWRnZS5weQ0KT3B0aW9uczogICAgLS1wb3J0IDg3OTkgIC0taG9zdCAxMjcuMC4wLjEgIC0tdGltZW91dCAxODAgIC0ta2VlcC13b3JrDQpIZWFsdGg6ICAgICBjdXJsIGh0dHA6Ly8xMjcuMC4wLjE6ODc5OS9oZWFsdGgNClNlbGYgdGVzdDogIHB5dGhvbiBkaWN1dF9icmlkZ2UucHkgLS1zZWxmdGVzdCBwYXRoL3RvL2ltYWdlLmpwZw0KDQpPbmx5IHRoZSBsb29wYmFjayBpbnRlcmZhY2UgaXMgYm91bmQgYW5kIG9ubHkgYWxsb3ctbGlzdGVkIGJyb3dzZXIgb3JpZ2lucyBhcmUNCmFjY2VwdGVkLCBzbyBhIHJhbmRvbSB3ZWIgcGFnZSBjYW5ub3QgZHJpdmUgdGhlIGxvY2FsIFBob3Rvc2hvcC4NCiIiIg0KDQppbXBvcnQgYXJncGFyc2UNCmltcG9ydCBiYXNlNjQNCmltcG9ydCBqc29uDQppbXBvcnQgb3MNCmltcG9ydCBwbGF0Zm9ybQ0KaW1wb3J0IHJlDQppbXBvcnQgc2h1dGlsDQppbXBvcnQgc3VicHJvY2Vzcw0KaW1wb3J0IHN5cw0KaW1wb3J0IHRlbXBmaWxlDQppbXBvcnQgdGhyZWFkaW5nDQppbXBvcnQgdGltZQ0KaW1wb3J0IHV1aWQNCmZyb20gaHR0cC5zZXJ2ZXIgaW1wb3J0IEJhc2VIVFRQUmVxdWVzdEhhbmRsZXIsIFRocmVhZGluZ0hUVFBTZXJ2ZXINCmZyb20gcGF0aGxpYiBpbXBvcnQgUGF0aA0KDQpWRVJTSU9OID0gIjEuMS40IgpERUZBVUxUX1BPUlQgPSA4Nzk5DQpERUZBVUxUX0hPU1QgPSAiMTI3LjAuMC4xIg0KREVGQVVMVF9USU1FT1VUID0gMTgwDQpNQVhfQk9EWV9CWVRFUyA9IDQ4ICogMTAyNCAqIDEwMjQNCg0KSVNfV0lORE9XUyA9IHN5cy5wbGF0Zm9ybS5zdGFydHN3aXRoKCJ3aW4iKQ0KSVNfTUFDID0gc3lzLnBsYXRmb3JtID09ICJkYXJ3aW4iDQoNCiMgUHJvZHVjdGlvbiBvcmlnaW5zIG9mIHRoZSBhY3RpdmUgdG9vbHMgdGhhdCBvd24gYSBEaWN1dCBQUyBidXR0b24uIFByZXZpZXcKIyBkZXBsb3ltZW50cyBsaXZlIG9uIHN1YmRvbWFpbnMgb2YgdGhlIHNhbWUgUGFnZXMgcHJvamVjdHMsIHNvIHRob3NlIGFyZQ0KIyBtYXRjaGVkIGJ5IHN1ZmZpeC4gRXh0cmEgb3JpZ2lucyBjYW4gYmUgYWRkZWQgd2l0aCBESUNVVF9CUklER0VfT1JJR0lOUy4NCkFMTE9XRURfT1JJR0lOUyA9IHsNCiAgICAiaHR0cHM6Ly9jZW50cmFsLWltYWdlLWRvd25sb2FkZXIucGFnZXMuZGV2IiwNCiAgICAiaHR0cHM6Ly9jZW50cmFsLXN0cmlwLWJhbm5lci5wYWdlcy5kZXYiLA0KICAgICJodHRwczovL2NlbnRyYWwtb3ZlcmxheS1nZW5lcmF0b3IucGFnZXMuZGV2IiwNCiAgICAiaHR0cHM6Ly9jZW50cmFsLWZpcnN0LWltYWdlLmNoYWlyaXQtYmlyZC53b3JrZXJzLmRldiIsCiAgICAiaHR0cHM6Ly9jZW50cmFsLWd3cC1lZGl0b3IucGFnZXMuZGV2IiwKfQ0KQUxMT1dFRF9PUklHSU5fU1VGRklYRVMgPSAoDQogICAgIi5jZW50cmFsLWltYWdlLWRvd25sb2FkZXIucGFnZXMuZGV2IiwNCiAgICAiLmNlbnRyYWwtc3RyaXAtYmFubmVyLnBhZ2VzLmRldiIsDQogICAgIi5jZW50cmFsLW92ZXJsYXktZ2VuZXJhdG9yLnBhZ2VzLmRldiIsCiAgICAiLmNlbnRyYWwtZ3dwLWVkaXRvci5wYWdlcy5kZXYiLAopDQpMT0NBTF9PUklHSU5fUkUgPSByZS5jb21waWxlKHIiXmh0dHBzPzovLyhsb2NhbGhvc3R8MTI3XC4wXC4wXC4xfFxbOjoxXF0pKDpcZCspPyQiKQ0KDQpFWFRFTlNJT05fQllfTUlNRSA9IHsNCiAgICAiaW1hZ2UvcG5nIjogIi5wbmciLA0KICAgICJpbWFnZS9qcGVnIjogIi5qcGciLA0KICAgICJpbWFnZS9qcGciOiAiLmpwZyIsDQogICAgImltYWdlL3dlYnAiOiAiLndlYnAiLA0KICAgICJpbWFnZS90aWZmIjogIi50aWYiLA0KICAgICJpbWFnZS9ibXAiOiAiLmJtcCIsDQp9DQoNCkRBVEFfVVJMX1JFID0gcmUuY29tcGlsZShyIl5kYXRhOig/UDxtaW1lPltcdy4rLV0rL1tcdy4rLV0rKT87YmFzZTY0LCg/UDxwYXlsb2FkPi4rKSQiLCByZS5TKQ0KDQojIFBob3Rvc2hvcCBpcyBzaW5nbGUtaW5zdGFuY2U6IHR3byBvdmVybGFwcGluZyBEb0phdmFTY3JpcHQgY2FsbHMgZmlnaHQgb3Zlcg0KIyB0aGUgc2FtZSBhcHBsaWNhdGlvbiwgc28gZXZlcnkgY3V0IGlzIHNlcmlhbGlzZWQuDQpQSE9UT1NIT1BfTE9DSyA9IHRocmVhZGluZy5Mb2NrKCkNCg0KIyBUcmltbWluZyBpcyBvcHRpb25hbDogYSBjYWxsZXIgdGhhdCB3YW50cyBhIGJlZm9yZS9hZnRlciBjb21wYXJpc29uIG5lZWRzIHRoZQ0KIyByZXN1bHQgb24gdGhlIG9yaWdpbmFsIGNhbnZhcywgYmVjYXVzZSBhIHRyaW1tZWQgY3V0b3V0IG5vIGxvbmdlciBsaW5lcyB1cA0KIyB3aXRoIHRoZSBpbWFnZSBpdCBjYW1lIGZyb20uDQpKU1hfVEVNUExBVEUgPSAiIiJhcHAuZGlzcGxheURpYWxvZ3MgPSBEaWFsb2dNb2Rlcy5OTzsNCnZhciBfc3JjID0gbmV3IEZpbGUoIiUoc3JjKXMiKTsNCnZhciBfb3V0ID0gbmV3IEZpbGUoIiUob3V0KXMiKTsNCnZhciBkb2MgPSBhcHAub3Blbihfc3JjKTsNCnRyeSB7DQogICAgaWYgKGRvYy5sYXllcnNbMF0uaXNCYWNrZ3JvdW5kTGF5ZXIpIGRvYy5sYXllcnNbMF0uaXNCYWNrZ3JvdW5kTGF5ZXIgPSBmYWxzZTsNCiAgICBleGVjdXRlQWN0aW9uKHN0cmluZ0lEVG9UeXBlSUQoJ3JlbW92ZUJhY2tncm91bmQnKSwgdW5kZWZpbmVkLCBEaWFsb2dNb2Rlcy5OTyk7DQolKHRyaW0pcyAgICBkb2Muc2F2ZUFzKF9vdXQsIG5ldyBQTkdTYXZlT3B0aW9ucygpLCB0cnVlLCBFeHRlbnNpb24uTE9XRVJDQVNFKTsNCn0gZmluYWxseSB7DQogICAgZG9jLmNsb3NlKFNhdmVPcHRpb25zLkRPTk9UU0FWRUNIQU5HRVMpOw0KfQ0KIiIiDQpUUklNX0xJTkUgPSAiICAgIGRvYy50cmltKFRyaW1UeXBlLlRSQU5TUEFSRU5UKTtcbiINCg0KDQpMT0dfUEFUSCA9IFBhdGguaG9tZSgpIC8gIi5kaWN1dC1icmlkZ2UiIC8gImJyaWRnZS5sb2ciDQoNCg0KZGVmIGVtaXQobWVzc2FnZSk6DQogICAgIiIiUmVwb3J0IGEgbGluZSB3aXRob3V0IGFzc3VtaW5nIHRoZXJlIGlzIGEgY29uc29sZS4NCg0KICAgIHB5dGhvbncuZXhlIC0gd2hpY2ggdGhlIFdpbmRvd3MgaW5zdGFsbGVyIHVzZXMgc28gdGhlIGJyaWRnZSBoYXMgbm8gdmlzaWJsZQ0KICAgIHdpbmRvdyAtIGxlYXZlcyBzeXMuc3Rkb3V0IGFzIE5vbmUsIHNvIHdyaXRpbmcgdG8gaXQgcmFpc2VkIEF0dHJpYnV0ZUVycm9yDQogICAgYW5kIGtpbGxlZCB0aGUgc2VydmljZSBiZWZvcmUgaXQgZXZlciBib3VuZCB0aGUgcG9ydC4gQW55dGhpbmcgdGhhdCBjYW5ub3QNCiAgICByZWFjaCBhIHN0cmVhbSBnb2VzIHRvIGEgbG9nIGZpbGUgaW5zdGVhZCwgd2hpY2ggaXMgYWxzbyB3aGF0IG1ha2VzIGENCiAgICBoZWFkbGVzcyBmYWlsdXJlIGRpYWdub3NhYmxlIGF0IGFsbC4NCiAgICAiIiINCiAgICBsaW5lID0gIiVzICVzIiAlICh0aW1lLnN0cmZ0aW1lKCIlSDolTTolUyIpLCBtZXNzYWdlKQ0KICAgIHN0cmVhbSA9IHN5cy5zdGRvdXQNCiAgICBpZiBzdHJlYW0gaXMgbm90IE5vbmU6DQogICAgICAgIHRyeToNCiAgICAgICAgICAgIHN0cmVhbS53cml0ZShsaW5lICsgIlxuIikNCiAgICAgICAgICAgIHN0cmVhbS5mbHVzaCgpDQogICAgICAgICAgICByZXR1cm4NCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbjogICMgbm9xYTogQkxFMDAxIC0gYSBicm9rZW4gY29uc29sZSBtdXN0IG5vdCBzdG9wIHRoZSBzZXJ2aWNlDQogICAgICAgICAgICBwYXNzDQogICAgdHJ5Og0KICAgICAgICBMT0dfUEFUSC5wYXJlbnQubWtkaXIocGFyZW50cz1UcnVlLCBleGlzdF9vaz1UcnVlKQ0KICAgICAgICB3aXRoIExPR19QQVRILm9wZW4oImEiLCBlbmNvZGluZz0idXRmLTgiKSBhcyBoYW5kbGU6DQogICAgICAgICAgICBoYW5kbGUud3JpdGUobGluZSArICJcbiIpDQogICAgZXhjZXB0IE9TRXJyb3I6DQogICAgICAgIHBhc3MNCg0KDQpjbGFzcyBEaWN1dEVycm9yKFJ1bnRpbWVFcnJvcik6DQogICAgIiIiQSBmYWlsdXJlIHRoZSBicm93c2VyIGlzIGV4cGVjdGVkIHRvIHNob3cgdG8gdGhlIHVzZXIgYXMtaXMuIiIiDQoNCg0KZGVmIGpzeF9wYXRoKHZhbHVlKToNCiAgICAiIiJFc2NhcGUgYSBmaWxlc3lzdGVtIHBhdGggZm9yIGVtYmVkZGluZyBpbiBhIEpTWCBzdHJpbmcgbGl0ZXJhbC4iIiINCiAgICByZXR1cm4gc3RyKHZhbHVlKS5yZXBsYWNlKCJcXCIsICJcXFxcIikucmVwbGFjZSgnIicsICdcXCInKQ0KDQoNCmRlZiBvcmlnaW5fYWxsb3dlZChvcmlnaW4pOg0KICAgIGlmIG5vdCBvcmlnaW46DQogICAgICAgIHJldHVybiBUcnVlICAjIGN1cmwgLyBzZWxmIHRlc3Q6IG5vIGJyb3dzZXIgb3JpZ2luIHRvIGNoZWNrDQogICAgaWYgb3JpZ2luIGluIEFMTE9XRURfT1JJR0lOUyBvciBMT0NBTF9PUklHSU5fUkUubWF0Y2gob3JpZ2luKToNCiAgICAgICAgcmV0dXJuIFRydWUNCiAgICByZXR1cm4gYW55KG9yaWdpbi5lbmRzd2l0aChzdWZmaXgpIGZvciBzdWZmaXggaW4gQUxMT1dFRF9PUklHSU5fU1VGRklYRVMpDQoNCg0KZGVmIGxvYWRfZXh0cmFfb3JpZ2lucygpOg0KICAgIHJhdyA9IG9zLmVudmlyb24uZ2V0KCJESUNVVF9CUklER0VfT1JJR0lOUyIsICIiKQ0KICAgIGZvciBpdGVtIGluIHJhdy5yZXBsYWNlKCIsIiwgIiAiKS5zcGxpdCgpOg0KICAgICAgICBBTExPV0VEX09SSUdJTlMuYWRkKGl0ZW0ucnN0cmlwKCIvIikpDQoNCg0KIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KIyBQaG90b3Nob3AgZGlzY292ZXJ5DQojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQoNCmRlZiBmaW5kX3Bob3Rvc2hvcF9tYWMoKToNCiAgICBjYW5kaWRhdGVzID0gW10NCiAgICBhcHBzID0gUGF0aCgiL0FwcGxpY2F0aW9ucyIpDQogICAgaWYgYXBwcy5pc19kaXIoKToNCiAgICAgICAgZm9yIGVudHJ5IGluIHNvcnRlZChhcHBzLmdsb2IoIkFkb2JlIFBob3Rvc2hvcCoiKSk6DQogICAgICAgICAgICBpZiBlbnRyeS5zdWZmaXggPT0gIi5hcHAiOg0KICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMuYXBwZW5kKGVudHJ5KQ0KICAgICAgICAgICAgZWxpZiBlbnRyeS5pc19kaXIoKToNCiAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLmV4dGVuZChzb3J0ZWQoZW50cnkuZ2xvYigiQWRvYmUgUGhvdG9zaG9wKi5hcHAiKSkpDQogICAgcmV0dXJuIGNhbmRpZGF0ZXNbLTFdIGlmIGNhbmRpZGF0ZXMgZWxzZSBOb25lDQoNCg0KZGVmIGZpbmRfcGhvdG9zaG9wX3dpbmRvd3MoKToNCiAgICAiIiJSZXR1cm4gdGhlIHJlZ2lzdGVyZWQgUGhvdG9zaG9wIGFwcGxpY2F0aW9uIG5hbWUsIG9yIE5vbmUuIiIiDQogICAgdHJ5Og0KICAgICAgICBpbXBvcnQgd2lucmVnDQogICAgZXhjZXB0IEltcG9ydEVycm9yOiAgIyBwcmFnbWE6IG5vIGNvdmVyIC0gV2luZG93cyBvbmx5DQogICAgICAgIHJldHVybiBOb25lDQogICAgZm9yIHJvb3QgaW4gKHdpbnJlZy5IS0VZX0NMQVNTRVNfUk9PVCwpOg0KICAgICAgICB0cnk6DQogICAgICAgICAgICB3aXRoIHdpbnJlZy5PcGVuS2V5KHJvb3QsIHIiUGhvdG9zaG9wLkFwcGxpY2F0aW9uXEN1clZlciIpIGFzIGtleToNCiAgICAgICAgICAgICAgICB2ZXJzaW9uID0gd2lucmVnLlF1ZXJ5VmFsdWVFeChrZXksICIiKVswXQ0KICAgICAgICAgICAgICAgIHJldHVybiBzdHIodmVyc2lvbikNCiAgICAgICAgZXhjZXB0IE9TRXJyb3I6DQogICAgICAgICAgICBjb250aW51ZQ0KICAgIHRyeToNCiAgICAgICAgd2l0aCB3aW5yZWcuT3BlbktleSh3aW5yZWcuSEtFWV9DTEFTU0VTX1JPT1QsICJQaG90b3Nob3AuQXBwbGljYXRpb24iKToNCiAgICAgICAgICAgIHJldHVybiAiUGhvdG9zaG9wLkFwcGxpY2F0aW9uIg0KICAgIGV4Y2VwdCBPU0Vycm9yOg0KICAgICAgICByZXR1cm4gTm9uZQ0KDQoNCmRlZiBwaG90b3Nob3Bfc3RhdHVzKCk6DQogICAgaWYgSVNfTUFDOg0KICAgICAgICBhcHAgPSBmaW5kX3Bob3Rvc2hvcF9tYWMoKQ0KICAgICAgICByZXR1cm4geyJmb3VuZCI6IGJvb2woYXBwKSwgIm5hbWUiOiBhcHAuc3RlbSBpZiBhcHAgZWxzZSAiIiwgInBhdGgiOiBzdHIoYXBwKSBpZiBhcHAgZWxzZSAiIn0NCiAgICBpZiBJU19XSU5ET1dTOg0KICAgICAgICBuYW1lID0gZmluZF9waG90b3Nob3Bfd2luZG93cygpDQogICAgICAgIHJldHVybiB7ImZvdW5kIjogYm9vbChuYW1lKSwgIm5hbWUiOiBuYW1lIG9yICIiLCAicGF0aCI6ICIifQ0KICAgIHJldHVybiB7ImZvdW5kIjogRmFsc2UsICJuYW1lIjogIiIsICJwYXRoIjogIiJ9DQoNCg0KIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KIyBQaG90b3Nob3AgZXhlY3V0aW9uDQojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQoNCmRlZiB3YWl0X2Zvcl9vdXRwdXQob3V0X2ZpbGUsIGFwcGVhcl90aW1lb3V0LCBzZXR0bGVfdGltZW91dD0xODAsIHBvbGw9MC4zKToNCiAgICAiIiJXYWl0IHVudGlsIHRoZSBQTkcgZXhpc3RzIGFuZCBoYXMgc3RvcHBlZCBncm93aW5nLg0KDQogICAgUGhvdG9zaG9wIGNyZWF0ZXMgdGhlIG91dHB1dCBmaWxlIGJlZm9yZSBpdCBoYXMgZmluaXNoZWQgd3JpdGluZyBpdCwgc28NCiAgICB0ZXN0aW5nIGBleGlzdHMoKWAgYWxvbmUgaGFuZHMgYmFjayBhIHplcm8tYnl0ZSBvciBoYWxmLXdyaXR0ZW4gUE5HLiBUaGF0IGlzDQogICAgd2hhdCBtYWRlIGEgbWFjT1MgYmF0Y2ggcmV0dXJuICJQaG90b3Nob3Ag4LiE4Li34LiZ4LmE4Lif4Lil4LmM4Lin4LmI4Liy4LiHIiBmb3IgZXZlcnkgaW1hZ2UgZXhjZXB0DQogICAgdGhlIG9uZSB0aGF0IGhhcHBlbmVkIHRvIHdpbiB0aGUgcmFjZS4NCiAgICAiIiINCiAgICBhcHBlYXJfZGVhZGxpbmUgPSB0aW1lLnRpbWUoKSArIGFwcGVhcl90aW1lb3V0DQogICAgd2hpbGUgdGltZS50aW1lKCkgPCBhcHBlYXJfZGVhZGxpbmUgYW5kIG5vdCBvdXRfZmlsZS5leGlzdHMoKToNCiAgICAgICAgdGltZS5zbGVlcChwb2xsKQ0KICAgIGlmIG5vdCBvdXRfZmlsZS5leGlzdHMoKToNCiAgICAgICAgcmV0dXJuIEZhbHNlDQoNCiAgICBzZXR0bGVfZGVhZGxpbmUgPSB0aW1lLnRpbWUoKSArIHNldHRsZV90aW1lb3V0DQogICAgbGFzdCwgc3RhYmxlID0gLTEsIDANCiAgICB3aGlsZSB0aW1lLnRpbWUoKSA8IHNldHRsZV9kZWFkbGluZToNCiAgICAgICAgdHJ5Og0KICAgICAgICAgICAgc2l6ZSA9IG91dF9maWxlLnN0YXQoKS5zdF9zaXplDQogICAgICAgIGV4Y2VwdCBPU0Vycm9yOg0KICAgICAgICAgICAgc2l6ZSA9IC0xDQogICAgICAgIGlmIHNpemUgPiAwIGFuZCBzaXplID09IGxhc3Q6DQogICAgICAgICAgICBzdGFibGUgKz0gMQ0KICAgICAgICAgICAgaWYgc3RhYmxlID49IDI6DQogICAgICAgICAgICAgICAgcmV0dXJuIFRydWUNCiAgICAgICAgZWxzZToNCiAgICAgICAgICAgIHN0YWJsZSA9IDANCiAgICAgICAgbGFzdCA9IHNpemUNCiAgICAgICAgdGltZS5zbGVlcChwb2xsKQ0KICAgIHJldHVybiBGYWxzZQ0KDQoNCmRlZiBydW5fcGhvdG9zaG9wX3dpbmRvd3Moc2NyaXB0LCBvdXRfZmlsZSwgdGltZW91dCk6CiAgICAiIiJEcml2ZSBQaG90b3Nob3AgdGhyb3VnaCBDT006IHB5d2luMzIgd2hlbiBwcmVzZW50LCBQb3dlclNoZWxsIG90aGVyd2lzZS4iIiIKICAgIGVycm9ycyA9IFtdCiAgICB0cnk6CiAgICAgICAgaW1wb3J0IHB5dGhvbmNvbSAgIyB0eXBlOiBpZ25vcmUKICAgICAgICBpbXBvcnQgd2luMzJjb20uY2xpZW50ICAjIHR5cGU6IGlnbm9yZQoKICAgICAgICAjIFRocmVhZGluZ0hUVFBTZXJ2ZXIgZ2l2ZXMgZXZlcnkgcmVxdWVzdCBhIGZyZXNoIHdvcmtlciB0aHJlYWQuIENPTSBoYXMKICAgICAgICAjIHRvIGJlIGluaXRpYWxpc2VkIGluIHRoYXQgZXhhY3QgdGhyZWFkIGJlZm9yZSBweXdpbjMyIGNhbiB0YWxrIHRvIHRoZQogICAgICAgICMgYWxyZWFkeS1ydW5uaW5nIFBob3Rvc2hvcCBpbnN0YW5jZS4KICAgICAgICBweXRob25jb20uQ29Jbml0aWFsaXplKCkKICAgICAgICB0cnk6CiAgICAgICAgICAgIGFwcCA9IHdpbjMyY29tLmNsaWVudC5EaXNwYXRjaCgiUGhvdG9zaG9wLkFwcGxpY2F0aW9uIikKICAgICAgICAgICAgIyBEb0phdmFTY3JpcHQgd2l0aCB0aGUgc291cmNlIHRleHQgaXMgdGhlIGNhbGwgcGF0aCBhbHJlYWR5IHByb3ZlbiBieQogICAgICAgICAgICAjIHRvb2xzL2RpY3V0LnB5OyB0aGUgcGF0aHMgYXJlIGJha2VkIGludG8gdGhlIHNjcmlwdCBzbyBubyBhcmd1bWVudHMKICAgICAgICAgICAgIyBoYXZlIHRvIHN1cnZpdmUgdGhlIENPTSBib3VuZGFyeS4KICAgICAgICAgICAgYXBwLkRvSmF2YVNjcmlwdChzY3JpcHQucmVhZF90ZXh0KGVuY29kaW5nPSJ1dGYtOCIpKQogICAgICAgICAgICBpZiB3YWl0X2Zvcl9vdXRwdXQob3V0X2ZpbGUsIDUpOgogICAgICAgICAgICAgICAgcmV0dXJuICJjb20iCiAgICAgICAgICAgIGVycm9ycy5hcHBlbmQoInB5d2luMzIgcmFuIHRoZSBzY3JpcHQgYnV0IHByb2R1Y2VkIG5vIHVzYWJsZSBvdXRwdXQgZmlsZSIpCiAgICAgICAgZmluYWxseToKICAgICAgICAgICAgYXBwID0gTm9uZQogICAgICAgICAgICBweXRob25jb20uQ29VbmluaXRpYWxpemUoKQogICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlcnJvcjogICMgbm9xYTogQkxFMDAxIC0gcmVwb3J0ZWQgdG8gdGhlIHVzZXIgdmVyYmF0aW0NCiAgICAgICAgZXJyb3JzLmFwcGVuZCgicHl3aW4zMjogJXMiICUgZXJyb3IpDQoNCiAgICBwb3dlcnNoZWxsID0gc2h1dGlsLndoaWNoKCJwb3dlcnNoZWxsIikgb3Igc2h1dGlsLndoaWNoKCJwd3NoIikNCiAgICBpZiBwb3dlcnNoZWxsOg0KICAgICAgICBjb21tYW5kID0gKA0KICAgICAgICAgICAgIiRFcnJvckFjdGlvblByZWZlcmVuY2U9J1N0b3AnOyINCiAgICAgICAgICAgICIkYXBwID0gTmV3LU9iamVjdCAtQ29tT2JqZWN0IFBob3Rvc2hvcC5BcHBsaWNhdGlvbjsiDQogICAgICAgICAgICAiJGFwcC5Eb0phdmFTY3JpcHRGaWxlKCclcycpIiAlIHN0cihzY3JpcHQpLnJlcGxhY2UoIiciLCAiJyciKQ0KICAgICAgICApDQogICAgICAgIHRyeToNCiAgICAgICAgICAgIGRvbmUgPSBzdWJwcm9jZXNzLnJ1bigNCiAgICAgICAgICAgICAgICBbcG93ZXJzaGVsbCwgIi1Ob1Byb2ZpbGUiLCAiLU5vbkludGVyYWN0aXZlIiwgIi1Db21tYW5kIiwgY29tbWFuZF0sDQogICAgICAgICAgICAgICAgY2FwdHVyZV9vdXRwdXQ9VHJ1ZSwgdGV4dD1UcnVlLCB0aW1lb3V0PXRpbWVvdXQsDQogICAgICAgICAgICApDQogICAgICAgICAgICBpZiB3YWl0X2Zvcl9vdXRwdXQob3V0X2ZpbGUsIDUpOg0KICAgICAgICAgICAgICAgIHJldHVybiAicG93ZXJzaGVsbCINCiAgICAgICAgICAgIGVycm9ycy5hcHBlbmQoInBvd2Vyc2hlbGw6ICVzIiAlIChkb25lLnN0ZGVyciBvciBkb25lLnN0ZG91dCBvciAibm8gb3V0cHV0IGZpbGUiKS5zdHJpcCgpKQ0KICAgICAgICBleGNlcHQgc3VicHJvY2Vzcy5UaW1lb3V0RXhwaXJlZDoNCiAgICAgICAgICAgIGVycm9ycy5hcHBlbmQoInBvd2Vyc2hlbGw6IHRpbWVvdXQgYWZ0ZXIgJXNzIiAlIHRpbWVvdXQpDQogICAgICAgIGV4Y2VwdCBPU0Vycm9yIGFzIGVycm9yOg0KICAgICAgICAgICAgZXJyb3JzLmFwcGVuZCgicG93ZXJzaGVsbDogJXMiICUgZXJyb3IpDQogICAgZWxzZToNCiAgICAgICAgZXJyb3JzLmFwcGVuZCgicG93ZXJzaGVsbCBub3QgZm91bmQgb24gUEFUSCIpDQoNCiAgICByYWlzZSBEaWN1dEVycm9yKCJQaG90b3Nob3Ag4LmE4Lih4LmI4LiV4Lit4Lia4Liq4LiZ4Lit4LiHIOKAlCAiICsgIiB8ICIuam9pbihlcnJvcnMpKQ0KDQoNCmRlZiBydW5fcGhvdG9zaG9wX21hYyhzY3JpcHQsIG91dF9maWxlLCB0aW1lb3V0LCBhcHBfcGF0aCk6DQogICAgaWYgbm90IGFwcF9wYXRoOg0KICAgICAgICByYWlzZSBEaWN1dEVycm9yKCLguYTguKHguYjguJ7guJogQWRvYmUgUGhvdG9zaG9wIOC5g+C4mSAvQXBwbGljYXRpb25zIikNCiAgICBuYW1lID0gYXBwX3BhdGguc3RlbQ0KICAgIGVycm9ycyA9IFtdDQogICAgdHJ5Og0KICAgICAgICBkb25lID0gc3VicHJvY2Vzcy5ydW4oDQogICAgICAgICAgICBbDQogICAgICAgICAgICAgICAgIm9zYXNjcmlwdCIsDQogICAgICAgICAgICAgICAgIi1lIiwgJ3RlbGwgYXBwbGljYXRpb24gIiVzIiB0byBhY3RpdmF0ZScgJSBuYW1lLA0KICAgICAgICAgICAgICAgICItZSIsICd0ZWxsIGFwcGxpY2F0aW9uICIlcyIgdG8gZG8gamF2YXNjcmlwdCAoUE9TSVggZmlsZSAiJXMiKScgJSAobmFtZSwgc2NyaXB0KSwNCiAgICAgICAgICAgIF0sDQogICAgICAgICAgICBjYXB0dXJlX291dHB1dD1UcnVlLCB0ZXh0PVRydWUsIHRpbWVvdXQ9dGltZW91dCwNCiAgICAgICAgKQ0KICAgICAgICAjIEEgc2hvcnQgYXBwZWFyIHdpbmRvdzogaWYgb3Nhc2NyaXB0IHJlYWxseSBkaWQgcnVuIHRoZSBzY3JpcHQgdGhlIGZpbGUNCiAgICAgICAgIyBpcyBhbHJlYWR5IHRoZXJlLCBhbmQgd2FpdGluZyBsb25nZXIgb25seSBkZWxheXMgdGhlIG9wZW4gLWEgZmFsbGJhY2suDQogICAgICAgIGlmIHdhaXRfZm9yX291dHB1dChvdXRfZmlsZSwgMyk6DQogICAgICAgICAgICByZXR1cm4gImFwcGxlLWV2ZW50cyINCiAgICAgICAgZXJyb3JzLmFwcGVuZCgib3Nhc2NyaXB0OiAlcyIgJSAoZG9uZS5zdGRlcnIgb3IgZG9uZS5zdGRvdXQgb3IgIm5vIG91dHB1dCBmaWxlIikuc3RyaXAoKSkNCiAgICBleGNlcHQgc3VicHJvY2Vzcy5UaW1lb3V0RXhwaXJlZDoNCiAgICAgICAgZXJyb3JzLmFwcGVuZCgib3Nhc2NyaXB0OiB0aW1lb3V0IGFmdGVyICVzcyIgJSB0aW1lb3V0KQ0KICAgIGV4Y2VwdCBPU0Vycm9yIGFzIGVycm9yOg0KICAgICAgICBlcnJvcnMuYXBwZW5kKCJvc2FzY3JpcHQ6ICVzIiAlIGVycm9yKQ0KDQogICAgIyBGYWxsYmFjazogaGFuZCB0aGUgLmpzeCB0byBQaG90b3Nob3AuIE5lZWRzIG5vIEF1dG9tYXRpb24gcGVybWlzc2lvbiBidXQNCiAgICAjIGlzIGFzeW5jaHJvbm91cywgc28gdGhlIG91dHB1dCBmaWxlIGhhcyB0byBiZSBwb2xsZWQgZm9yLg0KICAgIHRyeToNCiAgICAgICAgc3VicHJvY2Vzcy5ydW4oWyJvcGVuIiwgIi1hIiwgc3RyKGFwcF9wYXRoKSwgc3RyKHNjcmlwdCldLCBjYXB0dXJlX291dHB1dD1UcnVlLCB0ZXh0PVRydWUsIHRpbWVvdXQ9MzApDQogICAgZXhjZXB0IChzdWJwcm9jZXNzLlRpbWVvdXRFeHBpcmVkLCBPU0Vycm9yKSBhcyBlcnJvcjoNCiAgICAgICAgZXJyb3JzLmFwcGVuZCgib3BlbiAtYTogJXMiICUgZXJyb3IpDQogICAgIyBvcGVuIC1hIHJldHVybnMgYXMgc29vbiBhcyBQaG90b3Nob3AgaGFzIGJlZW4gaGFuZGVkIHRoZSBzY3JpcHQsIHNvIHRoaXMNCiAgICAjIGhhcyB0byB3YWl0IGZvciBhIGNvbXBsZXRlIGZpbGUsIG5vdCBtZXJlbHkgZm9yIG9uZSB0byBhcHBlYXIuDQogICAgaWYgd2FpdF9mb3Jfb3V0cHV0KG91dF9maWxlLCB0aW1lb3V0KToNCiAgICAgICAgcmV0dXJuICJvcGVuLWEiDQogICAgZXJyb3JzLmFwcGVuZCgib3BlbiAtYTogbm8gY29tcGxldGUgb3V0cHV0IGZpbGUgd2l0aGluICVzcyIgJSB0aW1lb3V0KQ0KDQogICAgcmFpc2UgRGljdXRFcnJvcigNCiAgICAgICAgIlBob3Rvc2hvcCDguYTguKHguYjguJXguK3guJrguKrguJnguK3guIcg4oCUICIgKyAiIHwgIi5qb2luKGVycm9ycykNCiAgICAgICAgKyAiIHwg4LiW4LmJ4Liy4LiC4Li24LmJ4LiZIE5vdCBhdXRob3JpemVkIOC5g+C4q+C5ieC5gOC4m+C4tOC4lCBTeXN0ZW0gU2V0dGluZ3MgPiBQcml2YWN5ICYgU2VjdXJpdHkgPiBBdXRvbWF0aW9uIg0KICAgICkNCg0KDQpkZWYgZGljdXRfYnl0ZXMocGF5bG9hZCwgbWltZSwgdGltZW91dCwga2VlcF93b3JrLCB0cmltPVRydWUpOg0KICAgICIiIlJlbW92ZSB0aGUgYmFja2dyb3VuZCBmcm9tIGltYWdlIGJ5dGVzIGFuZCByZXR1cm4gdHJhbnNwYXJlbnQgUE5HIGJ5dGVzLiIiIg0KICAgIHN0YXR1cyA9IHBob3Rvc2hvcF9zdGF0dXMoKQ0KICAgIGlmIG5vdCBzdGF0dXNbImZvdW5kIl06DQogICAgICAgIHJhaXNlIERpY3V0RXJyb3IoIuC5hOC4oeC5iOC4nuC4miBBZG9iZSBQaG90b3Nob3Ag4Lia4LiZ4LmA4LiE4Lij4Li34LmI4Lit4LiH4LiZ4Li14LmJICjguJXguYnguK3guIfguYDguJvguYfguJkgMjAyMiDguILguLbguYnguJnguYTguJspIikNCg0KICAgIHN1ZmZpeCA9IEVYVEVOU0lPTl9CWV9NSU1FLmdldCgobWltZSBvciAiIikubG93ZXIoKSwgIi5wbmciKQ0KICAgIHdvcmsgPSBQYXRoKHRlbXBmaWxlLmdldHRlbXBkaXIoKSkgLyAiZGljdXQtYnJpZGdlIiAvIHV1aWQudXVpZDQoKS5oZXgNCiAgICB3b3JrLm1rZGlyKHBhcmVudHM9VHJ1ZSwgZXhpc3Rfb2s9VHJ1ZSkNCiAgICBzcmMgPSB3b3JrIC8gKCJzb3VyY2UiICsgc3VmZml4KQ0KICAgIG91dCA9IHdvcmsgLyAic291cmNlX2RpY3V0LnBuZyINCiAgICBzY3JpcHQgPSB3b3JrIC8gInJ1bi5qc3giDQogICAgc3JjLndyaXRlX2J5dGVzKHBheWxvYWQpDQogICAgc2NyaXB0LndyaXRlX3RleHQoDQogICAgICAgIEpTWF9URU1QTEFURSAlIHsic3JjIjoganN4X3BhdGgoc3JjKSwgIm91dCI6IGpzeF9wYXRoKG91dCksICJ0cmltIjogVFJJTV9MSU5FIGlmIHRyaW0gZWxzZSAiIn0sDQogICAgICAgIGVuY29kaW5nPSJ1dGYtOCIsDQogICAgKQ0KDQogICAgc3RhcnRlZCA9IHRpbWUudGltZSgpDQogICAgdHJ5Og0KICAgICAgICB3aXRoIFBIT1RPU0hPUF9MT0NLOg0KICAgICAgICAgICAgaWYgSVNfV0lORE9XUzoNCiAgICAgICAgICAgICAgICBtZXRob2QgPSBydW5fcGhvdG9zaG9wX3dpbmRvd3Moc2NyaXB0LCBvdXQsIHRpbWVvdXQpDQogICAgICAgICAgICBlbGlmIElTX01BQzoNCiAgICAgICAgICAgICAgICBtZXRob2QgPSBydW5fcGhvdG9zaG9wX21hYyhzY3JpcHQsIG91dCwgdGltZW91dCwgZmluZF9waG90b3Nob3BfbWFjKCkpDQogICAgICAgICAgICBlbHNlOg0KICAgICAgICAgICAgICAgIHJhaXNlIERpY3V0RXJyb3IoIuC4o+C4reC4h+C4o+C4seC4muC5gOC4ieC4nuC4suC4sCBXaW5kb3dzIOC5geC4peC4sCBtYWNPUyIpDQogICAgICAgIHJlc3VsdCA9IG91dC5yZWFkX2J5dGVzKCkNCiAgICAgICAgaWYgbm90IHJlc3VsdDoNCiAgICAgICAgICAgIHJhaXNlIERpY3V0RXJyb3IoIlBob3Rvc2hvcCDguITguLfguJnguYTguJ/guKXguYzguKfguYjguLLguIciKQ0KICAgICAgICByZXR1cm4gew0KICAgICAgICAgICAgInBuZyI6IHJlc3VsdCwNCiAgICAgICAgICAgICJtZXRob2QiOiBtZXRob2QsDQogICAgICAgICAgICAibXMiOiBpbnQoKHRpbWUudGltZSgpIC0gc3RhcnRlZCkgKiAxMDAwKSwNCiAgICAgICAgICAgICJwaG90b3Nob3AiOiBzdGF0dXNbIm5hbWUiXSwNCiAgICAgICAgfQ0KICAgIGZpbmFsbHk6DQogICAgICAgIGlmIG5vdCBrZWVwX3dvcms6DQogICAgICAgICAgICBzaHV0aWwucm10cmVlKHdvcmssIGlnbm9yZV9lcnJvcnM9VHJ1ZSkNCg0KDQpkZWYgZGVjb2RlX3JlcXVlc3RfaW1hZ2UoYm9keSk6DQogICAgZGF0YV91cmwgPSBib2R5LmdldCgiZGF0YVVybCIpIG9yICIiDQogICAgaWYgZGF0YV91cmw6DQogICAgICAgIG1hdGNoID0gREFUQV9VUkxfUkUubWF0Y2goZGF0YV91cmwuc3RyaXAoKSkNCiAgICAgICAgaWYgbm90IG1hdGNoOg0KICAgICAgICAgICAgcmFpc2UgRGljdXRFcnJvcigiZGF0YVVybCDguYTguKHguYjguJbguLnguIHguJXguYnguK3guIcgKOC4leC5ieC4reC4h+C5gOC4m+C5h+C4mSBiYXNlNjQgZGF0YSBVUkwpIikNCiAgICAgICAgcmV0dXJuIGJhc2U2NC5iNjRkZWNvZGUobWF0Y2guZ3JvdXAoInBheWxvYWQiKSksIG1hdGNoLmdyb3VwKCJtaW1lIikgb3IgImltYWdlL3BuZyINCiAgICByYXcgPSBib2R5LmdldCgiYmFzZTY0Iikgb3IgIiINCiAgICBpZiByYXc6DQogICAgICAgIHJldHVybiBiYXNlNjQuYjY0ZGVjb2RlKHJhdyksIGJvZHkuZ2V0KCJtaW1lIikgb3IgImltYWdlL3BuZyINCiAgICByYWlzZSBEaWN1dEVycm9yKCLguYTguKHguYjguKHguLXguILguYnguK3guKHguLnguKXguKPguLnguJvguYPguJkgcmVxdWVzdCIpDQoNCg0KIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KIyBIVFRQIGxheWVyDQojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tDQoNCmNsYXNzIEJyaWRnZUhhbmRsZXIoQmFzZUhUVFBSZXF1ZXN0SGFuZGxlcik6DQogICAgc2VydmVyX3ZlcnNpb24gPSAiRGljdXRQU0JyaWRnZS8iICsgVkVSU0lPTg0KICAgIHByb3RvY29sX3ZlcnNpb24gPSAiSFRUUC8xLjEiDQogICAgdGltZW91dF9zZWNvbmRzID0gREVGQVVMVF9USU1FT1VUDQogICAga2VlcF93b3JrID0gRmFsc2UNCg0KICAgIGRlZiBsb2dfbWVzc2FnZShzZWxmLCBmbXQsICphcmdzKToNCiAgICAgICAgZW1pdChmbXQgJSBhcmdzKQ0KDQogICAgIyAtLSBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KICAgIGRlZiBjb3JzX2hlYWRlcnMoc2VsZiwgb3JpZ2luKToNCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luIiwgb3JpZ2luIG9yICIqIikNCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiVmFyeSIsICJPcmlnaW4iKQ0KICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzIiwgIkdFVCwgUE9TVCwgT1BUSU9OUyIpDQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMiLCAiQ29udGVudC1UeXBlIikNCiAgICAgICAgIyBDaHJvbWUncyBQcml2YXRlIE5ldHdvcmsgQWNjZXNzIHByZWZsaWdodCBmb3IgaHR0cHMgLT4gMTI3LjAuMC4xLg0KICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1Qcml2YXRlLU5ldHdvcmsiLCAidHJ1ZSIpDQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLU1heC1BZ2UiLCAiNjAwIikNCg0KICAgIGRlZiByZXBseShzZWxmLCBzdGF0dXMsIHBheWxvYWQpOg0KICAgICAgICBvcmlnaW4gPSBzZWxmLmhlYWRlcnMuZ2V0KCJPcmlnaW4iKQ0KICAgICAgICBib2R5ID0ganNvbi5kdW1wcyhwYXlsb2FkLCBlbnN1cmVfYXNjaWk9RmFsc2UpLmVuY29kZSgidXRmLTgiKQ0KICAgICAgICBzZWxmLnNlbmRfcmVzcG9uc2Uoc3RhdHVzKQ0KICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LVR5cGUiLCAiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOCIpDQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNvbnRlbnQtTGVuZ3RoIiwgc3RyKGxlbihib2R5KSkpDQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNhY2hlLUNvbnRyb2wiLCAibm8tc3RvcmUiKQ0KICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJYLUNvbnRlbnQtVHlwZS1PcHRpb25zIiwgIm5vc25pZmYiKQ0KICAgICAgICBzZWxmLmNvcnNfaGVhZGVycyhvcmlnaW4pDQogICAgICAgIHNlbGYuZW5kX2hlYWRlcnMoKQ0KICAgICAgICBzZWxmLndmaWxlLndyaXRlKGJvZHkpDQoNCiAgICBkZWYgZ3VhcmRfb3JpZ2luKHNlbGYpOg0KICAgICAgICBvcmlnaW4gPSBzZWxmLmhlYWRlcnMuZ2V0KCJPcmlnaW4iKQ0KICAgICAgICBpZiBvcmlnaW5fYWxsb3dlZChvcmlnaW4pOg0KICAgICAgICAgICAgcmV0dXJuIFRydWUNCiAgICAgICAgc2VsZi5yZXBseSg0MDMsIHsib2siOiBGYWxzZSwgImVycm9yIjogIm9yaWdpbiDguYTguKHguYjguYTguJTguYnguKPguLHguJrguK3guJnguLjguI3guLLguJU6ICVzIiAlIG9yaWdpbn0pDQogICAgICAgIHJldHVybiBGYWxzZQ0KDQogICAgIyAtLSByb3V0ZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQ0KICAgIGRlZiBkb19PUFRJT05TKHNlbGYpOiAgIyBub3FhOiBOODAyIC0gQmFzZUhUVFBSZXF1ZXN0SGFuZGxlciBuYW1pbmcNCiAgICAgICAgb3JpZ2luID0gc2VsZi5oZWFkZXJzLmdldCgiT3JpZ2luIikNCiAgICAgICAgaWYgbm90IG9yaWdpbl9hbGxvd2VkKG9yaWdpbik6DQogICAgICAgICAgICBzZWxmLnNlbmRfcmVzcG9uc2UoNDAzKQ0KICAgICAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1MZW5ndGgiLCAiMCIpDQogICAgICAgICAgICBzZWxmLmVuZF9oZWFkZXJzKCkNCiAgICAgICAgICAgIHJldHVybg0KICAgICAgICBzZWxmLnNlbmRfcmVzcG9uc2UoMjA0KQ0KICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LUxlbmd0aCIsICIwIikNCiAgICAgICAgc2VsZi5jb3JzX2hlYWRlcnMob3JpZ2luKQ0KICAgICAgICBzZWxmLmVuZF9oZWFkZXJzKCkNCg0KICAgIGRlZiBkb19HRVQoc2VsZik6ICAjIG5vcWE6IE44MDINCiAgICAgICAgaWYgc2VsZi5wYXRoLnNwbGl0KCI/IilbMF0gbm90IGluICgiL2hlYWx0aCIsICIvIik6DQogICAgICAgICAgICBzZWxmLnJlcGx5KDQwNCwgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiAibm90IGZvdW5kIn0pDQogICAgICAgICAgICByZXR1cm4NCiAgICAgICAgaWYgbm90IHNlbGYuZ3VhcmRfb3JpZ2luKCk6DQogICAgICAgICAgICByZXR1cm4NCiAgICAgICAgc3RhdHVzID0gcGhvdG9zaG9wX3N0YXR1cygpDQogICAgICAgIHNlbGYucmVwbHkoMjAwLCB7DQogICAgICAgICAgICAib2siOiBUcnVlLA0KICAgICAgICAgICAgIm5hbWUiOiAiZGljdXQtcHMtYnJpZGdlIiwNCiAgICAgICAgICAgICJ2ZXJzaW9uIjogVkVSU0lPTiwNCiAgICAgICAgICAgICJwbGF0Zm9ybSI6IHN5cy5wbGF0Zm9ybSwNCiAgICAgICAgICAgICJvcyI6IHBsYXRmb3JtLnBsYXRmb3JtKCksDQogICAgICAgICAgICAicGhvdG9zaG9wIjogc3RhdHVzWyJuYW1lIl0sDQogICAgICAgICAgICAicGhvdG9zaG9wRm91bmQiOiBzdGF0dXNbImZvdW5kIl0sDQogICAgICAgICAgICAiYnVzeSI6IFBIT1RPU0hPUF9MT0NLLmxvY2tlZCgpLA0KICAgICAgICB9KQ0KDQogICAgZGVmIGRvX1BPU1Qoc2VsZik6ICAjIG5vcWE6IE44MDINCiAgICAgICAgaWYgc2VsZi5wYXRoLnNwbGl0KCI/IilbMF0gIT0gIi9kaWN1dCI6DQogICAgICAgICAgICBzZWxmLnJlcGx5KDQwNCwgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiAibm90IGZvdW5kIn0pDQogICAgICAgICAgICByZXR1cm4NCiAgICAgICAgaWYgbm90IHNlbGYuZ3VhcmRfb3JpZ2luKCk6DQogICAgICAgICAgICByZXR1cm4NCiAgICAgICAgdHJ5Og0KICAgICAgICAgICAgbGVuZ3RoID0gaW50KHNlbGYuaGVhZGVycy5nZXQoIkNvbnRlbnQtTGVuZ3RoIikgb3IgMCkNCiAgICAgICAgZXhjZXB0IFZhbHVlRXJyb3I6DQogICAgICAgICAgICBsZW5ndGggPSAwDQogICAgICAgIGlmIGxlbmd0aCA8PSAwOg0KICAgICAgICAgICAgc2VsZi5yZXBseSg0MDAsIHsib2siOiBGYWxzZSwgImVycm9yIjogInJlcXVlc3Qg4Lin4LmI4Liy4LiHIn0pDQogICAgICAgICAgICByZXR1cm4NCiAgICAgICAgaWYgbGVuZ3RoID4gTUFYX0JPRFlfQllURVM6DQogICAgICAgICAgICBzZWxmLnJlcGx5KDQxMywgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiAi4Lij4Li54Lib4LmD4Lir4LiN4LmI4LmA4LiB4Li04LiZICVkIE1CIiAlIChNQVhfQk9EWV9CWVRFUyAvLyAxMDI0IC8vIDEwMjQpfSkNCiAgICAgICAgICAgIHJldHVybg0KICAgICAgICB0cnk6DQogICAgICAgICAgICBib2R5ID0ganNvbi5sb2FkcyhzZWxmLnJmaWxlLnJlYWQobGVuZ3RoKS5kZWNvZGUoInV0Zi04IikpDQogICAgICAgIGV4Y2VwdCAoVmFsdWVFcnJvciwgVW5pY29kZURlY29kZUVycm9yKSBhcyBlcnJvcjoNCiAgICAgICAgICAgIHNlbGYucmVwbHkoNDAwLCB7Im9rIjogRmFsc2UsICJlcnJvciI6ICLguK3guYjguLLguJkgSlNPTiDguYTguKHguYjguYTguJTguYk6ICVzIiAlIGVycm9yfSkNCiAgICAgICAgICAgIHJldHVybg0KDQogICAgICAgIG5hbWUgPSBzdHIoYm9keS5nZXQoIm5hbWUiKSBvciAiaW1hZ2UiKQ0KICAgICAgICB0cmltID0gYm9keS5nZXQoInRyaW0iKSBpcyBub3QgRmFsc2UNCiAgICAgICAgdHJ5Og0KICAgICAgICAgICAgcGF5bG9hZCwgbWltZSA9IGRlY29kZV9yZXF1ZXN0X2ltYWdlKGJvZHkpDQogICAgICAgICAgICByZXN1bHQgPSBkaWN1dF9ieXRlcyhwYXlsb2FkLCBtaW1lLCBzZWxmLnRpbWVvdXRfc2Vjb25kcywgc2VsZi5rZWVwX3dvcmssIHRyaW0pDQogICAgICAgIGV4Y2VwdCBEaWN1dEVycm9yIGFzIGVycm9yOg0KICAgICAgICAgICAgc2VsZi5sb2dfbWVzc2FnZSgiZGljdXQgRkFJTEVEICVzIC0gJXMiLCBuYW1lLCBlcnJvcikNCiAgICAgICAgICAgIHNlbGYucmVwbHkoNTAyLCB7Im9rIjogRmFsc2UsICJlcnJvciI6IHN0cihlcnJvcil9KQ0KICAgICAgICAgICAgcmV0dXJuDQogICAgICAgIGV4Y2VwdCBFeGNlcHRpb24gYXMgZXJyb3I6ICAjIG5vcWE6IEJMRTAwMSAtIHN1cmZhY2UgdGhlIHJlYWwgY2F1c2UNCiAgICAgICAgICAgIHNlbGYubG9nX21lc3NhZ2UoImRpY3V0IEVSUk9SICVzIC0gJXMiLCBuYW1lLCBlcnJvcikNCiAgICAgICAgICAgIHNlbGYucmVwbHkoNTAwLCB7Im9rIjogRmFsc2UsICJlcnJvciI6ICIlczogJXMiICUgKHR5cGUoZXJyb3IpLl9fbmFtZV9fLCBlcnJvcil9KQ0KICAgICAgICAgICAgcmV0dXJuDQoNCiAgICAgICAgc2VsZi5sb2dfbWVzc2FnZSgiZGljdXQgb2sgJXMgKCVzLCAlc21zKSIsIG5hbWUsIHJlc3VsdFsibWV0aG9kIl0sIHJlc3VsdFsibXMiXSkNCiAgICAgICAgc2VsZi5yZXBseSgyMDAsIHsNCiAgICAgICAgICAgICJvayI6IFRydWUsDQogICAgICAgICAgICAibmFtZSI6IG5hbWUsDQogICAgICAgICAgICAibWV0aG9kIjogcmVzdWx0WyJtZXRob2QiXSwNCiAgICAgICAgICAgICJtcyI6IHJlc3VsdFsibXMiXSwNCiAgICAgICAgICAgICJwaG90b3Nob3AiOiByZXN1bHRbInBob3Rvc2hvcCJdLA0KICAgICAgICAgICAgInRyaW1tZWQiOiB0cmltLA0KICAgICAgICAgICAgImJ5dGVzIjogbGVuKHJlc3VsdFsicG5nIl0pLA0KICAgICAgICAgICAgImRhdGFVcmwiOiAiZGF0YTppbWFnZS9wbmc7YmFzZTY0LCIgKyBiYXNlNjQuYjY0ZW5jb2RlKHJlc3VsdFsicG5nIl0pLmRlY29kZSgiYXNjaWkiKSwNCiAgICAgICAgfSkNCg0KDQpkZWYgc2VsZnRlc3QoaW1hZ2VfcGF0aCwgdGltZW91dCwga2VlcF93b3JrKToNCiAgICBzb3VyY2UgPSBQYXRoKGltYWdlX3BhdGgpDQogICAgaWYgbm90IHNvdXJjZS5pc19maWxlKCk6DQogICAgICAgIGVtaXQoIuC5hOC4oeC5iOC4nuC4muC5hOC4n+C4peC5jDogJXMiICUgc291cmNlKQ0KICAgICAgICByZXR1cm4gMQ0KICAgIHN0YXR1cyA9IHBob3Rvc2hvcF9zdGF0dXMoKQ0KICAgIGVtaXQoInBsYXRmb3JtICA6ICVzIiAlIHN5cy5wbGF0Zm9ybSkNCiAgICBlbWl0KCJwaG90b3Nob3AgOiAlcyIgJSAoc3RhdHVzWyJuYW1lIl0gb3IgIk5PVCBGT1VORCIpKQ0KICAgIGlmIG5vdCBzdGF0dXNbImZvdW5kIl06DQogICAgICAgIHJldHVybiAxDQogICAgbWltZSA9IHsKICAgICAgICAiLnBuZyI6ICJpbWFnZS9wbmciLCAiLndlYnAiOiAiaW1hZ2Uvd2VicCIsICIudGlmIjogImltYWdlL3RpZmYiLAogICAgICAgICIudGlmZiI6ICJpbWFnZS90aWZmIiwgIi5ibXAiOiAiaW1hZ2UvYm1wIiwKICAgIH0uZ2V0KHNvdXJjZS5zdWZmaXgubG93ZXIoKSwgImltYWdlL2pwZWciKQogICAgdHJ5Og0KICAgICAgICByZXN1bHQgPSBkaWN1dF9ieXRlcyhzb3VyY2UucmVhZF9ieXRlcygpLCBtaW1lLCB0aW1lb3V0LCBrZWVwX3dvcmspDQogICAgZXhjZXB0IERpY3V0RXJyb3IgYXMgZXJyb3I6DQogICAgICAgIGVtaXQoIkZBSUxFRDogJXMiICUgZXJyb3IpDQogICAgICAgIHJldHVybiAxDQogICAgb3V0ID0gc291cmNlLndpdGhfbmFtZShzb3VyY2Uuc3RlbSArICJfZGljdXQucG5nIikNCiAgICBvdXQud3JpdGVfYnl0ZXMocmVzdWx0WyJwbmciXSkNCiAgICBlbWl0KCJPSyAoJXMsICVzbXMpIC0+ICVzIiAlIChyZXN1bHRbIm1ldGhvZCJdLCByZXN1bHRbIm1zIl0sIG91dCkpDQogICAgcmV0dXJuIDANCg0KDQpkZWYgbWFpbigpOg0KICAgIHBhcnNlciA9IGFyZ3BhcnNlLkFyZ3VtZW50UGFyc2VyKGRlc2NyaXB0aW9uPSJEaWN1dCBQUyBCcmlkZ2UiKQ0KICAgIHBhcnNlci5hZGRfYXJndW1lbnQoIi0taG9zdCIsIGRlZmF1bHQ9REVGQVVMVF9IT1NUKQ0KICAgIHBhcnNlci5hZGRfYXJndW1lbnQoIi0tcG9ydCIsIHR5cGU9aW50LCBkZWZhdWx0PWludChvcy5lbnZpcm9uLmdldCgiRElDVVRfQlJJREdFX1BPUlQiLCBERUZBVUxUX1BPUlQpKSkNCiAgICBwYXJzZXIuYWRkX2FyZ3VtZW50KCItLXRpbWVvdXQiLCB0eXBlPWludCwgZGVmYXVsdD1ERUZBVUxUX1RJTUVPVVQpDQogICAgcGFyc2VyLmFkZF9hcmd1bWVudCgiLS1rZWVwLXdvcmsiLCBhY3Rpb249InN0b3JlX3RydWUiLCBoZWxwPSJrZWVwIHRoZSB0ZW1wIGZvbGRlciBmb3IgZGVidWdnaW5nIikNCiAgICBwYXJzZXIuYWRkX2FyZ3VtZW50KCItLXNlbGZ0ZXN0IiwgbWV0YXZhcj0iSU1BR0UiLCBoZWxwPSJjdXQgb25lIGZpbGUgYW5kIGV4aXQiKQ0KICAgIGFyZ3MgPSBwYXJzZXIucGFyc2VfYXJncygpDQoNCiAgICBsb2FkX2V4dHJhX29yaWdpbnMoKQ0KICAgIGlmIGFyZ3Muc2VsZnRlc3Q6DQogICAgICAgIHJhaXNlIFN5c3RlbUV4aXQoc2VsZnRlc3QoYXJncy5zZWxmdGVzdCwgYXJncy50aW1lb3V0LCBhcmdzLmtlZXBfd29yaykpDQoNCiAgICBCcmlkZ2VIYW5kbGVyLnRpbWVvdXRfc2Vjb25kcyA9IGFyZ3MudGltZW91dA0KICAgIEJyaWRnZUhhbmRsZXIua2VlcF93b3JrID0gYXJncy5rZWVwX3dvcmsNCiAgICBzZXJ2ZXIgPSBUaHJlYWRpbmdIVFRQU2VydmVyKChhcmdzLmhvc3QsIGFyZ3MucG9ydCksIEJyaWRnZUhhbmRsZXIpDQogICAgc3RhdHVzID0gcGhvdG9zaG9wX3N0YXR1cygpDQogICAgZW1pdCgiRGljdXQgUFMgQnJpZGdlICVzIiAlIFZFUlNJT04pDQogICAgZW1pdCgibGlzdGVuaW5nIDogaHR0cDovLyVzOiVkIiAlIChhcmdzLmhvc3QsIGFyZ3MucG9ydCkpDQogICAgZW1pdCgicGhvdG9zaG9wIDogJXMiICUgKHN0YXR1c1sibmFtZSJdIG9yICJOT1QgRk9VTkQgLSDguJXguLTguJTguJXguLHguYnguIcgUGhvdG9zaG9wIDIwMjIrIOC4geC5iOC4reC4mSIpKQ0KICAgIGVtaXQoInN0b3AgICAgICA6IEN0cmwrQyIpDQogICAgdHJ5Og0KICAgICAgICBzZXJ2ZXIuc2VydmVfZm9yZXZlcigpDQogICAgZXhjZXB0IEtleWJvYXJkSW50ZXJydXB0Og0KICAgICAgICBlbWl0KCJzdG9wcGVkIikNCiAgICBmaW5hbGx5Og0KICAgICAgICBzZXJ2ZXIuc2VydmVyX2Nsb3NlKCkNCg0KDQppZiBfX25hbWVfXyA9PSAiX19tYWluX18iOg0KICAgIG1haW4oKQ0K';
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
  // so a single normaliser covers every consumer discovered from the Registry.
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
