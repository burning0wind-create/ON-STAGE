import './model-settings.js';
const sidebar = document.querySelector('.sidebar');
const toggle = document.getElementById('sidebar-toggle');
const stateKey = 'onstage.sidebar';

const icons = {
  home: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M9 10h12"/>',
  setup: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/>',
  'exam-library': '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4zM13 7a3 3 0 0 1 3-3h4v15h-4a4 4 0 0 0-3 2M7 8h3M7 12h3M16 8h2M16 12h2"/>',
  devices: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4M8 11h2l2-4 2 7 2-3h2"/>',
  interview: '<path d="M8 5l11 7-11 7z"/>',
  reports: '<path d="M4 3v18h17M8 16v-5M13 16V6M18 16V9"/>',
  sources: '<path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h6"/>'
};
for (const link of sidebar.querySelectorAll('nav a')) {
  const label = link.textContent.replace(link.querySelector('span')?.textContent || '', '').trim();
  link.setAttribute('aria-label', label);
  link.title = label;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = icons[link.dataset.page] || '';
  const text = document.createElement('span');
  text.className = 'nav-label';
  text.textContent = label;
  link.replaceChildren(icon, text);
}

function setCollapsed(collapsed, remember = false) {
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', collapsed ? '展开侧边栏' : '收起侧边栏');
  toggle.title = collapsed ? '展开侧边栏' : '收起侧边栏';
  if (remember) {
    try { localStorage.setItem(stateKey, collapsed ? 'collapsed' : 'expanded'); } catch {}
  }
}
let collapsed = false;
try { collapsed = localStorage.getItem(stateKey) === 'collapsed'; } catch {}
let preferredCollapsed=collapsed;
const compactViewport=window.matchMedia('(min-width: 721px) and (max-width: 1180px)');
setCollapsed(preferredCollapsed||compactViewport.matches);
compactViewport.addEventListener('change',()=>setCollapsed(preferredCollapsed||compactViewport.matches));
toggle.addEventListener('click', () => {preferredCollapsed=!document.documentElement.classList.contains('sidebar-collapsed');setCollapsed(preferredCollapsed,true);});
window.addEventListener('storage', event => {
  if (event.key === stateKey) {preferredCollapsed=event.newValue==='collapsed';setCollapsed(preferredCollapsed||compactViewport.matches);}
});
