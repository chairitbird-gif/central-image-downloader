(() => {
  'use strict';
  const THEME_KEY = 'central_tools_theme';
  try {
    const requested = new URLSearchParams(location.search).get('theme');
    const theme = requested === 'light' || requested === 'dark' ? requested : (localStorage.getItem(THEME_KEY) || 'dark');
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  } catch (_) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
