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

  var VERSION = '1.0.0';
  var ENDPOINT = 'http://127.0.0.1:8799';
  var PROBE_TIMEOUT_MS = 2500;
  var CUT_TIMEOUT_MS = 240000;   // Photoshop's first launch can take minutes
  var PROBE_TTL_OK_MS = 15000;
  var PROBE_TTL_FAIL_MS = 3000;

  /* BRIDGE_SOURCE_B64_START */
  var BRIDGE_SOURCE_B64 = 'IyEvdXNyL2Jpbi9lbnYgcHl0aG9uMwojIC0qLSBjb2Rpbmc6IHV0Zi04IC0qLQoiIiJEaWN1dCBQUyBCcmlkZ2UgLSBsb2NhbCBIVFRQIHNlcnZpY2UgdGhhdCBydW5zIFBob3Rvc2hvcCAiUmVtb3ZlIEJhY2tncm91bmQiLgoKVGhlIENlbnRyYWwgQ3JlYXRpdmUgVG9vbHMgd2ViIGFwcHMgY2Fubm90IHRhbGsgdG8gYSBsb2NhbGx5IGluc3RhbGxlZApQaG90b3Nob3AsIHNvIHRoZXkgUE9TVCBhbiBpbWFnZSBoZXJlIGFuZCBnZXQgYSB0cmFuc3BhcmVudCBQTkcgYmFjay4KVGhlIHNhbWUgc2VydmljZSBydW5zIG9uIFdpbmRvd3MgKENPTSkgYW5kIG1hY09TIChBcHBsZSBldmVudHMpLCB3aGljaCBpcyB3aGF0CmxldHMgb25lIGJ1dHRvbiB3b3JrIG9uIGJvdGggcGxhdGZvcm1zLgoKUnVuOiAgICAgICAgcHl0aG9uIGRpY3V0X2JyaWRnZS5weQpPcHRpb25zOiAgICAtLXBvcnQgODc5OSAgLS1ob3N0IDEyNy4wLjAuMSAgLS10aW1lb3V0IDE4MCAgLS1rZWVwLXdvcmsKSGVhbHRoOiAgICAgY3VybCBodHRwOi8vMTI3LjAuMC4xOjg3OTkvaGVhbHRoClNlbGYgdGVzdDogIHB5dGhvbiBkaWN1dF9icmlkZ2UucHkgLS1zZWxmdGVzdCBwYXRoL3RvL2ltYWdlLmpwZwoKT25seSB0aGUgbG9vcGJhY2sgaW50ZXJmYWNlIGlzIGJvdW5kIGFuZCBvbmx5IGFsbG93LWxpc3RlZCBicm93c2VyIG9yaWdpbnMgYXJlCmFjY2VwdGVkLCBzbyBhIHJhbmRvbSB3ZWIgcGFnZSBjYW5ub3QgZHJpdmUgdGhlIGxvY2FsIFBob3Rvc2hvcC4KIiIiCgppbXBvcnQgYXJncGFyc2UKaW1wb3J0IGJhc2U2NAppbXBvcnQganNvbgppbXBvcnQgb3MKaW1wb3J0IHBsYXRmb3JtCmltcG9ydCByZQppbXBvcnQgc2h1dGlsCmltcG9ydCBzdWJwcm9jZXNzCmltcG9ydCBzeXMKaW1wb3J0IHRlbXBmaWxlCmltcG9ydCB0aHJlYWRpbmcKaW1wb3J0IHRpbWUKaW1wb3J0IHV1aWQKZnJvbSBodHRwLnNlcnZlciBpbXBvcnQgQmFzZUhUVFBSZXF1ZXN0SGFuZGxlciwgVGhyZWFkaW5nSFRUUFNlcnZlcgpmcm9tIHBhdGhsaWIgaW1wb3J0IFBhdGgKClZFUlNJT04gPSAiMS4wLjAiCkRFRkFVTFRfUE9SVCA9IDg3OTkKREVGQVVMVF9IT1NUID0gIjEyNy4wLjAuMSIKREVGQVVMVF9USU1FT1VUID0gMTgwCk1BWF9CT0RZX0JZVEVTID0gNDggKiAxMDI0ICogMTAyNAoKSVNfV0lORE9XUyA9IHN5cy5wbGF0Zm9ybS5zdGFydHN3aXRoKCJ3aW4iKQpJU19NQUMgPSBzeXMucGxhdGZvcm0gPT0gImRhcndpbiIKCiMgUHJvZHVjdGlvbiBvcmlnaW5zIG9mIHRoZSBmb3VyIHRvb2xzIHRoYXQgb3duIGEgRGljdXQgUFMgYnV0dG9uLiBQcmV2aWV3CiMgZGVwbG95bWVudHMgbGl2ZSBvbiBzdWJkb21haW5zIG9mIHRoZSBzYW1lIFBhZ2VzIHByb2plY3RzLCBzbyB0aG9zZSBhcmUKIyBtYXRjaGVkIGJ5IHN1ZmZpeC4gRXh0cmEgb3JpZ2lucyBjYW4gYmUgYWRkZWQgd2l0aCBESUNVVF9CUklER0VfT1JJR0lOUy4KQUxMT1dFRF9PUklHSU5TID0gewogICAgImh0dHBzOi8vY2VudHJhbC1pbWFnZS1kb3dubG9hZGVyLnBhZ2VzLmRldiIsCiAgICAiaHR0cHM6Ly9jZW50cmFsLXN0cmlwLWJhbm5lci5wYWdlcy5kZXYiLAogICAgImh0dHBzOi8vY2VudHJhbC1vdmVybGF5LWdlbmVyYXRvci5wYWdlcy5kZXYiLAogICAgImh0dHBzOi8vY2VudHJhbC1maXJzdC1pbWFnZS5jaGFpcml0LWJpcmQud29ya2Vycy5kZXYiLAp9CkFMTE9XRURfT1JJR0lOX1NVRkZJWEVTID0gKAogICAgIi5jZW50cmFsLWltYWdlLWRvd25sb2FkZXIucGFnZXMuZGV2IiwKICAgICIuY2VudHJhbC1zdHJpcC1iYW5uZXIucGFnZXMuZGV2IiwKICAgICIuY2VudHJhbC1vdmVybGF5LWdlbmVyYXRvci5wYWdlcy5kZXYiLAopCkxPQ0FMX09SSUdJTl9SRSA9IHJlLmNvbXBpbGUociJeaHR0cHM/Oi8vKGxvY2FsaG9zdHwxMjdcLjBcLjBcLjF8XFs6OjFcXSkoOlxkKyk/JCIpCgpFWFRFTlNJT05fQllfTUlNRSA9IHsKICAgICJpbWFnZS9wbmciOiAiLnBuZyIsCiAgICAiaW1hZ2UvanBlZyI6ICIuanBnIiwKICAgICJpbWFnZS9qcGciOiAiLmpwZyIsCiAgICAiaW1hZ2Uvd2VicCI6ICIud2VicCIsCiAgICAiaW1hZ2UvdGlmZiI6ICIudGlmIiwKICAgICJpbWFnZS9ibXAiOiAiLmJtcCIsCn0KCkRBVEFfVVJMX1JFID0gcmUuY29tcGlsZShyIl5kYXRhOig/UDxtaW1lPltcdy4rLV0rL1tcdy4rLV0rKT87YmFzZTY0LCg/UDxwYXlsb2FkPi4rKSQiLCByZS5TKQoKIyBQaG90b3Nob3AgaXMgc2luZ2xlLWluc3RhbmNlOiB0d28gb3ZlcmxhcHBpbmcgRG9KYXZhU2NyaXB0IGNhbGxzIGZpZ2h0IG92ZXIKIyB0aGUgc2FtZSBhcHBsaWNhdGlvbiwgc28gZXZlcnkgY3V0IGlzIHNlcmlhbGlzZWQuClBIT1RPU0hPUF9MT0NLID0gdGhyZWFkaW5nLkxvY2soKQoKSlNYX1RFTVBMQVRFID0gIiIiYXBwLmRpc3BsYXlEaWFsb2dzID0gRGlhbG9nTW9kZXMuTk87CnZhciBfc3JjID0gbmV3IEZpbGUoIiUoc3JjKXMiKTsKdmFyIF9vdXQgPSBuZXcgRmlsZSgiJShvdXQpcyIpOwp2YXIgZG9jID0gYXBwLm9wZW4oX3NyYyk7CnRyeSB7CiAgICBpZiAoZG9jLmxheWVyc1swXS5pc0JhY2tncm91bmRMYXllcikgZG9jLmxheWVyc1swXS5pc0JhY2tncm91bmRMYXllciA9IGZhbHNlOwogICAgZXhlY3V0ZUFjdGlvbihzdHJpbmdJRFRvVHlwZUlEKCdyZW1vdmVCYWNrZ3JvdW5kJyksIHVuZGVmaW5lZCwgRGlhbG9nTW9kZXMuTk8pOwogICAgZG9jLnRyaW0oVHJpbVR5cGUuVFJBTlNQQVJFTlQpOwogICAgZG9jLnNhdmVBcyhfb3V0LCBuZXcgUE5HU2F2ZU9wdGlvbnMoKSwgdHJ1ZSwgRXh0ZW5zaW9uLkxPV0VSQ0FTRSk7Cn0gZmluYWxseSB7CiAgICBkb2MuY2xvc2UoU2F2ZU9wdGlvbnMuRE9OT1RTQVZFQ0hBTkdFUyk7Cn0KIiIiCgoKY2xhc3MgRGljdXRFcnJvcihSdW50aW1lRXJyb3IpOgogICAgIiIiQSBmYWlsdXJlIHRoZSBicm93c2VyIGlzIGV4cGVjdGVkIHRvIHNob3cgdG8gdGhlIHVzZXIgYXMtaXMuIiIiCgoKZGVmIGpzeF9wYXRoKHZhbHVlKToKICAgICIiIkVzY2FwZSBhIGZpbGVzeXN0ZW0gcGF0aCBmb3IgZW1iZWRkaW5nIGluIGEgSlNYIHN0cmluZyBsaXRlcmFsLiIiIgogICAgcmV0dXJuIHN0cih2YWx1ZSkucmVwbGFjZSgiXFwiLCAiXFxcXCIpLnJlcGxhY2UoJyInLCAnXFwiJykKCgpkZWYgb3JpZ2luX2FsbG93ZWQob3JpZ2luKToKICAgIGlmIG5vdCBvcmlnaW46CiAgICAgICAgcmV0dXJuIFRydWUgICMgY3VybCAvIHNlbGYgdGVzdDogbm8gYnJvd3NlciBvcmlnaW4gdG8gY2hlY2sKICAgIGlmIG9yaWdpbiBpbiBBTExPV0VEX09SSUdJTlMgb3IgTE9DQUxfT1JJR0lOX1JFLm1hdGNoKG9yaWdpbik6CiAgICAgICAgcmV0dXJuIFRydWUKICAgIHJldHVybiBhbnkob3JpZ2luLmVuZHN3aXRoKHN1ZmZpeCkgZm9yIHN1ZmZpeCBpbiBBTExPV0VEX09SSUdJTl9TVUZGSVhFUykKCgpkZWYgbG9hZF9leHRyYV9vcmlnaW5zKCk6CiAgICByYXcgPSBvcy5lbnZpcm9uLmdldCgiRElDVVRfQlJJREdFX09SSUdJTlMiLCAiIikKICAgIGZvciBpdGVtIGluIHJhdy5yZXBsYWNlKCIsIiwgIiAiKS5zcGxpdCgpOgogICAgICAgIEFMTE9XRURfT1JJR0lOUy5hZGQoaXRlbS5yc3RyaXAoIi8iKSkKCgojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCiMgUGhvdG9zaG9wIGRpc2NvdmVyeQojIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tCgpkZWYgZmluZF9waG90b3Nob3BfbWFjKCk6CiAgICBjYW5kaWRhdGVzID0gW10KICAgIGFwcHMgPSBQYXRoKCIvQXBwbGljYXRpb25zIikKICAgIGlmIGFwcHMuaXNfZGlyKCk6CiAgICAgICAgZm9yIGVudHJ5IGluIHNvcnRlZChhcHBzLmdsb2IoIkFkb2JlIFBob3Rvc2hvcCoiKSk6CiAgICAgICAgICAgIGlmIGVudHJ5LnN1ZmZpeCA9PSAiLmFwcCI6CiAgICAgICAgICAgICAgICBjYW5kaWRhdGVzLmFwcGVuZChlbnRyeSkKICAgICAgICAgICAgZWxpZiBlbnRyeS5pc19kaXIoKToKICAgICAgICAgICAgICAgIGNhbmRpZGF0ZXMuZXh0ZW5kKHNvcnRlZChlbnRyeS5nbG9iKCJBZG9iZSBQaG90b3Nob3AqLmFwcCIpKSkKICAgIHJldHVybiBjYW5kaWRhdGVzWy0xXSBpZiBjYW5kaWRhdGVzIGVsc2UgTm9uZQoKCmRlZiBmaW5kX3Bob3Rvc2hvcF93aW5kb3dzKCk6CiAgICAiIiJSZXR1cm4gdGhlIHJlZ2lzdGVyZWQgUGhvdG9zaG9wIGFwcGxpY2F0aW9uIG5hbWUsIG9yIE5vbmUuIiIiCiAgICB0cnk6CiAgICAgICAgaW1wb3J0IHdpbnJlZwogICAgZXhjZXB0IEltcG9ydEVycm9yOiAgIyBwcmFnbWE6IG5vIGNvdmVyIC0gV2luZG93cyBvbmx5CiAgICAgICAgcmV0dXJuIE5vbmUKICAgIGZvciByb290IGluICh3aW5yZWcuSEtFWV9DTEFTU0VTX1JPT1QsKToKICAgICAgICB0cnk6CiAgICAgICAgICAgIHdpdGggd2lucmVnLk9wZW5LZXkocm9vdCwgciJQaG90b3Nob3AuQXBwbGljYXRpb25cQ3VyVmVyIikgYXMga2V5OgogICAgICAgICAgICAgICAgdmVyc2lvbiA9IHdpbnJlZy5RdWVyeVZhbHVlRXgoa2V5LCAiIilbMF0KICAgICAgICAgICAgICAgIHJldHVybiBzdHIodmVyc2lvbikKICAgICAgICBleGNlcHQgT1NFcnJvcjoKICAgICAgICAgICAgY29udGludWUKICAgIHRyeToKICAgICAgICB3aXRoIHdpbnJlZy5PcGVuS2V5KHdpbnJlZy5IS0VZX0NMQVNTRVNfUk9PVCwgIlBob3Rvc2hvcC5BcHBsaWNhdGlvbiIpOgogICAgICAgICAgICByZXR1cm4gIlBob3Rvc2hvcC5BcHBsaWNhdGlvbiIKICAgIGV4Y2VwdCBPU0Vycm9yOgogICAgICAgIHJldHVybiBOb25lCgoKZGVmIHBob3Rvc2hvcF9zdGF0dXMoKToKICAgIGlmIElTX01BQzoKICAgICAgICBhcHAgPSBmaW5kX3Bob3Rvc2hvcF9tYWMoKQogICAgICAgIHJldHVybiB7ImZvdW5kIjogYm9vbChhcHApLCAibmFtZSI6IGFwcC5zdGVtIGlmIGFwcCBlbHNlICIiLCAicGF0aCI6IHN0cihhcHApIGlmIGFwcCBlbHNlICIifQogICAgaWYgSVNfV0lORE9XUzoKICAgICAgICBuYW1lID0gZmluZF9waG90b3Nob3Bfd2luZG93cygpCiAgICAgICAgcmV0dXJuIHsiZm91bmQiOiBib29sKG5hbWUpLCAibmFtZSI6IG5hbWUgb3IgIiIsICJwYXRoIjogIiJ9CiAgICByZXR1cm4geyJmb3VuZCI6IEZhbHNlLCAibmFtZSI6ICIiLCAicGF0aCI6ICIifQoKCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KIyBQaG90b3Nob3AgZXhlY3V0aW9uCiMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KCmRlZiBydW5fcGhvdG9zaG9wX3dpbmRvd3Moc2NyaXB0LCBvdXRfZmlsZSwgdGltZW91dCk6CiAgICAiIiJEcml2ZSBQaG90b3Nob3AgdGhyb3VnaCBDT006IHB5d2luMzIgd2hlbiBwcmVzZW50LCBQb3dlclNoZWxsIG90aGVyd2lzZS4iIiIKICAgIGVycm9ycyA9IFtdCiAgICB0cnk6CiAgICAgICAgaW1wb3J0IHdpbjMyY29tLmNsaWVudCAgIyB0eXBlOiBpZ25vcmUKCiAgICAgICAgYXBwID0gd2luMzJjb20uY2xpZW50LkRpc3BhdGNoKCJQaG90b3Nob3AuQXBwbGljYXRpb24iKQogICAgICAgICMgRG9KYXZhU2NyaXB0IHdpdGggdGhlIHNvdXJjZSB0ZXh0IGlzIHRoZSBjYWxsIHBhdGggYWxyZWFkeSBwcm92ZW4gYnkKICAgICAgICAjIHRvb2xzL2RpY3V0LnB5OyB0aGUgcGF0aHMgYXJlIGJha2VkIGludG8gdGhlIHNjcmlwdCBzbyBubyBhcmd1bWVudHMKICAgICAgICAjIGhhdmUgdG8gc3Vydml2ZSB0aGUgQ09NIGJvdW5kYXJ5LgogICAgICAgIGFwcC5Eb0phdmFTY3JpcHQoc2NyaXB0LnJlYWRfdGV4dChlbmNvZGluZz0idXRmLTgiKSkKICAgICAgICBpZiBvdXRfZmlsZS5leGlzdHMoKToKICAgICAgICAgICAgcmV0dXJuICJjb20iCiAgICAgICAgZXJyb3JzLmFwcGVuZCgicHl3aW4zMiByYW4gdGhlIHNjcmlwdCBidXQgcHJvZHVjZWQgbm8gb3V0cHV0IGZpbGUiKQogICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlcnJvcjogICMgbm9xYTogQkxFMDAxIC0gcmVwb3J0ZWQgdG8gdGhlIHVzZXIgdmVyYmF0aW0KICAgICAgICBlcnJvcnMuYXBwZW5kKCJweXdpbjMyOiAlcyIgJSBlcnJvcikKCiAgICBwb3dlcnNoZWxsID0gc2h1dGlsLndoaWNoKCJwb3dlcnNoZWxsIikgb3Igc2h1dGlsLndoaWNoKCJwd3NoIikKICAgIGlmIHBvd2Vyc2hlbGw6CiAgICAgICAgY29tbWFuZCA9ICgKICAgICAgICAgICAgIiRFcnJvckFjdGlvblByZWZlcmVuY2U9J1N0b3AnOyIKICAgICAgICAgICAgIiRhcHAgPSBOZXctT2JqZWN0IC1Db21PYmplY3QgUGhvdG9zaG9wLkFwcGxpY2F0aW9uOyIKICAgICAgICAgICAgIiRhcHAuRG9KYXZhU2NyaXB0RmlsZSgnJXMnKSIgJSBzdHIoc2NyaXB0KS5yZXBsYWNlKCInIiwgIicnIikKICAgICAgICApCiAgICAgICAgdHJ5OgogICAgICAgICAgICBkb25lID0gc3VicHJvY2Vzcy5ydW4oCiAgICAgICAgICAgICAgICBbcG93ZXJzaGVsbCwgIi1Ob1Byb2ZpbGUiLCAiLU5vbkludGVyYWN0aXZlIiwgIi1Db21tYW5kIiwgY29tbWFuZF0sCiAgICAgICAgICAgICAgICBjYXB0dXJlX291dHB1dD1UcnVlLCB0ZXh0PVRydWUsIHRpbWVvdXQ9dGltZW91dCwKICAgICAgICAgICAgKQogICAgICAgICAgICBpZiBvdXRfZmlsZS5leGlzdHMoKToKICAgICAgICAgICAgICAgIHJldHVybiAicG93ZXJzaGVsbCIKICAgICAgICAgICAgZXJyb3JzLmFwcGVuZCgicG93ZXJzaGVsbDogJXMiICUgKGRvbmUuc3RkZXJyIG9yIGRvbmUuc3Rkb3V0IG9yICJubyBvdXRwdXQgZmlsZSIpLnN0cmlwKCkpCiAgICAgICAgZXhjZXB0IHN1YnByb2Nlc3MuVGltZW91dEV4cGlyZWQ6CiAgICAgICAgICAgIGVycm9ycy5hcHBlbmQoInBvd2Vyc2hlbGw6IHRpbWVvdXQgYWZ0ZXIgJXNzIiAlIHRpbWVvdXQpCiAgICAgICAgZXhjZXB0IE9TRXJyb3IgYXMgZXJyb3I6CiAgICAgICAgICAgIGVycm9ycy5hcHBlbmQoInBvd2Vyc2hlbGw6ICVzIiAlIGVycm9yKQogICAgZWxzZToKICAgICAgICBlcnJvcnMuYXBwZW5kKCJwb3dlcnNoZWxsIG5vdCBmb3VuZCBvbiBQQVRIIikKCiAgICByYWlzZSBEaWN1dEVycm9yKCJQaG90b3Nob3Ag4LmE4Lih4LmI4LiV4Lit4Lia4Liq4LiZ4Lit4LiHIOKAlCAiICsgIiB8ICIuam9pbihlcnJvcnMpKQoKCmRlZiBydW5fcGhvdG9zaG9wX21hYyhzY3JpcHQsIG91dF9maWxlLCB0aW1lb3V0LCBhcHBfcGF0aCk6CiAgICBpZiBub3QgYXBwX3BhdGg6CiAgICAgICAgcmFpc2UgRGljdXRFcnJvcigi4LmE4Lih4LmI4Lie4LiaIEFkb2JlIFBob3Rvc2hvcCDguYPguJkgL0FwcGxpY2F0aW9ucyIpCiAgICBuYW1lID0gYXBwX3BhdGguc3RlbQogICAgZXJyb3JzID0gW10KICAgIHRyeToKICAgICAgICBkb25lID0gc3VicHJvY2Vzcy5ydW4oCiAgICAgICAgICAgIFsKICAgICAgICAgICAgICAgICJvc2FzY3JpcHQiLAogICAgICAgICAgICAgICAgIi1lIiwgJ3RlbGwgYXBwbGljYXRpb24gIiVzIiB0byBhY3RpdmF0ZScgJSBuYW1lLAogICAgICAgICAgICAgICAgIi1lIiwgJ3RlbGwgYXBwbGljYXRpb24gIiVzIiB0byBkbyBqYXZhc2NyaXB0IChQT1NJWCBmaWxlICIlcyIpJyAlIChuYW1lLCBzY3JpcHQpLAogICAgICAgICAgICBdLAogICAgICAgICAgICBjYXB0dXJlX291dHB1dD1UcnVlLCB0ZXh0PVRydWUsIHRpbWVvdXQ9dGltZW91dCwKICAgICAgICApCiAgICAgICAgaWYgb3V0X2ZpbGUuZXhpc3RzKCk6CiAgICAgICAgICAgIHJldHVybiAiYXBwbGUtZXZlbnRzIgogICAgICAgIGVycm9ycy5hcHBlbmQoIm9zYXNjcmlwdDogJXMiICUgKGRvbmUuc3RkZXJyIG9yIGRvbmUuc3Rkb3V0IG9yICJubyBvdXRwdXQgZmlsZSIpLnN0cmlwKCkpCiAgICBleGNlcHQgc3VicHJvY2Vzcy5UaW1lb3V0RXhwaXJlZDoKICAgICAgICBlcnJvcnMuYXBwZW5kKCJvc2FzY3JpcHQ6IHRpbWVvdXQgYWZ0ZXIgJXNzIiAlIHRpbWVvdXQpCiAgICBleGNlcHQgT1NFcnJvciBhcyBlcnJvcjoKICAgICAgICBlcnJvcnMuYXBwZW5kKCJvc2FzY3JpcHQ6ICVzIiAlIGVycm9yKQoKICAgICMgRmFsbGJhY2s6IGhhbmQgdGhlIC5qc3ggdG8gUGhvdG9zaG9wLiBOZWVkcyBubyBBdXRvbWF0aW9uIHBlcm1pc3Npb24gYnV0CiAgICAjIGlzIGFzeW5jaHJvbm91cywgc28gdGhlIG91dHB1dCBmaWxlIGhhcyB0byBiZSBwb2xsZWQgZm9yLgogICAgdHJ5OgogICAgICAgIHN1YnByb2Nlc3MucnVuKFsib3BlbiIsICItYSIsIHN0cihhcHBfcGF0aCksIHN0cihzY3JpcHQpXSwgY2FwdHVyZV9vdXRwdXQ9VHJ1ZSwgdGV4dD1UcnVlLCB0aW1lb3V0PTMwKQogICAgZXhjZXB0IChzdWJwcm9jZXNzLlRpbWVvdXRFeHBpcmVkLCBPU0Vycm9yKSBhcyBlcnJvcjoKICAgICAgICBlcnJvcnMuYXBwZW5kKCJvcGVuIC1hOiAlcyIgJSBlcnJvcikKICAgIGRlYWRsaW5lID0gdGltZS50aW1lKCkgKyB0aW1lb3V0CiAgICB3aGlsZSB0aW1lLnRpbWUoKSA8IGRlYWRsaW5lOgogICAgICAgIGlmIG91dF9maWxlLmV4aXN0cygpOgogICAgICAgICAgICByZXR1cm4gIm9wZW4tYSIKICAgICAgICB0aW1lLnNsZWVwKDAuNSkKICAgIGVycm9ycy5hcHBlbmQoIm9wZW4gLWE6IHRpbWVvdXQgYWZ0ZXIgJXNzIiAlIHRpbWVvdXQpCgogICAgcmFpc2UgRGljdXRFcnJvcigKICAgICAgICAiUGhvdG9zaG9wIOC5hOC4oeC5iOC4leC4reC4muC4quC4meC4reC4hyDigJQgIiArICIgfCAiLmpvaW4oZXJyb3JzKQogICAgICAgICsgIiB8IOC4luC5ieC4suC4guC4tuC5ieC4mSBOb3QgYXV0aG9yaXplZCDguYPguKvguYnguYDguJvguLTguJQgU3lzdGVtIFNldHRpbmdzID4gUHJpdmFjeSAmIFNlY3VyaXR5ID4gQXV0b21hdGlvbiIKICAgICkKCgpkZWYgZGljdXRfYnl0ZXMocGF5bG9hZCwgbWltZSwgdGltZW91dCwga2VlcF93b3JrKToKICAgICIiIlJlbW92ZSB0aGUgYmFja2dyb3VuZCBmcm9tIGltYWdlIGJ5dGVzIGFuZCByZXR1cm4gdHJhbnNwYXJlbnQgUE5HIGJ5dGVzLiIiIgogICAgc3RhdHVzID0gcGhvdG9zaG9wX3N0YXR1cygpCiAgICBpZiBub3Qgc3RhdHVzWyJmb3VuZCJdOgogICAgICAgIHJhaXNlIERpY3V0RXJyb3IoIuC5hOC4oeC5iOC4nuC4miBBZG9iZSBQaG90b3Nob3Ag4Lia4LiZ4LmA4LiE4Lij4Li34LmI4Lit4LiH4LiZ4Li14LmJICjguJXguYnguK3guIfguYDguJvguYfguJkgMjAyMiDguILguLbguYnguJnguYTguJspIikKCiAgICBzdWZmaXggPSBFWFRFTlNJT05fQllfTUlNRS5nZXQoKG1pbWUgb3IgIiIpLmxvd2VyKCksICIucG5nIikKICAgIHdvcmsgPSBQYXRoKHRlbXBmaWxlLmdldHRlbXBkaXIoKSkgLyAiZGljdXQtYnJpZGdlIiAvIHV1aWQudXVpZDQoKS5oZXgKICAgIHdvcmsubWtkaXIocGFyZW50cz1UcnVlLCBleGlzdF9vaz1UcnVlKQogICAgc3JjID0gd29yayAvICgic291cmNlIiArIHN1ZmZpeCkKICAgIG91dCA9IHdvcmsgLyAic291cmNlX2RpY3V0LnBuZyIKICAgIHNjcmlwdCA9IHdvcmsgLyAicnVuLmpzeCIKICAgIHNyYy53cml0ZV9ieXRlcyhwYXlsb2FkKQogICAgc2NyaXB0LndyaXRlX3RleHQoSlNYX1RFTVBMQVRFICUgeyJzcmMiOiBqc3hfcGF0aChzcmMpLCAib3V0IjoganN4X3BhdGgob3V0KX0sIGVuY29kaW5nPSJ1dGYtOCIpCgogICAgc3RhcnRlZCA9IHRpbWUudGltZSgpCiAgICB0cnk6CiAgICAgICAgd2l0aCBQSE9UT1NIT1BfTE9DSzoKICAgICAgICAgICAgaWYgSVNfV0lORE9XUzoKICAgICAgICAgICAgICAgIG1ldGhvZCA9IHJ1bl9waG90b3Nob3Bfd2luZG93cyhzY3JpcHQsIG91dCwgdGltZW91dCkKICAgICAgICAgICAgZWxpZiBJU19NQUM6CiAgICAgICAgICAgICAgICBtZXRob2QgPSBydW5fcGhvdG9zaG9wX21hYyhzY3JpcHQsIG91dCwgdGltZW91dCwgZmluZF9waG90b3Nob3BfbWFjKCkpCiAgICAgICAgICAgIGVsc2U6CiAgICAgICAgICAgICAgICByYWlzZSBEaWN1dEVycm9yKCLguKPguK3guIfguKPguLHguJrguYDguInguJ7guLLguLAgV2luZG93cyDguYHguKXguLAgbWFjT1MiKQogICAgICAgIHJlc3VsdCA9IG91dC5yZWFkX2J5dGVzKCkKICAgICAgICBpZiBub3QgcmVzdWx0OgogICAgICAgICAgICByYWlzZSBEaWN1dEVycm9yKCJQaG90b3Nob3Ag4LiE4Li34LiZ4LmE4Lif4Lil4LmM4Lin4LmI4Liy4LiHIikKICAgICAgICByZXR1cm4gewogICAgICAgICAgICAicG5nIjogcmVzdWx0LAogICAgICAgICAgICAibWV0aG9kIjogbWV0aG9kLAogICAgICAgICAgICAibXMiOiBpbnQoKHRpbWUudGltZSgpIC0gc3RhcnRlZCkgKiAxMDAwKSwKICAgICAgICAgICAgInBob3Rvc2hvcCI6IHN0YXR1c1sibmFtZSJdLAogICAgICAgIH0KICAgIGZpbmFsbHk6CiAgICAgICAgaWYgbm90IGtlZXBfd29yazoKICAgICAgICAgICAgc2h1dGlsLnJtdHJlZSh3b3JrLCBpZ25vcmVfZXJyb3JzPVRydWUpCgoKZGVmIGRlY29kZV9yZXF1ZXN0X2ltYWdlKGJvZHkpOgogICAgZGF0YV91cmwgPSBib2R5LmdldCgiZGF0YVVybCIpIG9yICIiCiAgICBpZiBkYXRhX3VybDoKICAgICAgICBtYXRjaCA9IERBVEFfVVJMX1JFLm1hdGNoKGRhdGFfdXJsLnN0cmlwKCkpCiAgICAgICAgaWYgbm90IG1hdGNoOgogICAgICAgICAgICByYWlzZSBEaWN1dEVycm9yKCJkYXRhVXJsIOC5hOC4oeC5iOC4luC4ueC4geC4leC5ieC4reC4hyAo4LiV4LmJ4Lit4LiH4LmA4Lib4LmH4LiZIGJhc2U2NCBkYXRhIFVSTCkiKQogICAgICAgIHJldHVybiBiYXNlNjQuYjY0ZGVjb2RlKG1hdGNoLmdyb3VwKCJwYXlsb2FkIikpLCBtYXRjaC5ncm91cCgibWltZSIpIG9yICJpbWFnZS9wbmciCiAgICByYXcgPSBib2R5LmdldCgiYmFzZTY0Iikgb3IgIiIKICAgIGlmIHJhdzoKICAgICAgICByZXR1cm4gYmFzZTY0LmI2NGRlY29kZShyYXcpLCBib2R5LmdldCgibWltZSIpIG9yICJpbWFnZS9wbmciCiAgICByYWlzZSBEaWN1dEVycm9yKCLguYTguKHguYjguKHguLXguILguYnguK3guKHguLnguKXguKPguLnguJvguYPguJkgcmVxdWVzdCIpCgoKIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQojIEhUVFAgbGF5ZXIKIyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQoKY2xhc3MgQnJpZGdlSGFuZGxlcihCYXNlSFRUUFJlcXVlc3RIYW5kbGVyKToKICAgIHNlcnZlcl92ZXJzaW9uID0gIkRpY3V0UFNCcmlkZ2UvIiArIFZFUlNJT04KICAgIHByb3RvY29sX3ZlcnNpb24gPSAiSFRUUC8xLjEiCiAgICB0aW1lb3V0X3NlY29uZHMgPSBERUZBVUxUX1RJTUVPVVQKICAgIGtlZXBfd29yayA9IEZhbHNlCgogICAgZGVmIGxvZ19tZXNzYWdlKHNlbGYsIGZtdCwgKmFyZ3MpOgogICAgICAgIHN5cy5zdGRvdXQud3JpdGUoIiVzIC0gJXNcbiIgJSAodGltZS5zdHJmdGltZSgiJUg6JU06JVMiKSwgZm10ICUgYXJncykpCiAgICAgICAgc3lzLnN0ZG91dC5mbHVzaCgpCgogICAgIyAtLSBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQogICAgZGVmIGNvcnNfaGVhZGVycyhzZWxmLCBvcmlnaW4pOgogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbiIsIG9yaWdpbiBvciAiKiIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiVmFyeSIsICJPcmlnaW4iKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMiLCAiR0VULCBQT1NULCBPUFRJT05TIikKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzIiwgIkNvbnRlbnQtVHlwZSIpCiAgICAgICAgIyBDaHJvbWUncyBQcml2YXRlIE5ldHdvcmsgQWNjZXNzIHByZWZsaWdodCBmb3IgaHR0cHMgLT4gMTI3LjAuMC4xLgogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkFjY2Vzcy1Db250cm9sLUFsbG93LVByaXZhdGUtTmV0d29yayIsICJ0cnVlIikKICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJBY2Nlc3MtQ29udHJvbC1NYXgtQWdlIiwgIjYwMCIpCgogICAgZGVmIHJlcGx5KHNlbGYsIHN0YXR1cywgcGF5bG9hZCk6CiAgICAgICAgb3JpZ2luID0gc2VsZi5oZWFkZXJzLmdldCgiT3JpZ2luIikKICAgICAgICBib2R5ID0ganNvbi5kdW1wcyhwYXlsb2FkLCBlbnN1cmVfYXNjaWk9RmFsc2UpLmVuY29kZSgidXRmLTgiKQogICAgICAgIHNlbGYuc2VuZF9yZXNwb25zZShzdGF0dXMpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1UeXBlIiwgImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLTgiKQogICAgICAgIHNlbGYuc2VuZF9oZWFkZXIoIkNvbnRlbnQtTGVuZ3RoIiwgc3RyKGxlbihib2R5KSkpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ2FjaGUtQ29udHJvbCIsICJuby1zdG9yZSIpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiWC1Db250ZW50LVR5cGUtT3B0aW9ucyIsICJub3NuaWZmIikKICAgICAgICBzZWxmLmNvcnNfaGVhZGVycyhvcmlnaW4pCiAgICAgICAgc2VsZi5lbmRfaGVhZGVycygpCiAgICAgICAgc2VsZi53ZmlsZS53cml0ZShib2R5KQoKICAgIGRlZiBndWFyZF9vcmlnaW4oc2VsZik6CiAgICAgICAgb3JpZ2luID0gc2VsZi5oZWFkZXJzLmdldCgiT3JpZ2luIikKICAgICAgICBpZiBvcmlnaW5fYWxsb3dlZChvcmlnaW4pOgogICAgICAgICAgICByZXR1cm4gVHJ1ZQogICAgICAgIHNlbGYucmVwbHkoNDAzLCB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJvcmlnaW4g4LmE4Lih4LmI4LmE4LiU4LmJ4Lij4Lix4Lia4Lit4LiZ4Li44LiN4Liy4LiVOiAlcyIgJSBvcmlnaW59KQogICAgICAgIHJldHVybiBGYWxzZQoKICAgICMgLS0gcm91dGVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KICAgIGRlZiBkb19PUFRJT05TKHNlbGYpOiAgIyBub3FhOiBOODAyIC0gQmFzZUhUVFBSZXF1ZXN0SGFuZGxlciBuYW1pbmcKICAgICAgICBvcmlnaW4gPSBzZWxmLmhlYWRlcnMuZ2V0KCJPcmlnaW4iKQogICAgICAgIGlmIG5vdCBvcmlnaW5fYWxsb3dlZChvcmlnaW4pOgogICAgICAgICAgICBzZWxmLnNlbmRfcmVzcG9uc2UoNDAzKQogICAgICAgICAgICBzZWxmLnNlbmRfaGVhZGVyKCJDb250ZW50LUxlbmd0aCIsICIwIikKICAgICAgICAgICAgc2VsZi5lbmRfaGVhZGVycygpCiAgICAgICAgICAgIHJldHVybgogICAgICAgIHNlbGYuc2VuZF9yZXNwb25zZSgyMDQpCiAgICAgICAgc2VsZi5zZW5kX2hlYWRlcigiQ29udGVudC1MZW5ndGgiLCAiMCIpCiAgICAgICAgc2VsZi5jb3JzX2hlYWRlcnMob3JpZ2luKQogICAgICAgIHNlbGYuZW5kX2hlYWRlcnMoKQoKICAgIGRlZiBkb19HRVQoc2VsZik6ICAjIG5vcWE6IE44MDIKICAgICAgICBpZiBzZWxmLnBhdGguc3BsaXQoIj8iKVswXSBub3QgaW4gKCIvaGVhbHRoIiwgIi8iKToKICAgICAgICAgICAgc2VsZi5yZXBseSg0MDQsIHsib2siOiBGYWxzZSwgImVycm9yIjogIm5vdCBmb3VuZCJ9KQogICAgICAgICAgICByZXR1cm4KICAgICAgICBpZiBub3Qgc2VsZi5ndWFyZF9vcmlnaW4oKToKICAgICAgICAgICAgcmV0dXJuCiAgICAgICAgc3RhdHVzID0gcGhvdG9zaG9wX3N0YXR1cygpCiAgICAgICAgc2VsZi5yZXBseSgyMDAsIHsKICAgICAgICAgICAgIm9rIjogVHJ1ZSwKICAgICAgICAgICAgIm5hbWUiOiAiZGljdXQtcHMtYnJpZGdlIiwKICAgICAgICAgICAgInZlcnNpb24iOiBWRVJTSU9OLAogICAgICAgICAgICAicGxhdGZvcm0iOiBzeXMucGxhdGZvcm0sCiAgICAgICAgICAgICJvcyI6IHBsYXRmb3JtLnBsYXRmb3JtKCksCiAgICAgICAgICAgICJwaG90b3Nob3AiOiBzdGF0dXNbIm5hbWUiXSwKICAgICAgICAgICAgInBob3Rvc2hvcEZvdW5kIjogc3RhdHVzWyJmb3VuZCJdLAogICAgICAgICAgICAiYnVzeSI6IFBIT1RPU0hPUF9MT0NLLmxvY2tlZCgpLAogICAgICAgIH0pCgogICAgZGVmIGRvX1BPU1Qoc2VsZik6ICAjIG5vcWE6IE44MDIKICAgICAgICBpZiBzZWxmLnBhdGguc3BsaXQoIj8iKVswXSAhPSAiL2RpY3V0IjoKICAgICAgICAgICAgc2VsZi5yZXBseSg0MDQsIHsib2siOiBGYWxzZSwgImVycm9yIjogIm5vdCBmb3VuZCJ9KQogICAgICAgICAgICByZXR1cm4KICAgICAgICBpZiBub3Qgc2VsZi5ndWFyZF9vcmlnaW4oKToKICAgICAgICAgICAgcmV0dXJuCiAgICAgICAgdHJ5OgogICAgICAgICAgICBsZW5ndGggPSBpbnQoc2VsZi5oZWFkZXJzLmdldCgiQ29udGVudC1MZW5ndGgiKSBvciAwKQogICAgICAgIGV4Y2VwdCBWYWx1ZUVycm9yOgogICAgICAgICAgICBsZW5ndGggPSAwCiAgICAgICAgaWYgbGVuZ3RoIDw9IDA6CiAgICAgICAgICAgIHNlbGYucmVwbHkoNDAwLCB7Im9rIjogRmFsc2UsICJlcnJvciI6ICJyZXF1ZXN0IOC4p+C5iOC4suC4hyJ9KQogICAgICAgICAgICByZXR1cm4KICAgICAgICBpZiBsZW5ndGggPiBNQVhfQk9EWV9CWVRFUzoKICAgICAgICAgICAgc2VsZi5yZXBseSg0MTMsIHsib2siOiBGYWxzZSwgImVycm9yIjogIuC4o+C4ueC4m+C5g+C4q+C4jeC5iOC5gOC4geC4tOC4mSAlZCBNQiIgJSAoTUFYX0JPRFlfQllURVMgLy8gMTAyNCAvLyAxMDI0KX0pCiAgICAgICAgICAgIHJldHVybgogICAgICAgIHRyeToKICAgICAgICAgICAgYm9keSA9IGpzb24ubG9hZHMoc2VsZi5yZmlsZS5yZWFkKGxlbmd0aCkuZGVjb2RlKCJ1dGYtOCIpKQogICAgICAgIGV4Y2VwdCAoVmFsdWVFcnJvciwgVW5pY29kZURlY29kZUVycm9yKSBhcyBlcnJvcjoKICAgICAgICAgICAgc2VsZi5yZXBseSg0MDAsIHsib2siOiBGYWxzZSwgImVycm9yIjogIuC4reC5iOC4suC4mSBKU09OIOC5hOC4oeC5iOC5hOC4lOC5iTogJXMiICUgZXJyb3J9KQogICAgICAgICAgICByZXR1cm4KCiAgICAgICAgbmFtZSA9IHN0cihib2R5LmdldCgibmFtZSIpIG9yICJpbWFnZSIpCiAgICAgICAgdHJ5OgogICAgICAgICAgICBwYXlsb2FkLCBtaW1lID0gZGVjb2RlX3JlcXVlc3RfaW1hZ2UoYm9keSkKICAgICAgICAgICAgcmVzdWx0ID0gZGljdXRfYnl0ZXMocGF5bG9hZCwgbWltZSwgc2VsZi50aW1lb3V0X3NlY29uZHMsIHNlbGYua2VlcF93b3JrKQogICAgICAgIGV4Y2VwdCBEaWN1dEVycm9yIGFzIGVycm9yOgogICAgICAgICAgICBzZWxmLmxvZ19tZXNzYWdlKCJkaWN1dCBGQUlMRUQgJXMgLSAlcyIsIG5hbWUsIGVycm9yKQogICAgICAgICAgICBzZWxmLnJlcGx5KDUwMiwgeyJvayI6IEZhbHNlLCAiZXJyb3IiOiBzdHIoZXJyb3IpfSkKICAgICAgICAgICAgcmV0dXJuCiAgICAgICAgZXhjZXB0IEV4Y2VwdGlvbiBhcyBlcnJvcjogICMgbm9xYTogQkxFMDAxIC0gc3VyZmFjZSB0aGUgcmVhbCBjYXVzZQogICAgICAgICAgICBzZWxmLmxvZ19tZXNzYWdlKCJkaWN1dCBFUlJPUiAlcyAtICVzIiwgbmFtZSwgZXJyb3IpCiAgICAgICAgICAgIHNlbGYucmVwbHkoNTAwLCB7Im9rIjogRmFsc2UsICJlcnJvciI6ICIlczogJXMiICUgKHR5cGUoZXJyb3IpLl9fbmFtZV9fLCBlcnJvcil9KQogICAgICAgICAgICByZXR1cm4KCiAgICAgICAgc2VsZi5sb2dfbWVzc2FnZSgiZGljdXQgb2sgJXMgKCVzLCAlc21zKSIsIG5hbWUsIHJlc3VsdFsibWV0aG9kIl0sIHJlc3VsdFsibXMiXSkKICAgICAgICBzZWxmLnJlcGx5KDIwMCwgewogICAgICAgICAgICAib2siOiBUcnVlLAogICAgICAgICAgICAibmFtZSI6IG5hbWUsCiAgICAgICAgICAgICJtZXRob2QiOiByZXN1bHRbIm1ldGhvZCJdLAogICAgICAgICAgICAibXMiOiByZXN1bHRbIm1zIl0sCiAgICAgICAgICAgICJwaG90b3Nob3AiOiByZXN1bHRbInBob3Rvc2hvcCJdLAogICAgICAgICAgICAiYnl0ZXMiOiBsZW4ocmVzdWx0WyJwbmciXSksCiAgICAgICAgICAgICJkYXRhVXJsIjogImRhdGE6aW1hZ2UvcG5nO2Jhc2U2NCwiICsgYmFzZTY0LmI2NGVuY29kZShyZXN1bHRbInBuZyJdKS5kZWNvZGUoImFzY2lpIiksCiAgICAgICAgfSkKCgpkZWYgc2VsZnRlc3QoaW1hZ2VfcGF0aCwgdGltZW91dCwga2VlcF93b3JrKToKICAgIHNvdXJjZSA9IFBhdGgoaW1hZ2VfcGF0aCkKICAgIGlmIG5vdCBzb3VyY2UuaXNfZmlsZSgpOgogICAgICAgIHByaW50KCLguYTguKHguYjguJ7guJrguYTguJ/guKXguYw6ICVzIiAlIHNvdXJjZSkKICAgICAgICByZXR1cm4gMQogICAgc3RhdHVzID0gcGhvdG9zaG9wX3N0YXR1cygpCiAgICBwcmludCgicGxhdGZvcm0gIDogJXMiICUgc3lzLnBsYXRmb3JtKQogICAgcHJpbnQoInBob3Rvc2hvcCA6ICVzIiAlIChzdGF0dXNbIm5hbWUiXSBvciAiTk9UIEZPVU5EIikpCiAgICBpZiBub3Qgc3RhdHVzWyJmb3VuZCJdOgogICAgICAgIHJldHVybiAxCiAgICBtaW1lID0gImltYWdlL3BuZyIgaWYgc291cmNlLnN1ZmZpeC5sb3dlcigpID09ICIucG5nIiBlbHNlICJpbWFnZS9qcGVnIgogICAgdHJ5OgogICAgICAgIHJlc3VsdCA9IGRpY3V0X2J5dGVzKHNvdXJjZS5yZWFkX2J5dGVzKCksIG1pbWUsIHRpbWVvdXQsIGtlZXBfd29yaykKICAgIGV4Y2VwdCBEaWN1dEVycm9yIGFzIGVycm9yOgogICAgICAgIHByaW50KCJGQUlMRUQ6ICVzIiAlIGVycm9yKQogICAgICAgIHJldHVybiAxCiAgICBvdXQgPSBzb3VyY2Uud2l0aF9uYW1lKHNvdXJjZS5zdGVtICsgIl9kaWN1dC5wbmciKQogICAgb3V0LndyaXRlX2J5dGVzKHJlc3VsdFsicG5nIl0pCiAgICBwcmludCgiT0sgKCVzLCAlc21zKSAtPiAlcyIgJSAocmVzdWx0WyJtZXRob2QiXSwgcmVzdWx0WyJtcyJdLCBvdXQpKQogICAgcmV0dXJuIDAKCgpkZWYgbWFpbigpOgogICAgcGFyc2VyID0gYXJncGFyc2UuQXJndW1lbnRQYXJzZXIoZGVzY3JpcHRpb249IkRpY3V0IFBTIEJyaWRnZSIpCiAgICBwYXJzZXIuYWRkX2FyZ3VtZW50KCItLWhvc3QiLCBkZWZhdWx0PURFRkFVTFRfSE9TVCkKICAgIHBhcnNlci5hZGRfYXJndW1lbnQoIi0tcG9ydCIsIHR5cGU9aW50LCBkZWZhdWx0PWludChvcy5lbnZpcm9uLmdldCgiRElDVVRfQlJJREdFX1BPUlQiLCBERUZBVUxUX1BPUlQpKSkKICAgIHBhcnNlci5hZGRfYXJndW1lbnQoIi0tdGltZW91dCIsIHR5cGU9aW50LCBkZWZhdWx0PURFRkFVTFRfVElNRU9VVCkKICAgIHBhcnNlci5hZGRfYXJndW1lbnQoIi0ta2VlcC13b3JrIiwgYWN0aW9uPSJzdG9yZV90cnVlIiwgaGVscD0ia2VlcCB0aGUgdGVtcCBmb2xkZXIgZm9yIGRlYnVnZ2luZyIpCiAgICBwYXJzZXIuYWRkX2FyZ3VtZW50KCItLXNlbGZ0ZXN0IiwgbWV0YXZhcj0iSU1BR0UiLCBoZWxwPSJjdXQgb25lIGZpbGUgYW5kIGV4aXQiKQogICAgYXJncyA9IHBhcnNlci5wYXJzZV9hcmdzKCkKCiAgICBsb2FkX2V4dHJhX29yaWdpbnMoKQogICAgaWYgYXJncy5zZWxmdGVzdDoKICAgICAgICByYWlzZSBTeXN0ZW1FeGl0KHNlbGZ0ZXN0KGFyZ3Muc2VsZnRlc3QsIGFyZ3MudGltZW91dCwgYXJncy5rZWVwX3dvcmspKQoKICAgIEJyaWRnZUhhbmRsZXIudGltZW91dF9zZWNvbmRzID0gYXJncy50aW1lb3V0CiAgICBCcmlkZ2VIYW5kbGVyLmtlZXBfd29yayA9IGFyZ3Mua2VlcF93b3JrCiAgICBzZXJ2ZXIgPSBUaHJlYWRpbmdIVFRQU2VydmVyKChhcmdzLmhvc3QsIGFyZ3MucG9ydCksIEJyaWRnZUhhbmRsZXIpCiAgICBzdGF0dXMgPSBwaG90b3Nob3Bfc3RhdHVzKCkKICAgIHByaW50KCJEaWN1dCBQUyBCcmlkZ2UgJXMiICUgVkVSU0lPTikKICAgIHByaW50KCJsaXN0ZW5pbmcgOiBodHRwOi8vJXM6JWQiICUgKGFyZ3MuaG9zdCwgYXJncy5wb3J0KSkKICAgIHByaW50KCJwaG90b3Nob3AgOiAlcyIgJSAoc3RhdHVzWyJuYW1lIl0gb3IgIk5PVCBGT1VORCAtIOC4leC4tOC4lOC4leC4seC5ieC4hyBQaG90b3Nob3AgMjAyMisg4LiB4LmI4Lit4LiZIikpCiAgICBwcmludCgic3RvcCAgICAgIDogQ3RybCtDIikKICAgIHN5cy5zdGRvdXQuZmx1c2goKQogICAgdHJ5OgogICAgICAgIHNlcnZlci5zZXJ2ZV9mb3JldmVyKCkKICAgIGV4Y2VwdCBLZXlib2FyZEludGVycnVwdDoKICAgICAgICBwcmludCgiXG5zdG9wcGVkIikKICAgIGZpbmFsbHk6CiAgICAgICAgc2VydmVyLnNlcnZlcl9jbG9zZSgpCgoKaWYgX19uYW1lX18gPT0gIl9fbWFpbl9fIjoKICAgIG1haW4oKQo=';
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
        body: JSON.stringify({ name: name || 'image', dataUrl: dataUrl }),
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
      return cut(item.source, item.name, { signal: settings.signal, timeoutMs: settings.timeoutMs })
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

  function injectHelpStyles() {
    if (document.getElementById('dicut-ps-style')) return;
    var style = document.createElement('style');
    style.id = 'dicut-ps-style';
    style.textContent = [
      '.dicut-ps-backdrop{position:fixed;inset:0;background:rgba(8,10,14,.62);display:flex;align-items:center;',
      'justify-content:center;padding:16px;z-index:1000;overflow:auto}',
      '.dicut-ps-backdrop[hidden]{display:none}',
      '.dicut-ps-dialog{background:#fff;color:#1b1f27;border-radius:12px;max-width:560px;width:100%;',
      'max-height:calc(100vh - 32px);overflow:auto;padding:20px;box-shadow:0 18px 48px rgba(0,0,0,.35);',
      'font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;',
      'animation:dicutPsIn 200ms cubic-bezier(.2,.7,.3,1) both}',
      '@keyframes dicutPsIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
      '.dicut-ps-dialog h2{margin:0 0 4px;font-size:16px}',
      '.dicut-ps-dialog p{margin:0 0 10px}',
      '.dicut-ps-dialog ol{margin:0 0 12px;padding-left:18px}',
      '.dicut-ps-dialog li{margin-bottom:6px}',
      '.dicut-ps-dialog code{display:block;background:#f1f3f7;border:1px solid #dfe3ea;border-radius:6px;',
      'padding:8px 10px;margin:6px 0;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;word-break:break-all}',
      '.dicut-ps-status{background:#fdf0f0;border:1px solid #f2c9c9;border-radius:8px;padding:8px 10px;margin:0 0 12px}',
      '.dicut-ps-tabs{display:flex;gap:8px;margin:0 0 12px}',
      '.dicut-ps-tab{min-height:44px;padding:0 14px;border-radius:8px;border:1px solid #d7dbe3;background:#f7f8fa;',
      'color:inherit;cursor:pointer;font:inherit}',
      '.dicut-ps-tab[aria-selected="true"]{background:#1b1f27;border-color:#1b1f27;color:#fff}',
      '.dicut-ps-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}',
      '.dicut-ps-actions button{min-height:44px;padding:0 16px;border-radius:8px;border:1px solid #d7dbe3;',
      'background:#f7f8fa;color:inherit;cursor:pointer;font:inherit}',
      '.dicut-ps-actions .dicut-ps-primary{background:#1b1f27;border-color:#1b1f27;color:#fff}',
      '.dicut-ps-step-btn{min-height:44px;margin:6px 0;padding:0 16px;border-radius:8px;border:1px solid #d7dbe3;',
      'background:#f7f8fa;color:inherit;cursor:pointer;font:inherit;font-weight:700}',
      '.dicut-ps-step-btn.is-main{background:#1b1f27;border-color:#1b1f27;color:#fff}',
      '.dicut-ps-note{color:#6b7280;font-size:12px}',
      '@media (prefers-color-scheme:dark){',
      '.dicut-ps-dialog{background:#191c22;color:#e8ebf0}',
      '.dicut-ps-dialog code{background:#22262e;border-color:#333944}',
      '.dicut-ps-status{background:#2a1d1f;border-color:#5a3134}',
      '.dicut-ps-note{color:#9aa2b1}',
      '.dicut-ps-tab,.dicut-ps-actions button,.dicut-ps-step-btn{background:#22262e;border-color:#333944}',
      '.dicut-ps-tab[aria-selected="true"],.dicut-ps-actions .dicut-ps-primary,',
      '.dicut-ps-step-btn.is-main{background:#e8ebf0;border-color:#e8ebf0;color:#191c22}}',
      '@media (prefers-reduced-motion:reduce){.dicut-ps-dialog{animation:none}}'
    ].join('');
    document.head.appendChild(style);
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
})();
