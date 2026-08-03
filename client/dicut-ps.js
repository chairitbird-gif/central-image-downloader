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

  var VERSION = '1.1.0';
  var ENDPOINT = 'http://127.0.0.1:8799';
  // document.currentScript is only readable while the script is executing, and
  // the stylesheet sits next to this file whatever path a tool serves it from.
  var SCRIPT_URL = (document.currentScript && document.currentScript.src) || '';
  var PROBE_TIMEOUT_MS = 2500;
  var CUT_TIMEOUT_MS = 240000;   // Photoshop's first launch can take minutes
  var PROBE_TTL_OK_MS = 15000;
  var PROBE_TTL_FAIL_MS = 3000;

  /* BRIDGE_SOURCE_B64_START */
  var BRIDGE_SOURCE_B64 = 'IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMwojIC0qLSBjb2Rpbmc6IHV0Zi04IC0qLQoiIiJEaWN1dCBQUyBCcmlkZ2UgLSBsb2NhbCBIVFRQIHNlcnZpY2UgdGhhdCBydW5zIFBob3Rvc2hvcCAiUmVtb3ZlIEJhY2tncm91bmQiLgoKVGhlIENlbnRyYWwgQ3JlYXRpdmUgVG9vbHMgd2ViIGFwcHMgY2Fubm90IHRhbGsgdG8gYSBsb2NhbGx5IGluc3RhbGxlZApQaG90b3Nob3AsIHNvIHRoZXkgUE9TVCBhbiBpbWFnZSBoZXJlIGFuZCBnZXQgYSB0cmFuc3BhcmVudCBQTkcgYmFjay4KVGhlIHNhbWUgc2VydmljZSBydW5zIG9uIFdpbmRvd3MgKENPTSkgYW5kIG1hY09TIChBcHBsZSBldmVudHMpLCB3aGljaCBpcyB3aGF0CmxldHMgb25lIGJ1dHRvbiB3b3JrIG9uIGJvdGggcGxhdGZvcm1zLgoKUnVuOiAgICAgICAgcHl0aG9uIGRpY3V0X2JyaWRnZS5weQpPcHRpb25zOiAgICAtLXBvcnQgODc5OSAgLS1ob3N0IDEyNy4wLjAuMSAgLS10aW1lb3V0IDE4MCAgLS1rZWVwLXdvcmsKSGVhbHRoOiAgICAgY3VybCBodHRwOi8vMTI3LjAuMC4xOjg3OTkvaGVhbHRoClNlbGYgdGVzdDogIHB5dGhvbiBkaWN1dF9icmlkZ2UucHkgLS1zZWxmdGVzdCBwYXRoL3RvL2ltYWdlLmpwZwoKT25seSB0aGUgbG9vcGJhY2sgaW50ZXJmYWNlIGlzIGJvdW5kIGFuZCBvbmx5IGFsbG93LWxpc3RlZCBicm93c2VyIG9yaWdpbnMgYXJlCmFjY2VwdGVkLCBzbyBhIHJhbmRvbSB3ZWIgcGFnZSBjYW5ub3QgZHJpdmUgdGhlIGxvY2FsIFBob3Rvc2hvcC4KIiIiCgppbXBvcnQgYXJncGFyc2UKaW1wb3J0IGJhc2U2NAppbXBvcnQganNvbgppbXBvcnQgb3MKaW1wb3J0IHBsYXRmb3JtCmltcG9ydCByZQppbXBvcnQgc2h1dGlsCmltcG9ydCBzdWJwcm9jZXNzCmltcG9ydCBzeXMKaW1wb3J0IHRlbXBmaWxlCmltcG9ydCB0aHJlYWRpbmcKaW1wb3J0IHRpbWUKaW1wb3J0IHV1aWQKZnJvbSBodHRwLnNlcnZlciBpbXBvcnQgQmFzZUhUVFBSZXF1ZXN0SGFuZGxlciwgVGhyZWFkaW5nSFRUUFNlcnZlcgpmcm9tIHBhdGhsaWIgaW1wb3J0IFBhdGgKClZFUlNJT04gPSAiMS4xLjAiCkRFRkFVTFRfUE9SVCA9IDg3OTkKREVGQVVMVF9IT1NUID0gIjEyNy4wLjAuMSIKREVGQVVMVF9USU1FT1VUID0gMTgwCk1BWF9CT0RZX0JZVEVTID0gNDggKiAxMDI0ICogMTAyNAoKSVNfV0lORE9XUyA9IHN5cy5wbGF0Zm9ybS5zdGFydHN3aXRoKCJ3aW4iKQpJU19NQUMgPSBzeXMucGxhdGZvcm0gPT0gImRhcndpbiIKCiMgUHJvZHVjdGlvbiBvcmlnaW5zIG9mIHRoZSBmb3VyIHRvb2xzIHRoYXQgb3duIGEgRGljdXQgUFMgYnV0dG9uLiBQcmV2aWV3CiMgZGVwbG95bWVudHMgbGl2ZSBvbiBzdWJkb21haW5zIG9mIHRoZSBzYW1lIFBhZ2VzIHByb2plY3RzLCBzbyB0aG9zZSBhcmUKIyBtYXRjaGVkIGJ5IHN1ZmZpeC4gRXh0cmEgb3JpZ2lucyBjYW4gYmUgYWRkZWQgd2l0aCBESUNVVF9CUklER0VfT1JJR0lOUy4KQUxMT1dFRF9PUklHSU5TID0gewogICAgImh0dHBzOi8vY2VudHJhbC1pbWFnZS1kb3dubG9hZGVyLnBhZ2VzLmRldiIsCiAgICAiaHR0cHM6Ly9jZW50cmFsLXN0cmlwLWJhbm5lci5wYWdlcy5kZXYiLAogICAgImh0dHBzOi8vY2VudHJhbC1vdmVybGF5LWdlbmVyYXRvci5wYWdlcy5kZXYiLAogICAgImh0dHBzOi8vY2VudHJhbC1maXJzdC1pbWFnZS5jaGFpcml0LWJpcmQud29ya2Vycy5kZXYiLAp9CkFMTE9XRURfT1JJR0lOX1NVRkZJWEVTID0gKAogICAgIi5jZW50cmFsLWltYWdlLWRvd25sb2FkZXIucGFnZXMuZGV2IiwKICAgICIuY2VudHJhbC1zdHJpcC1iYW5uZXIucGFnZXMuZGV2IiwKICAgICIuY2VudHJhbC1vdmVybGF5LWdlbmVyYXRvci5wYWdlcy5kZXYiLAopCkxPQ0FMX09SSUdJTl9SRSA9IHJlLmNvbXBpbGUociJeaHR0cHM/Oi8vKGxvY2FsaG9zdHwxMjdcLjBcLjBcLjF8XFs6OjFcXSkoOlxkKyk/JCIpCgpFWFRFTlNJT05fQllfTUlNRSA9IHsKICAgICJpbWFnZS9wbmciOiAiLnBuZyIsCiAgICAiaW1hZ2UvanBlZyI6ICIuanBnIiwKICAgICJpbWFnZS9qcGciOiAiLmpwZyIsCiAgICAiaW1hZ2Uvd2VicCI6ICIud2VicCIsCiAgICAiaW1hZ2UvdGlmZiI6ICIudGlmIiwKICAgICJpbWFnZS9ibXAiOiAiLmJtcCIsCn0KCkRBVEFfVVJMX1JFID0gcmUuY29tcGlsZShyIl5kYXRhOig/UDxtaW1lPltcdy4rLV0rL1tcdy4rLV0rKT87YmFzZTY0LCg/UDxwYXlsb2FkPi4rKSQiLCByZS5TKQoKIyBQaG90b3Nob3AgaXMgc2luZ2xlLWluc3RhbmNlOiB0d28gb3ZlcmxhcHBpbmcgRG9KYXZhU2NyaXB0IGNhbGxzIGZpZ2h0IG92ZXIKIyB0aGUgc2FtZSBhcHBsaWNhdGlvbiwgc28gZXZlcnkgY3V0IGlzIHNlcmlhbGlzZWQuClBIT1RPU0hPUF9MT0NLID0gdGhyZWFkaW5nLkxvY2soKQoKIyBUcmltbWluZyBpcyBvcHRpb25hbDogYSBjYWxsZXIgdGhhdCB3YW50cyBhIGJlZm9yZS9hZnRlciBjb21wYXJpc29uIG5lZWRzIHRoZQojIHJlc3VsdCBvbiB0aGUgb3JpZ2luYWwgY2FudmFzLCBiZWNhdXNlIGEgdHJpbW1lZCBjdXRvdXQgbm8gbG9uZ2VyIGxpbmVzIHVwCiMgd2l0aCB0aGUgaW1hZ2UgaXQgY2FtZSBmcm9tLgpKU1hfVEVNUExBVEUgPSAiIiJhcHAuZGlzcGxheURpYWxvZ3MgPSBEaWFsb2dNb2Rlcy5OTzsKdmFyIF9zcmMgPSBuZXcgRmlsZSgiJShzcmMpcyIpOwp2YXIgX291dCA9IG5ldyBGaWxlKCIlKG91dClzIik7CnZhciBkb2MgPSBhcHAub3Blbihfc3JjKTsKdHJ5IHsKICAgIGlmIChkb2MubGF5ZXJzWzBdLmlzQmFja2dyb3VuZExheWVyKSBkb2MubGF5ZXJzWzBdLmlzQmFja2dyb3VuZExheWVyID0gZmFsc2U7CiAgICBleGVjdXRlQWN0aW9uKHN0cmluZ0lEVG9UeXBlSUQoJ3JlbW92ZUJhY2tncm91bmQnKSwgdW5kZWZpbmVkLCBEaWFsb2dNb2Rlcy5OTyk7CiUodHJpbSlzICAgIGRvYy5zYXZlQXMoX291dCwgbmV3IFBOR1NhdmVPcHRpb25zKCksIHRydWUsIEV4dGVuc2lvbi5MT1dFUkNBU0UpOwp9IGZpbmFsbHkgewogICAgZG9jLmNsb3NlKFNhdmVPcHRpb25zLkRPTk9UU0FWRUNIQU5HRVMpOwp9CiIiIgpUUklNX0xJTkUgPSAiICAgIGRvYy50cmltKFRyaW1UeXBlLlRSQU5TUEFSRU5UKTtcbiIKCgpjbGFzcyBEaWN1dEVycm9yKFJ1bnRpbWVFcnJvcik6CiAgICAiIiJBIGZhaWx1cmUgdGhlIGJyb3dzZXIgaXMgZXhwZWN0ZWQgdG8gc2hvdyB0byB0aGUgdXNlciBhcy1pcy4iIiIKCgpkZWYganN4X3BhdGgodmFsdWUpOgogICAgIiIiRXNjYXBlIGEgZmlsZXN5c3RlbSBwYXRoIGZvciBlbWJlZGRpbmcgaW4gYSBKU1ggc3RyaW5nIGxpdGVyYWwuIiIiCiAgICByZXR1cm4gc3RyKHZhbHVlKS5yZXBsYWNlKCJcXCIsICJcXFxcIikucmVwbGFjZSgnIicsICdcXCInKQoKCmRlZiBvcmlnaW5fYWxsb3dlZChvcmlnaW4pOgogICAgaWYgbm90IG9yaWdpbjoKICAgICAgICByZXR1cm4gVHJ1ZSAgIyBjdXJsIC8gc2VsZiB0ZXN0OiBubyBicm93c2VyIG9yaWdpbiB0byBjaGVjawogICAgaWYgb3JpZ2luIGluIEFMTE9XRURfT1JJR0lOUyBvciBMT0NBTF9PUklHSU5fUkUubWF0Y2gob3JpZ2luKToKICAgICAgICByZXR1cm4gVHJ1ZQogICAgcmV0dXJuIGFueShvcmlnaW4uZW5kc3dpdGgoc3VmZml4KSBmb3Igc3VmZml4IGluIEFMTE9XRURfT1JJR0lOX1NVRkZJWEVTKQoKCmRlZiBsb2FkX2V4dHJhX29yaWdpbnMoKToKICAgIHJhdyA9IG9zLmVudmlyb24uZ2V0KCJESUNVVF9CUklER0VfT1JJR0lOUyIsICIiKQogICAgZm9yIGl0ZW0gaW4gcmF3LnJlcGxhY2UoIiwiLCAiICIpLnNwbGl0KCk6CiAgICAgICAgQUxMT1dFRF9PUklHSU5TLmFkZChpdGVtLnJzdHJpcCgiLyIpKQoKCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KIyBQaG90b3Nob3AgZGlzY292ZXJ5CiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KCmRlZiBmaW5kX3Bob3Rvc2hvcF9tYWMoKToKICAgIGNhbmRpZGF0ZXMgPSBbXQogICAgYXBwcyA9IFBhdGgoIi9BcHBsaWNhdGlvbnMiKQogICAgaWYgYXBwcy5pc19kaXIoKToKICAgICAgICBmb3IgZW50cnkgaW4gc29ydGVkKGFwcHMuZ2xvYigiQWRvYmUgUGhvdG9zaG9wKiIpKToKICAgICAgICAgICAgaWYgZW50cnkuc3VmZml4ID09ICIuYXBwIjoKICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMuYXBwZW5kKGVudHJ5KQogICAgICAgICAgICBlbGlmIGVudHJ5LmlzX2RpcigpOgogICAgICAgICAgICAgICAgY2FuZGlkYXRlcy5leHRlbmQoc29ydGVkKGVudHJ5Lmdsb2IoIkFkb2JlIFBob3Rvc2hvcCouYXBwIikpKQogICAgcmV0dXJuIGNhbmRpZGF0ZXNbLTFdIGlmIGNhbmRpZGF0ZXMgZWxzZSBOb25lCgoKZGVmIGZpbmRfcGhvdG9zaG9wX3dpbmRvd3MoKToKICAgICIiIlJldHVybiB0aGUgcmVnaXN0ZXJlZCBQaG90b3Nob3AgYXBwbGljYXRpb24gbmFtZSwgb3IgTm9uZS4iIiIKICAgIHRyeToKICAgICAgICBpbXBvcnQgd2lucmVnCiAgICBleGNlcHQgSW1wb3J0RXJyb3I6ICAjIHByYWdtYTogbm8gY292ZXIgLSBXaW5kb3dzIG9ubHkKICAgICAgICByZXR1cm4gTm9uZQogICAgZm9yIHJvb3QgaW4gKHdpbnJlZy5IS0VZX0NMQVNTRVNfUk9PVCwpOgogICAgICAgIHRyeToKICAgICAgICAgICAgd2l0aCB3aW5yZWcuT3BlbktleShyb290LCByIlBob3Rvc2hvcC5BcHBsaWNhdGlvblxDdXJWZXIiKSBhcyBrZXk6CiAgICAgICAgICAgICAgICB2ZXJzaW9uID0gd2lucmVnLlF1ZXJ5VmFsdWVFeChrZXksICIiKVswXQogICAgICAgICAgICAgICAgcmV0dXJuIHN0cih2ZXJzaW9uKQogICAgICAgIGV4Y2VwdCBPU0Vycm9yOgogICAgICAgICAgICBjb250aW51ZQogICAgdHJ5OgogICAgICAgIHdpdGggd2lucmVnLk9wZW5LZXkod2lucmVnLkhLRVlfQ0xBU1NFU19ST09ULCAiUGhvdG9zaG9wLkFwcGxpY2F0aW9uIik6CiAgICAgICAgICAgIHJldHVybiAiUGhvdG9zaG9wLkFwcGxpY2F0aW9uIgogICAgZXhjZXB0IE9TRXJyb3I6CiAgICAgICAgcmV0dXJuIE5vbmUKCgpkZWYgcGhvdG9zaG9wX3N0YXR1cygpOgogICAgaWYgSVNfTUFDOgogICAgICAgIGFwcCA9IGZpbmRfcGhvdG9zaG9wX21hYygpCiAgICAgICAgcmV0dXJuIHsiZm91bmQiOiBib29sKGFwcCksICJuYW1lIjogYXBwLnN0ZW0gaWYgYXBwIGVsc2UgIiIsICJwYXRoIjogc3RyKGFwcCkgaWYgYXBwIGVsc2UgIiJ9CiAgICBpZiBJU19XSU5ET1dTOgogICAgICAgIG5hbWUgPSBmaW5kX3Bob3Rvc2hvcF93aW5kb3dzKCkKICAgICAgICByZXR1cm4geyJmb3VuZCI6IGJvb2wobmFtZSksICJuYW1lIjogbmFtZSBvciAiIiwgInBhdGgiOiAiIn0KICAgIHJldHVybiB7ImZvdW5kIjogRmFsc2UsICJuYW1lIjogIiIsICJwYXRoIjogIiJ9CgoKIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQojIFBob3Rvc2hvcCBleGVjdXRpb24KIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQoKZGVmIHJ1bl9waG90b3Nob3Bfd2luZG93cyhzY3JpcHQsIG91dF9maWxlLCB0aW1lb3V0KToKICAgICIiIkRyaXZlIFBob3Rvc2hvcCB0aHJvdWdoIENPTTogcHl3aW4zMiB3aGVuIHByZXNlbnQsIFBvd2VyU2hlbGwgb3RoZXJ3aXNlLiIiIgogICAgZXJyb3JzID0gW10KICAgIHRyeToKICAgICAgICBpbXBvcnQgd2luMzJjb20uY2xpZW50ICAjIHR5cGU6IGlnbm9yZQoKICAgICAgICBhcHAgPSB3aW4zMmNvbS5jbGllbnQuRGlzcGF0Y2goIlBob3Rvc2hvcC5BcHBsaWNhdGlvbiIpCiAgICAgICAgIyBEb0phdmFTY3JpcHQgd2l0aCB0aGUgc291cmNlIHRleHQgaXMgdGhlIGNhbGwgcGF0aCBhbHJlYWR5IHByb3ZlbiBieQogICAgICAgICMgdG9vbHMvZGljdXQucHk7IHRoZSBwYXRocyBhcmUgYmFrZWQgaW50byB0aGUgc2NyaXB0IHNvIG5vIGFyZ3VtZW50cwogICAgICAgICMgaGF2ZSB0byBzdXJ2aXZlIHRoZSBDT00gYm91bmRhcnkuCiAgICAgICAgYXBwLkRvSmF2YVNjcmlwdChzY3JpcHQucmVhZF90ZXh0KGVuY29kaW5nPSJ1dGYtOCIpKQogICAgICAgIGlmIG91dF9maWxlLmV4aXN0cygpOgogICAgICAgICAgICByZXR1cm4gImNvbSIKICAgICAgICBlcnJvcnMuYXBwZW5kKCJweXdpbjMyIHJhbiB0aGUgc2NyaXB0IGJ1dCBwcm9kdWNlZCBubyBvdXRwdXQgZmlsZSIpCiAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGVycm9yOiAgIyBub3FhOiBCTEUwMDEgLSByZXBvcnRlZCB0byB0aGUgdXNlciB2ZXJiYXRpbQogICAgICAgIGVycm9ycy5hcHBlbmQoInB5d2luMzI6ICVzIiAlIGVycm9yKQoKICAgIHBvd2Vyc2hlbGwgPSBzaHV0aWwud2hpY2goInBvd2Vyc2hlbGwiKSBvciBzaHV0aWwud2hpY2goInB3c2giKQogICAgaWYgcG93ZXJzaGVsbDoKICAgICAgICBjb21tYW5kID0gKAogICAgICAgICAgICAiJEVycm9yQWN0aW9uUHJlZmVyZW5jZT0nU3RvcCc7IgogICAgICAgICAgICAiJGFwcCA9IE5ldy1PYmplY3QgLUNvbU9iamVjdCBQaG90b3Nob3AuQXBwbGljYXRpb247IgogICAgICAgICAgICAiJGFwcC5Eb0phdmFTY3JpcHRGaWxlKCclcycpIiAlIHN0cihzY3JpcHQpLnJlcGxhY2UoIiciLCAiJyciKQogICAgICAgICkKICAgICAgICB0cnk6CiAgICAgICAgICAgIGRvbmUgPSBzdWJwcm9jZXNzLnJ1bigKICAgICAgICAgICAgICAgIFtwb3dlcnNoZWxsLCAiLU5vUHJvZmlsZSIsICItTm9uSW50ZXJhY3RpdmUiLCAiLUNvbW1hbmQiLCBjb21tYW5kXSwKICAgICAgICAgICAgICAgIGNhcHR1cmVfb3V0cHV0PVRydWUsIHRleHQ9VHJ1ZSwgdGltZW91dD10aW1lb3V0LAogICAgICAgICAgICApCiAgICAgICAgICAgIGlmIG91dF9maWxlLmV4aXN0cygpOgogICAgICAgICAgICAgICAgcmV0dXJuICJwb3dlcnNoZWxsIgogICAgICAgICAgICBlcnJvcnMuYXBwZW5kKCJwb3dlcnNoZWxsOiAlcyIgJSAoZG9uZS5zdGRlcnIgb3IgZG9uZS5zdGRvdXQgb3IgIm5vIG91dHB1dCBmaWxlIikuc3RyaXAoKSkKICAgICAgICBleGNlcHQgc3VicHJvY2Vzcy5UaW1lb3V0RXhwaXJlZDoKICAgICAgICAgICAgZXJyb3JzLmFwcGVuZCgicG93ZXJzaGVsbDogdGltZW91dCBhZnRlciAlc3MiICUgdGltZW91dCkKICAgICAgICBleGNlcHQgT1NFcnJvciBhcyBlcnJvcjoKICAgICAgICAgICAgZXJyb3JzLmFwcGVuZCgicG93ZXJzaGVsbDogJXMiICUgZXJyb3IpCiAgICBlbHNlOgogICAgICAgIGVycm9ycy5hcHBlbmQoInBvd2Vyc2hlbGwgbm90IGZvdW5kIG9uIFBBVEgiKQoKICAgIHJhaXNlIERpY3V0RXJyb3IoIlBob3Rvc2hvcCDguYTguKHguYjguJXguK3guJrguKrguJnguK3guIcg4oCUICIgKyAiIHwgIi5qb2luKGVycm9ycykpCgoKZGVmIHJ1bl9waG90b3Nob3BfbWFjKHNjcmlwdCwgb3V0X2ZpbGUsIHRpbWVvdXQsIGFwcF9wYXRoKToKICAgIGlmIG5vdCBhcHBfcGF0aDoKICAgICAgICByYWlzZSBEaWN1dEVycm9yKCLguYTguKHguYjguJ7guJogQWRvYmUgUGhvdG9zaG9wIOC5g+C4mSAvQXBwbGljYXRpb25zIikKICAgIG5hbWUgPSBhcHBfcGF0aC5zdGVtCiAgICBlcnJvcnMgPSBbXQogICAgdHJ5OgogICAgICAgIGRvbmUgPSBzdWJwcm9jZXNzLnJ1bigKICAgICAgICAgICAgWwogICAgICAgICAgICAgICAgIm9zYXNjcmlwdCIsCiAgICAgICAgICAgICAgICAiLWUiLCAndGVsbCBhcHBsaWNhdGlvbiAiJXMiIHRvIGFjdGl2YXRlJyAlIG5hbWUsCiAgICAgICAgICAgICAgICAiLWUiLCAndGVsbCBhcHBsaWNhdGlvbiAiJXMiIHRvIGRvIGphdmFzY3JpcHQgKFBPU0lYIGZpbGUgIiVzIiknICUgKG5hbWUsIHNjcmlwdCksCiAgICAgICAgICAgIF0sCiAgICAgICAgICAgIGNhcHR1cmVfb3V0cHV0PVRydWUsIHRleHQ9VHJ1ZSwgdGltZW91dD10aW1lb3V0LAogICAgICAgICkKICAgICAgICBpZiBvdXRfZmlsZS5leGlzdHMoKToKICAgICAgICAgICAgcmV0dXJuICJhcHBsZS1ldmVudHMiCiAgICAgICAgZXJyb3JzLmFwcGVuZCgib3Nhc2NyaXB0OiAlcyIgJSAoZG9uZS5zdGRlcnIgb3IgZG9uZS5zdGRvdXQgb3IgIm5vIG91dHB1dCBmaWxlIikuc3RyaXAoKSkKICAgIGV4Y2VwdCBzdWJwcm9jZXNzLlRpbWVvdXRFeHBpcmVkOgogICAgICAgIGVycm9ycy5hcHBlbmQoIm9zYXNjcmlwdDogdGltZW91dCBhZnRlciAlc3MiICUgdGltZW91dCkKICAgIGV4Y2VwdCBPU0Vycm9yIGFzIGVycm9yOgogICAgICAgIGVycm9ycy5hcHBlbmQoIm9zYXNjcmlwdDogJXMiICUgZXJyb3IpCgogICAgIyBGYWxsYmFjazogaGFuZCB0aGUgLmpzeCB0byBQaG90b3Nob3AuIE5lZWRzIG5vIEF1dG9tYXRpb24gcGVybWlzc2lvbiBidXQKICAgICMgaXMgYXN5bmNocm9ub3VzLCBzbyB0aGUgb3V0cHV0IGZpbGUgaGFzIHRvIGJlIHBvbGxlZCBmb3IuCiAgICB0cnk6CiAgICAgICAgc3VicHJvY2Vzcy5ydW4oWyJvcGVuIiwgIi1hIiwgc3RyKGFwcF9wYXRoKSwgc3RyKHNjcmlwdCldLCBjYXB0dXJlX291dHB1dD1UcnVlLCB0ZXh0PVRydWUsIHRpbWVvdXQ9MzApCiAgICBleGNlcHQgKHN1YnByb2Nlc3MuVGltZW91dEV4cGlyZWQsIE9TRXJyb3IpIGFzIGVycm9yOgogICAgICAgIGVycm9ycy5hcHBlbmQoIm9wZW4gLWE6ICVzIiAlIGVycm9yKQogICAgZGVhZGxpbmUgPSB0aW1lLnRpbWUoKSArIHRpbWVvdXQKICAgIHdoaWxlIHRpbWUudGltZSgpIDwgZGVhZGxpbmU6CiAgICAgICAgaWYgb3V0X2ZpbGUuZXhpc3RzKCk6CiAgICAgICAgICAgIHJldHVybiAib3Blbi1hIgogICAgICAgIHRpbWUuc2xlZXAoMC41KQogICAgZXJyb3JzLmFwcGVuZCgib3BlbiAtYTogdGltZW91dCBhZnRlciAlc3MiICUgdGltZW91dCkKCiAgICByYWlzZSBEaWN1dEVycm9yKAogICAgICAgICJQaG90b3Nob3Ag4LmE4Lih4LmI4LiV4Lit4Lia4Liq4LiZ4Lit4LiHIOKAlCAiICsgIiB8ICIuam9pbihlcnJvcnMpCiAgICAgICAgKyAiIHwg4LiW4LmJ4Liy4LiC4Li24LmJ4LiZIE5vdCBhdXRob3JpemVkIOC5g+C4q+C5ieC5gOC4m+C4tOC4lCBTeXN0ZW0gU2V0dGluZ3MgPiBQcml2YWN5ICYgU2VjdXJpdHkgPiBBdXRvbWF0aW9uIgogICAgKQoKCmRlZiBkaWN1dF9ieXRlcyhwYXlsb2FkLCBtaW1lLCB0aW1lb3V0LCBrZWVwX3dvcmssIHRyaW09VHJ1ZSk6CiAgICAiIiJSZW1vdmUgdGhlIGJhY2tncm91bmQgZnJvbSBpbWFnZSBieXRlcyBhbmQgcmV0dXJuIHRyYW5zcGFyZW50IFBORyBieXRlcy4iIiIKICAgIHN0YXR1cyA9IHBob3Rvc2hvcF9zdGF0dXMoKQogICAgaWYgbm90IHN0YXR1c1siZm91bmQiXToKICAgICAgICByYWlzZSBEaWN1dEVycm9yKCLguYTguKHguYjguJ7guJogQWRvYmUgUGhvdG9zaG9wIOC4muC4meC5gOC4hOC4o+C4t+C5iOC4reC4h+C4meC4teC5iSAo4LiV4LmJ4Lit4LiH4LmA4Lib4LmH4LiZIDIwMjIg4LiC4Li24LmJ4LiZ4LmE4LibKSIpCgogICAgc3VmZml4ID0gRVhURU5TSU9OX0JZX01JTUUuZ2V0KChtaW1lIG9yICIiKS5sb3dlcigpLCAiLnBuZyIpCiAgICB3b3JrID0gUGF0aCh0ZW1wZmlsZS5nZXR0ZW1wZGlyKCkpIC8gImRpY3V0LWJyaWRnZSIgLyB1dWlkLnV1aWQ0KCkuaGV4CiAgICB3b3JrLm1rZGlyKHBhcmVudHM9VHJ1ZSwgZXhpc3Rfb2s9VHJ1ZSkKICAgIHNyYyA9IHdvcmsgLyAoInNvdXJjZSIgKyBzdWZmaXgpCiAgICBvdXQgPSB3b3JrIC8gInNvdXJjZV9kaWN1dC5wbmciCiAgICBzY3JpcHQgPSB3b3JrIC8gInJ1bi5qc3giCiAgICBzcmMud3JpdGVfYnl0ZXMocGF5bG9hZCkKICAgIHNjcmlwdC53cml0ZV90ZXh0KAogICAgICAgIEpTWF9URU1QTEFURSAlIHsic3JjIjoganN4X3BhdGgoc3JjKSwgIm91dCI6IGpzeF9wYXRoKG91dCksICJ0cmltIjogVFJJTV9MSU5FIGlmIHRyaW0gZWxzZSAiIn0sCiAgICAgICAgZW5jb2Rpbmc9InV0Zi04IiwKICAgICkKCiAgICBzdGFydGVkID0gdGltZS50aW1lKCkKICAgIHRyeToKICAgICAgICB3aXRoIFBIT1RPU0hPUF9MT0NLOgogICAgICAgICAgICBpZiBJU19XSU5ET1dTOgogICAgICAgICAgICAgICAgbWV0aG9kID0gcnVuX3Bob3Rvc2hvcF93aW5kb3dzKHNjcmlwdCwgb3V0LCB0aW1lb3V0KQogICAgICAgICAgICBlbGlmIElTX01BQzoKICAgICAgICAgICAgICAgIG1ldGhvZCA9IHJ1bl9waG90b3Nob3BfbWFjKHNjcmlwdCwgb3V0LCB0aW1lb3V0LCBmaW5kX3Bob3Rvc2hvcF9tYWMoKSkKICAgICAgICAgICAgZWxzZToKICAgICAgICAgICAgICAgIHJhaXNlIERpY3V0RXJyb3IoIuC4o+C4reC4h+C4o+C4seC4muC5gOC4ieC4nuC4suC4sCBXaW5kb3dzIOC5geC4peC4sCBtYWNPUyIpCiAgICAgICAgcmVzdWx0ID0gb3V0LnJlYWRfYnl0ZXMoKQogICAgICAgIGlmIG5vdCByZXN1bHQ6CiAgICAgICAgICAgIHJhaXNlIERpY3V0RXJyb3IoIlBob3Rvc2hvcCDguITguLfguJnguYTguJ/guKXguYzguKfguYjguLLguIciKQogICAgICAgIHJldHVybiB7CiAgICAgICAgICAgICJwbmciOiByZXN1bHQsCiAgICAgICAgICAgICJtZXRob2QiOiBtZXRob2QsCiAgICAgICAgICAgICJtcyI6IGludCgodGltZS50aW1lKCkgLSBzdGFydGVkKSAqIDEwMDApLAogICAgICAgICAgICAicGhvdG9zaG9wIjogc3RhdHVzWyJuYW1lIl0sCiAgICAgICAgfQogICAgZmluYWxseToKICAgICAgICBpZiBub3Qga2VlcF93b3JrOgogICAgICAgICAgICBzaHV0aWwucm10cmVlKHdvcmssIGlnbm9yZV9lcnJvcnM9VHJ1ZSkKCgpkZWYgZGVjb2RlX3JlcXVlc3RfaW1hZ2UoYm9keSk6CiAgICBkYXRhX3VybCA9IGJvZHkuZ2V0KCJkYXRhVXJsIikgb3IgIiIKICAgIGlmIGRhdGFfdXJsOgogICAgICAgIG1hdGNoID0gREFUQV9VUkxfUkUubWF0Y2goZGF0YV91cmwuc3RyaXAoKSkKICAgICAgICBpZiBub3QgbWF0Y2g6CiAgICAgICAgICAgIHJhaXNlIERpY3V0RXJyb3IoImRhdGFVcmwg4LmE4Lih4LmI4LiW4Li54LiB4LiV4LmJ4Lit4LiHICjguJXguYnguK3guIfguYDguJvguYfguJkgYmFzZTY0IGRhdGEgVVJMKSIpCiAgICAgICAgcmV0dXJuIGJhc2U2NC5iNjRkZWNvZGUobWF0Y2guZ3JvdXAoInBheWxvYWQiKSksIG1hdGNoLmdyb3VwKCJtaW1lIikgb3IgImltYWdlL3BuZyIKICAgIHJhdyA9IGJvZHkuZ2V0KCJiYXNlNjQiKSBvciAiIgogICAgaWYgcmF3OgogICAgICAgIHJldHVybiBiYXNlNjQuYjY0ZGVjb2RlKHJhdyksIGJvZHkuZ2V0KCJtaW1lIikgb3IgImltYWdlL3BuZyIKICAgIHJhaXNlIERpY3V0RXJyb3IoIuC5hOC4oeC5iOC4oeC4teC4guC5ieC4reC4oeC4ueC4peC4o+C4ueC4m+C5g+C4mSByZXF1ZXN0IikKCgojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCiMgSFRUUCBsYXllcgojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCgpjbGFzcyBCcmlkZ2VIYW5kbGVyKEJhc2VIVFRQUmVxdWVzdEhhbmRsZXIpOgogICAgc2VydmVyX3ZlcnNpb24gPSAiRGljdXRQU0JyaWRnZS8iICsgVkVSU0lPTgogICAgcHJvdG9jb2xfdmVyc2lvbiA9ICJIVFRQLzEuMSIKICAgIHRpbWVvdXRfc2Vjb25kcyA9IERFRkFVTFRfVElNRU9VVAogICAga2VlcF93b3JrID0gRmFsc2UKCiAgICBkZWYgbG9nX21lc3NhZ2Uoc2VsZiwgZm10LCAqYXJncyk6CiAgICAgICAgc3lzLnN0ZG91dC53cml0ZSgiJXMgLSAlc1xuIiAlICh0aW1lLnN0cmZ0aW1lKCIlSDolTTolUyIpLCBmbXQgJSBhcmdzKSkKICAgICAgICBzeXMuc3Rkb3V0LmZsdXNoKCkKCiAgICAjIC0tIGhlbHBlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCiAgICBkZWYgY29yc19oZWFkZXJzKHNlbGYsIG9yaWdpbik6CiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luIiwgb3JpZ2luIG9yICIqIikKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJWYXJ5IiwgIk9yaWdpbiIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyIsICJHRVQsIFBPU1QsIE9QVElPTlMiKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMiLCAiQ29udGVudC1UeXBlIikKICAgICAgICAjIENocm9tZSdzIFByaXZhdGUgTmV0d29yayBBY2Nlc3MgcHJlZmxpZ2h0IGZvciBodHRwcyAtPiAxMjcuMC4wLjEuCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQWNjZXNzLUNvbnRyb2wtQWxsb3ctUHJpdmF0ZS1OZXR3b3JrIiwgInRydWUiKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLU1heC1BZ2UiLCAiNjAwIikKCiAgICBkZWYgcmVwbHkoc2VsZiwgc3RhdHVzLCBwYXlsb2FkKToKICAgICAgICBvcmlnaW4gPSBzZWxmLmhlYWRlcnMuZ2V0KCJPcmlnaW4iKQogICAgICAgIGJvZHkgPSBqc29uLmR1bXBzKHBheWxvYWQsIGVuc3VyZV9hc2NpaT1GYWxzZSkuZW5jb2RlKCJ1dGYtOCIpCiAgICAgICAgc2VsZi5zZW5kX3Jlc3BvbnNlKHN0YXR1cykKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LVR5cGUiLCAiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOCIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1MZW5ndGgiLCBzdHIobGVuKGJvZHkpKSkKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDYWNoZS1Db250cm9sIiwgIm5vLXN0b3JlIikKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJYLUNvbnRlbnQtVHlwZS1PcHRpb25zIiwgIm5vc25pZmYiKQogICAgICAgIHNlbGYuY29yc19oZWFkZXJzKG9yaWdpbikKICAgICAgICBzZWxmLmVuZF9oZWFkZXJzKCkKICAgICAgICBzZWxmLndmaWxlLndyaXRlKGJvZHkpCgogICAgZGVmIGd1YXJkX29yaWdpbihzZWxmKToKICAgICAgICBvcmlnaW4gPSBzZWxmLmhlYWRlcnMuZ2V0KCJPcmlnaW4iKQogICAgICAgIGlmIG9yaWdpbl9hbGxvd2VkKG9yaWdpbik6CiAgICAgICAgICAgIHJldHVybiBUcnVlCiAgICAgICAgc2VsZi5yZXBseSg0MDMsIHsib2siOiBGYWxzZSwgImVycm9yIjogIm9yaWdpbiDguYTguKHguYjguYTguJTguYnguKPguLHguJrguK3guJnguLjguI3guLLguJU6ICVzIiAlIG9yaWdpbn0pCiAgICAgICAgcmV0dXJuIEZhbHNlCgogICAgIyAtLSByb3V0ZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQogICAgZGVmIGRvX09QVElPTlMoc2VsZik6ICAjIG5vcWE6IE44MDIgLSBCYXNlSFRUUFJlcXVlc3RIYW5kbGVyIG5hbWluZwogICAgICAgIG9yaWdpbiA9IHNlbGYuaGVhZGVycy5nZXQoIk9yaWdpbiIpCiAgICAgICAgaWYgbm90IG9yaWdpbl9hbGxvd2VkKG9yaWdpbik6CiAgICAgICAgICAgIHNlbGYuc2VuZF9yZXNwb25zZSg0MDMpCiAgICAgICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNvbnRlbnQtTGVuZ3RoIiwgIjAiKQogICAgICAgICAgICBzZWxmLmVuZF9oZWFkZXJzKCkKICAgICAgICAgICAgcmV0dXJuCiAgICAgICAgc2VsZi5zZW5kX3Jlc3BvbnNlKDIwNCkKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LUxlbmd0aCIsICIwIikKICAgICAgICBzZWxmLmNvcnNfaGVhZGVycyhvcmlnaW4pCiAgICAgICAgc2VsZi5lbmRfaGVhZGVycygpCgogICAgZGVmIGRvX0dFVChzZWxmKTogICMgbm9xYTogTjgwMgogICAgICAgIGlmIHNlbGYucGF0aC5zcGxpdCgiPyIpWzBdIG5vdCBpbiAoIi9oZWFsdGgiLCAiLyIpOgogICAgICAgICAgICBzZWxmLnJlcGx5KDQwNCwgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiAibm90IGZvdW5kIn0pCiAgICAgICAgICAgIHJldHVybgogICAgICAgIGlmIG5vdCBzZWxmLmd1YXJkX29yaWdpbigpOgogICAgICAgICAgICByZXR1cm4KICAgICAgICBzdGF0dXMgPSBwaG90b3Nob3Bfc3RhdHVzKCkKICAgICAgICBzZWxmLnJlcGx5KDIwMCwgewogICAgICAgICAgICAib2siOiBUcnVlLAogICAgICAgICAgICAibmFtZSI6ICJkaWN1dC1wcy1icmlkZ2UiLAogICAgICAgICAgICAidmVyc2lvbiI6IFZFUlNJT04sCiAgICAgICAgICAgICJwbGF0Zm9ybSI6IHN5cy5wbGF0Zm9ybSwKICAgICAgICAgICAgIm9zIjogcGxhdGZvcm0ucGxhdGZvcm0oKSwKICAgICAgICAgICAgInBob3Rvc2hvcCI6IHN0YXR1c1sibmFtZSJdLAogICAgICAgICAgICAicGhvdG9zaG9wRm91bmQiOiBzdGF0dXNbImZvdW5kIl0sCiAgICAgICAgICAgICJidXN5IjogUEhPVE9TSE9QX0xPQ0subG9ja2VkKCksCiAgICAgICAgfSkKCiAgICBkZWYgZG9fUE9TVChzZWxmKTogICMgbm9xYTogTjgwMgogICAgICAgIGlmIHNlbGYucGF0aC5zcGxpdCgiPyIpWzBdICE9ICIvZGljdXQiOgogICAgICAgICAgICBzZWxmLnJlcGx5KDQwNCwgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiAibm90IGZvdW5kIn0pCiAgICAgICAgICAgIHJldHVybgogICAgICAgIGlmIG5vdCBzZWxmLmd1YXJkX29yaWdpbigpOgogICAgICAgICAgICByZXR1cm4KICAgICAgICB0cnk6CiAgICAgICAgICAgIGxlbmd0aCA9IGludChzZWxmLmhlYWRlcnMuZ2V0KCJDb250ZW50LUxlbmd0aCIpIG9yIDApCiAgICAgICAgZXhjZXB0IFZhbHVlRXJyb3I6CiAgICAgICAgICAgIGxlbmd0aCA9IDAKICAgICAgICBpZiBsZW5ndGggPD0gMDoKICAgICAgICAgICAgc2VsZi5yZXBseSg0MDAsIHsib2siOiBGYWxzZSwgImVycm9yIjogInJlcXVlc3Qg4Lin4LmI4Liy4LiHIn0pCiAgICAgICAgICAgIHJldHVybgogICAgICAgIGlmIGxlbmd0aCA+IE1BWF9CT0RZX0JZVEVTOgogICAgICAgICAgICBzZWxmLnJlcGx5KDQxMywgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiAi4Lij4Li54Lib4LmD4Lir4LiN4LmI4LmA4LiB4Li04LiZICVkIE1CIiAlIChNQVhfQk9EWV9CWVRFUyAvLyAxMDI0IC8vIDEwMjQpfSkKICAgICAgICAgICAgcmV0dXJuCiAgICAgICAgdHJ5OgogICAgICAgICAgICBib2R5ID0ganNvbi5sb2FkcyhzZWxmLnJmaWxlLnJlYWQobGVuZ3RoKS5kZWNvZGUoInV0Zi04IikpCiAgICAgICAgZXhjZXB0IChWYWx1ZUVycm9yLCBVbmljb2RlRGVjb2RlRXJyb3IpIGFzIGVycm9yOgogICAgICAgICAgICBzZWxmLnJlcGx5KDQwMCwgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiAi4Lit4LmI4Liy4LiZIEpTT04g4LmE4Lih4LmI4LmE4LiU4LmJOiAlcyIgJSBlcnJvcn0pCiAgICAgICAgICAgIHJldHVybgoKICAgICAgICBuYW1lID0gc3RyKGJvZHkuZ2V0KCJuYW1lIikgb3IgImltYWdlIikKICAgICAgICB0cmltID0gYm9keS5nZXQoInRyaW0iKSBpcyBub3QgRmFsc2UKICAgICAgICB0cnk6CiAgICAgICAgICAgIHBheWxvYWQsIG1pbWUgPSBkZWNvZGVfcmVxdWVzdF9pbWFnZShib2R5KQogICAgICAgICAgICByZXN1bHQgPSBkaWN1dF9ieXRlcyhwYXlsb2FkLCBtaW1lLCBzZWxmLnRpbWVvdXRfc2Vjb25kcywgc2VsZi5rZWVwX3dvcmssIHRyaW0pCiAgICAgICAgZXhjZXB0IERpY3V0RXJyb3IgYXMgZXJyb3I6CiAgICAgICAgICAgIHNlbGYubG9nX21lc3NhZ2UoImRpY3V0IEZBSUxFRCAlcyAtICVzIiwgbmFtZSwgZXJyb3IpCiAgICAgICAgICAgIHNlbGYucmVwbHkoNTAyLCB7Im9rIjogRmFsc2UsICJlcnJvciI6IHN0cihlcnJvcil9KQogICAgICAgICAgICByZXR1cm4KICAgICAgICBleGNlcHQgRXhjZXB0aW9uIGFzIGVycm9yOiAgIyBub3FhOiBCTEUwMDEgLSBzdXJmYWNlIHRoZSByZWFsIGNhdXNlCiAgICAgICAgICAgIHNlbGYubG9nX21lc3NhZ2UoImRpY3V0IEVSUk9SICVzIC0gJXMiLCBuYW1lLCBlcnJvcikKICAgICAgICAgICAgc2VsZi5yZXBseSg1MDAsIHsib2siOiBGYWxzZSwgImVycm9yIjogIiVzOiAlcyIgJSAodHlwZShlcnJvcikuX19uYW1lX18sIGVycm9yKX0pCiAgICAgICAgICAgIHJldHVybgoKICAgICAgICBzZWxmLmxvZ19tZXNzYWdlKCJkaWN1dCBvayAlcyAoJXMsICVzbXMpIiwgbmFtZSwgcmVzdWx0WyJtZXRob2QiXSwgcmVzdWx0WyJtcyJdKQogICAgICAgIHNlbGYucmVwbHkoMjAwLCB7CiAgICAgICAgICAgICJvayI6IFRydWUsCiAgICAgICAgICAgICJuYW1lIjogbmFtZSwKICAgICAgICAgICAgIm1ldGhvZCI6IHJlc3VsdFsibWV0aG9kIl0sCiAgICAgICAgICAgICJtcyI6IHJlc3VsdFsibXMiXSwKICAgICAgICAgICAgInBob3Rvc2hvcCI6IHJlc3VsdFsicGhvdG9zaG9wIl0sCiAgICAgICAgICAgICJ0cmltbWVkIjogdHJpbSwKICAgICAgICAgICAgImJ5dGVzIjogbGVuKHJlc3VsdFsicG5nIl0pLAogICAgICAgICAgICAiZGF0YVVybCI6ICJkYXRhOmltYWdlL3BuZztiYXNlNjQsIiArIGJhc2U2NC5iNjRlbmNvZGUocmVzdWx0WyJwbmciXSkuZGVjb2RlKCJhc2NpaSIpLAogICAgICAgIH0pCgoKZGVmIHNlbGZ0ZXN0KGltYWdlX3BhdGgsIHRpbWVvdXQsIGtlZXBfd29yayk6CiAgICBzb3VyY2UgPSBQYXRoKGltYWdlX3BhdGgpCiAgICBpZiBub3Qgc291cmNlLmlzX2ZpbGUoKToKICAgICAgICBwcmludCgi4LmE4Lih4LmI4Lie4Lia4LmE4Lif4Lil4LmMOiAlcyIgJSBzb3VyY2UpCiAgICAgICAgcmV0dXJuIDEKICAgIHN0YXR1cyA9IHBob3Rvc2hvcF9zdGF0dXMoKQogICAgcHJpbnQoInBsYXRmb3JtICA6ICVzIiAlIHN5cy5wbGF0Zm9ybSkKICAgIHByaW50KCJwaG90b3Nob3AgOiAlcyIgJSAoc3RhdHVzWyJuYW1lIl0gb3IgIk5PVCBGT1VORCIpKQogICAgaWYgbm90IHN0YXR1c1siZm91bmQiXToKICAgICAgICByZXR1cm4gMQogICAgbWltZSA9ICJpbWFnZS9wbmciIGlmIHNvdXJjZS5zdWZmaXgubG93ZXIoKSA9PSAiLnBuZyIgZWxzZSAiaW1hZ2UvanBlZyIKICAgIHRyeToKICAgICAgICByZXN1bHQgPSBkaWN1dF9ieXRlcyhzb3VyY2UucmVhZF9ieXRlcygpLCBtaW1lLCB0aW1lb3V0LCBrZWVwX3dvcmspCiAgICBleGNlcHQgRGljdXRFcnJvciBhcyBlcnJvcjoKICAgICAgICBwcmludCgiRkFJTEVEOiAlcyIgJSBlcnJvcikKICAgICAgICByZXR1cm4gMQogICAgb3V0ID0gc291cmNlLndpdGhfbmFtZShzb3VyY2Uuc3RlbSArICJfZGljdXQucG5nIikKICAgIG91dC53cml0ZV9ieXRlcyhyZXN1bHRbInBuZyJdKQogICAgcHJpbnQoIk9LICglcywgJXNtcykgLT4gJXMiICUgKHJlc3VsdFsibWV0aG9kIl0sIHJlc3VsdFsibXMiXSwgb3V0KSkKICAgIHJldHVybiAwCgoKZGVmIG1haW4oKToKICAgIHBhcnNlciA9IGFyZ3BhcnNlLkFyZ3VtZW50UGFyc2VyKGRlc2NyaXB0aW9uPSJEaWN1dCBQUyBCcmlkZ2UiKQogICAgcGFyc2VyLmFkZF9hcmd1bWVudCgiLS1ob3N0IiwgZGVmYXVsdD1ERUZBVUxUX0hPU1QpCiAgICBwYXJzZXIuYWRkX2FyZ3VtZW50KCItLXBvcnQiLCB0eXBlPWludCwgZGVmYXVsdD1pbnQob3MuZW52aXJvbi5nZXQoIkRJQ1VUX0JSSURHRV9QT1JUIiwgREVGQVVMVF9QT1JUKSkpCiAgICBwYXJzZXIuYWRkX2FyZ3VtZW50KCItLXRpbWVvdXQiLCB0eXBlPWludCwgZGVmYXVsdD1ERUZBVUxUX1RJTUVPVVQpCiAgICBwYXJzZXIuYWRkX2FyZ3VtZW50KCItLWtlZXAtd29yayIsIGFjdGlvbj0ic3RvcmVfdHJ1ZSIsIGhlbHA9ImtlZXAgdGhlIHRlbXAgZm9sZGVyIGZvciBkZWJ1Z2dpbmciKQogICAgcGFyc2VyLmFkZF9hcmd1bWVudCgiLS1zZWxmdGVzdCIsIG1ldGF2YXI9IklNQUdFIiwgaGVscD0iY3V0IG9uZSBmaWxlIGFuZCBleGl0IikKICAgIGFyZ3MgPSBwYXJzZXIucGFyc2VfYXJncygpCgogICAgbG9hZF9leHRyYV9vcmlnaW5zKCkKICAgIGlmIGFyZ3Muc2VsZnRlc3Q6CiAgICAgICAgcmFpc2UgU3lzdGVtRXhpdChzZWxmdGVzdChhcmdzLnNlbGZ0ZXN0LCBhcmdzLnRpbWVvdXQsIGFyZ3Mua2VlcF93b3JrKSkKCiAgICBCcmlkZ2VIYW5kbGVyLnRpbWVvdXRfc2Vjb25kcyA9IGFyZ3MudGltZW91dAogICAgQnJpZGdlSGFuZGxlci5rZWVwX3dvcmsgPSBhcmdzLmtlZXBfd29yawogICAgc2VydmVyID0gVGhyZWFkaW5nSFRUUFNlcnZlcigoYXJncy5ob3N0LCBhcmdzLnBvcnQpLCBCcmlkZ2VIYW5kbGVyKQogICAgc3RhdHVzID0gcGhvdG9zaG9wX3N0YXR1cygpCiAgICBwcmludCgiRGljdXQgUFMgQnJpZGdlICVzIiAlIFZFUlNJT04pCiAgICBwcmludCgibGlzdGVuaW5nIDogaHR0cDovLyVzOiVkIiAlIChhcmdzLmhvc3QsIGFyZ3MucG9ydCkpCiAgICBwcmludCgicGhvdG9zaG9wIDogJXMiICUgKHN0YXR1c1sibmFtZSJdIG9yICJOT1QgRk9VTkQgLSDguJXguLTguJTguJXguLHguYnguIcgUGhvdG9zaG9wIDIwMjIrIOC4geC5iOC4reC4mSIpKQogICAgcHJpbnQoInN0b3AgICAgICA6IEN0cmwrQyIpCiAgICBzeXMuc3Rkb3V0LmZsdXNoKCkKICAgIHRyeToKICAgICAgICBzZXJ2ZXIuc2VydmVfZm9yZXZlcigpCiAgICBleGNlcHQgS2V5Ym9hcmRJbnRlcnJ1cHQ6CiAgICAgICAgcHJpbnQoIlxuc3RvcHBlZCIpCiAgICBmaW5hbGx5OgogICAgICAgIHNlcnZlci5zZXJ2ZXJfY2xvc2UoKQoKCmlmIF9fbmFtZV9fID09ICJfX21haW5fXyI6CiAgICBtYWluKCkK';
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
        return {
          available: true,
          photoshopFound: !!data.photoshopFound,
          photoshop: data.photoshop || '',
          version: data.version || '',
          platform: data.platform || '',
          busy: !!data.busy,
          error: data.photoshopFound ? '' : 'ไม่พบ Adobe Photoshop บนเครื่องนี้ (ต้องเป็น 2022 ขึ้นไป)'
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
      'set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup"',
      'echo @echo off>"%STARTUP%\\DicutPSBridge.cmd"',
      'echo start "" "%PY%" "%DIR%\\dicut_bridge.py">>"%STARTUP%\\DicutPSBridge.cmd"',
      'start "" "%PY%" "%DIR%\\dicut_bridge.py"',
      'echo.',
      'echo Dicut PS Bridge installed and started.',
      'echo It will start again automatically every time you log in.',
      'echo Go back to the browser and press the recheck button.',
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
        if (state.available && state.photoshopFound) {
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

  function showHelp(message, trigger) {
    buildHelp();
    helpReturnFocus = trigger || document.activeElement;
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
      if (state.available && state.photoshopFound) return true;
      showHelp(state.error, trigger);
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
