(() => {
  const key = 'onstage.theme';
  const paletteKey = 'onstage.palette';
  const palettes = {
    green: {label:'青绿',color:'#087f70',logo:'/assets/mark.svg?v=3'},
    blue: {label:'蓝色',color:'#245cb8',logo:'/assets/mark-blue.svg?v=1'},
    purple: {label:'紫色',color:'#7354b8',logo:'/assets/mark-purple.svg?v=1'},
    mono: {label:'黑白',color:'#202328',logo:'/assets/mark-mono.svg?v=3'}
  };
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const moon = '<path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/>';
  const sun = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>';
  let current, currentPalette;

  function preference(storageKey = key, allowed = ['dark','light']) {
    try {
      const value = localStorage.getItem(storageKey);
      return allowed.includes(value) ? value : null;
    } catch { return null; }
  }
  const savedPalette = () => preference(paletteKey, Object.keys(palettes)) || 'green';
  const notifyFrame = () => document.getElementById('multimodal-frame')?.contentWindow?.postMessage({channel:'onstage-theme',theme:current,palette:currentPalette}, location.origin);
  function updateControls() {
    const button = document.getElementById('theme-toggle');
    const dark = current === 'dark';
    if (button) {
      const action = dark ? '切换至浅色模式' : '切换至深色模式';
      button.setAttribute('aria-label', action);
      button.title = action;
      button.querySelector('svg').innerHTML = dark ? sun : moon;
      button.querySelector('.theme-label').textContent = dark ? '浅色模式' : '深色模式';
    }
    const logo = document.querySelector('.sidebar .brand img');
    const src = dark ? '/assets/mark-inverse.svg?v=3' : palettes[currentPalette].logo;
    if (logo && logo.getAttribute('src') !== src) logo.setAttribute('src', src);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#121c18' : palettes[currentPalette].color;
    document.querySelectorAll('[data-palette-value]').forEach(choice => choice.setAttribute('aria-pressed',String(choice.dataset.paletteValue === currentPalette)));
    const paletteButton = document.getElementById('palette-toggle');
    if (paletteButton) paletteButton.title = `浅色配色：${palettes[currentPalette].label}`;
  }
  function apply(value, palette = savedPalette()) {
    current = value;
    currentPalette = palette;
    document.documentElement.dataset.theme = value;
    document.documentElement.dataset.palette = palette;
    updateControls();
    notifyFrame();
    window.dispatchEvent(new Event('onstage-appearance'));
  }
  apply(preference() || (system.matches ? 'dark' : 'light'));
  function bind() {
    updateControls();
    document.getElementById('multimodal-frame')?.addEventListener('load', () => {
      notifyFrame();
    });
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      const value = current === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, value); } catch {}
      apply(value,currentPalette);
    });
    const panel = document.getElementById('palette-panel');
    const opener = document.getElementById('palette-toggle');
    function closePanel(returnFocus = false) {
      if (!panel || !opener) return;
      panel.hidden = true;
      opener.setAttribute('aria-expanded','false');
      if (returnFocus) opener.focus();
    }
    opener?.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      opener.setAttribute('aria-expanded',String(!panel.hidden));
      if (!panel.hidden) panel.querySelector('[aria-pressed=true]')?.focus();
    });
    panel?.addEventListener('click', event => {
      const choice = event.target.closest('[data-palette-value]');
      if (!choice || !palettes[choice.dataset.paletteValue]) return;
      const palette = choice.dataset.paletteValue;
      try { localStorage.setItem(paletteKey,palette);localStorage.setItem(key,'light'); } catch {}
      apply('light',palette);
      closePanel(true);
    });
    document.addEventListener('click', event => {
      if (panel && !panel.hidden && !panel.contains(event.target) && !opener.contains(event.target)) closePanel();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panel && !panel.hidden) { closePanel(true);event.preventDefault(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once:true});
  else bind();
  // Same-origin capture frames and other tabs follow the user's saved choice.
  window.addEventListener('storage', event => {
    if ([key,paletteKey,null].includes(event.key)) apply(preference() || (system.matches ? 'dark' : 'light'));
  });
  window.addEventListener('message', event => {
    if (window.parent !== window && event.source === window.parent && event.origin === location.origin && event.data?.channel === 'onstage-theme' && ['light','dark'].includes(event.data.theme)) apply(event.data.theme, palettes[event.data.palette] ? event.data.palette : savedPalette());
  });
  system.addEventListener('change', () => {
    if (!preference()) apply(system.matches ? 'dark' : 'light');
  });
})();
