/* Central Creative Tools — keyboard layout independent shortcut key.
   Canonical file: shared/shortcut-key.js at the coordination root.
   Contract: docs/contracts/SHARED_SHORTCUTS.md

   Do NOT edit the copies inside the tool repositories. Edit this file, then run
   `python shared/tools/sync_shortcut_key.py` and make `--check` pass before any release.

   Why this exists (CCT-0123)
   --------------------------
   `event.key` is the character the current layout would produce. With a Thai keyboard the
   physical Z key reports 'ผ', so `key === 'z'` is false and Ctrl+Z never reaches the app —
   the browser's own undo takes over instead, which knows nothing about the job being edited.
   Bird hit exactly that. The same held for Ctrl+S, Ctrl+Shift+S and the single-key E and ?
   in three of the four tools.

   `event.code` names the physical key ('KeyZ'), unchanged by the active layout, so shortcuts
   bound to letters and digits must read that.

   What must NOT go through here
   -----------------------------
   Escape, Enter, Tab, Space, F-keys, arrows, Delete. `event.key` already returns the same
   value for those on every layout, while `event.code` describes a position — on a layout that
   puts those keys somewhere else, switching them to `code` would break what currently works.
   Pass those to `event.key` directly, as the tools already do. */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.shortcutKey = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Returns the letter/digit a shortcut should match, taken from the physical key, or the
     lower-cased event.key when the key is not one that layouts remap. Punctuation produced
     with a modifier ('?', '+') has no stable code across layouts, so it stays on event.key. */
  return function shortcutKey(e) {
    var code = (e && e.code) || '';
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(code) || /^Numpad\d$/.test(code)) return code.slice(-1);
    if (code === 'Minus' || code === 'NumpadSubtract') return '-';
    if (code === 'Equal' || code === 'NumpadAdd') return '+';
    return ((e && e.key) || '').toLowerCase();
  };
});
