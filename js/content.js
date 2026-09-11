// Flexi Device — content script. Injected by the background worker into the
// active tab (after js/devices.js). Builds the simulator UI inside a Shadow DOM
// so page styles never leak in, and loads the site inside one <iframe> per frame.
(() => {
  if (window.__flexiDevice) {
    // an instance is already on the page: reuse it if its extension context is
    // still valid, otherwise (extension was reloaded) tear it down and boot fresh
    if (window.__flexiDevice.alive?.()) { window.__flexiDevice.render(); return; }
    try { window.__flexiDevice.teardown(); } catch { /* stale instance */ }
  }

  // When the extension is reloaded while the simulator is open, this script
  // keeps running but every chrome.* call throws "Extension context invalidated".
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const t = (key, subs) => { try { return chrome.i18n.getMessage(key, subs) || key; } catch { return key; } };
  const PRESETS = globalThis.FLEXI_DEVICES || [];

  const BEZEL = { phone: 12, tablet: 18, laptop: 14 };
  const LAPTOP_OVERHANG = 44; // aluminium base sticks out this much on each side
  // height of the status-bar strip drawn above the page, per cutout style
  const STATUS_H = { island: 48, notch: 44, punch: 30, none: 24 };
  const BRAND_ORDER = ['Apple', 'Samsung', 'Google', 'Xiaomi', 'Motorola', 'OnePlus', 'Huawei', 'OPPO', 'vivo', 'Nothing', 'Laptops'];
  const DEFAULT_INSTANCES = [
    { uid: 'a', deviceId: 'iphone-15', landscape: false },
    { uid: 'b', deviceId: 'ipad-pro-12', landscape: false },
  ];

  // ------------------------------------------------------------------- state
  const state = {
    instances: [],
    customDevices: [],
    favorites: [],
    headerType: 'ios',
    settings: { frameStyle: 'photo', realisticUI: true, syncScroll: true, theme: 'system', screenMode: 'browser', customUrl: '', customTime: '', layout: 'equal' },
    url: location.href,
    selectedUid: null,
  };

  const allDevices = () => [...PRESETS, ...state.customDevices];
  const findDevice = (id) => allDevices().find((d) => d.id === id);
  const uid = () => Math.random().toString(36).slice(2, 9);

  async function loadState() {
    const s = await chrome.storage.local.get(['instances', 'customDevices', 'favorites', 'headerType', 'syncScroll', 'settings']);
    Object.assign(state.settings, s.settings || {});
    if (s.syncScroll === false && !s.settings) state.settings.syncScroll = false; // legacy key
    if (s.settings && s.settings.showFrame === false && !s.settings.frameStyle) state.settings.frameStyle = 'none'; // legacy toggle
    if (!['photo', 'drawn', 'none'].includes(state.settings.frameStyle)) state.settings.frameStyle = 'photo';
    state.customDevices = Array.isArray(s.customDevices) ? s.customDevices : [];
    state.favorites = Array.isArray(s.favorites) ? s.favorites : [];
    state.headerType = s.headerType || 'ios';
    state.instances = (Array.isArray(s.instances) && s.instances.length ? s.instances : DEFAULT_INSTANCES)
      .filter((i) => findDevice(i.deviceId));
  }
  // chrome.storage rejects (rather than throws) once the context is invalidated
  const store = (obj) => { try { return Promise.resolve(chrome.storage.local.set(obj)).catch(() => {}); } catch { return Promise.resolve(); } };
  const saveInstances = () => store({ instances: state.instances });
  const saveCustom = () => store({ customDevices: state.customDevices });
  const saveFavorites = () => store({ favorites: state.favorites });
  const saveSettings = () => store({ settings: state.settings });

  // ---------------------------------------------------------------- DOM setup
  const host = document.createElement('flexi-device-root');
  host.setAttribute('style', 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block;');
  const root = host.attachShadow({ mode: 'open' });
  // Stylesheet is fetched with the cache bypassed so edits to content.css show
  // up on the next activation, without reloading the extension.
  const styleEl = document.createElement('style');
  root.appendChild(styleEl);
  const cssReady = fetch(chrome.runtime.getURL('css/content.css') + '?v=' + Date.now(), { cache: 'no-store' })
    .then((r) => r.text())
    .then((css) => { styleEl.textContent = css; })
    .catch((e) => console.error('[Flexi Device] stylesheet', e));

  const app = document.createElement('div');
  app.className = 'fx-root';
  root.appendChild(app);

  const prevOverflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';
  document.documentElement.appendChild(host);

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const btn = (cls, title, svg, onClick) => {
    const b = el('button', `fx-btn ${cls}`);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = svg;
    b.addEventListener('click', onClick);
    return b;
  };

  const ICON = {
    reload: '<svg viewBox="0 0 24 24"><path d="M4 4v6h6M20 20v-6h-6M20 9A8 8 0 0 0 5.6 6.6L4 10m16 4-1.6 3.4A8 8 0 0 1 4 15"/></svg>',
    rotate: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3" width="10" height="17" rx="2"/><path d="M7 17.5h3"/><path d="M16.5 5.5a6.5 6.5 0 0 1 4 8"/><path d="M18 12.5l2.6 1.2 1-2.7"/><path d="M13.5 21h5a2 2 0 0 0 2-2v-2" stroke-dasharray="2 1.6"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
    go: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    chevron: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-7.5-10A4.2 4.2 0 0 1 12 8a4.2 4.2 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10z"/></svg>',
    phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/></svg>',
    tablet: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M11 18h2"/></svg>',
    laptop: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
    grip: '<svg class="fx-grip" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>',
    themeSystem: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
    browser: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M7 7h10"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    fwd: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4M5 12v8h14v-8"/></svg>',
    tabs: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="6" y="10" width="12" height="10" rx="2"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg>',
    aa: '<svg viewBox="0 0 24 24"><path d="M3 18l4.5-12h1L13 18M5 14h5.5M14 18l3-8h.8l3 8M15.5 15.5h4"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4"/></svg>',
    columns: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="5" height="16" rx="1.2"/><rect x="9.5" y="4" width="5" height="16" rx="1.2"/><rect x="16" y="4" width="5" height="16" rx="1.2"/></svg>',
    proportional: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="4" height="13" rx="1.2"/><rect x="9" y="4" width="6" height="16" rx="1.2"/><rect x="17" y="9" width="4" height="11" rx="1.2"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    apple: '<svg viewBox="0 0 24 24"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.8-3-.8C7 7.3 5.6 8.2 4.8 9.6c-1.7 2.9-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8 2.1-1.2 2.9-2.4c.9-1.4 1.3-2.7 1.3-2.8 0 0-2.5-1-2.5-3.9zM14.1 5.7c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z" fill="currentColor" stroke="none"/></svg>',
  };
  const TYPE_ICON = { phone: ICON.phone, tablet: ICON.tablet, laptop: ICON.laptop };

  // ----------------------------------------------------------------- toolbar
  let stage, modal, picker, addBtn, deviceBtn, settingsBtn, settings, layoutBtn, layoutMenu;

  const selectedInstance = () => state.instances.find((i) => i.uid === state.selectedUid) || state.instances[0] || null;

  function buildToolbar() {
    const bar = el('div', 'fx-toolbar');
    const group = (cls) => { const g = el('div', `fx-group ${cls || ''}`); bar.appendChild(g); return g; };

    const g1 = group('fx-group-device');
    deviceBtn = btn('fx-btn-device', t('replace_device'), '', () => {
      const inst = selectedInstance();
      if (inst) togglePicker(deviceBtn, { mode: 'replace', instance: inst });
    });
    g1.appendChild(deviceBtn);
    addBtn = btn('fx-btn-add', t('add_device'), ICON.plus, () => togglePicker(addBtn, { mode: 'add' }));
    g1.appendChild(addBtn);

    const g2 = group();
    g2.appendChild(btn('fx-btn-reload', t('reload'), ICON.reload, reloadFrames));
    g2.appendChild(btn('fx-btn-rotate', t('rotate'), ICON.rotate, () => {
      const inst = selectedInstance();
      if (!inst) return;
      inst.landscape = !inst.landscape;
      saveInstances();
      render();
    }));
    g2.appendChild(btn('fx-btn-shot', t('screenshot'), ICON.camera, () => {
      const inst = selectedInstance();
      const card = inst && stage.querySelector(`.fx-card[data-uid="${inst.uid}"]`);
      if (card) screenshot(card, findDevice(inst.deviceId), card._screenW, card._screenH);
    }));
    layoutBtn = btn('fx-btn-equalize', t('layout_menu'), ICON.columns, () => toggleLayoutMenu());
    g2.appendChild(layoutBtn);

    const g3 = group();
    settingsBtn = btn('fx-btn-settings', t('settings'), ICON.gear, () => openSettings());
    g3.appendChild(settingsBtn);
    g3.appendChild(btn('fx-btn-close', t('close'), ICON.close, closeSimulator));
    return bar;
  }

  function updateToolbar() {
    const inst = selectedInstance();
    const d = inst && findDevice(inst.deviceId);
    if (!d) { deviceBtn.innerHTML = `${ICON.phone}<span class="fx-card-name">${t('add_device')}</span>${ICON.chevron}`; return; }
    const w = inst.landscape ? d.h : d.w, h = inst.landscape ? d.w : d.h;
    deviceBtn.innerHTML = `${TYPE_ICON[d.type] || ICON.phone}<span class="fx-card-name">${d.name}</span><span class="fx-card-dims">${w} × ${h}</span>${ICON.chevron}`;
  }

  function selectInstance(uidValue) {
    state.selectedUid = uidValue;
    stage.querySelectorAll('.fx-card').forEach((c) => c.classList.toggle('fx-selected', c.dataset.uid === uidValue));
    updateToolbar();
  }

  // --------------------------------------------------------- settings modal
  const THEME_MQ = window.matchMedia('(prefers-color-scheme: dark)');
  const effectiveTheme = () => (state.settings.theme === 'system' ? (THEME_MQ.matches ? 'dark' : 'light') : state.settings.theme);
  function applyTheme() { app.dataset.theme = effectiveTheme(); }
  THEME_MQ.addEventListener('change', () => { applyTheme(); });

  function openSettings() {
    closeSettings();
    closePicker();
    settings = el('div', 'fx-modal-backdrop');
    const box = el('div', 'fx-modal fx-settings');
    const head = el('div', 'fx-settings-head');
    head.appendChild(el('h2', null, t('settings_title')));
    head.appendChild(btn('fx-btn-sm fx-btn-icon', t('close'), ICON.close, closeSettings));
    box.appendChild(head);

    const row = (label, control, cls = '') => {
      const r = el('div', `fx-setting-row ${cls}`);
      r.appendChild(el('span', 'fx-setting-label', label));
      r.appendChild(control);
      box.appendChild(r);
      return r;
    };
    const divider = () => box.appendChild(el('div', 'fx-setting-divider'));
    const toggle = (key, onChange) => {
      const l = el('label', 'fx-switch');
      const i = el('input'); i.type = 'checkbox'; i.checked = !!state.settings[key];
      i.addEventListener('change', () => { state.settings[key] = i.checked; saveSettings(); onChange && onChange(); });
      l.appendChild(i); l.appendChild(el('span', 'fx-switch-track'));
      return l;
    };
    const segmented = (key, options, onChange) => {
      const g = el('div', 'fx-segmented');
      options.forEach(([value, label, icon]) => {
        const b = el('button', `fx-seg${state.settings[key] === value ? ' fx-active' : ''}`);
        b.type = 'button';
        b.innerHTML = `${icon || ''}<span>${label}</span>`;
        b.addEventListener('click', () => {
          state.settings[key] = value; saveSettings();
          g.querySelectorAll('.fx-seg').forEach((x) => x.classList.toggle('fx-active', x === b));
          onChange && onChange();
        });
        g.appendChild(b);
      });
      return g;
    };
    const textInput = (key, placeholder, validate, onChange) => {
      const i = el('input', 'fx-input');
      i.type = 'text'; i.placeholder = placeholder; i.value = state.settings[key] || ''; i.spellcheck = false;
      i.addEventListener('change', () => {
        const v = i.value.trim();
        if (v && validate && !validate(v)) { i.classList.add('fx-invalid'); return; }
        i.classList.remove('fx-invalid');
        state.settings[key] = v; saveSettings(); onChange && onChange();
      });
      return i;
    };

    row(t('set_frame'), segmented('frameStyle', [['photo', t('frame_photo'), ICON.camera], ['drawn', t('frame_drawn'), ICON.phone], ['none', t('frame_none'), ICON.fullscreen]], render));
    row(t('set_realistic'), toggle('realisticUI', render));
    row(t('set_sync'), toggle('syncScroll'));
    divider();
    row(t('set_theme'), segmented('theme', [['system', t('theme_system'), ICON.themeSystem], ['light', t('theme_light'), ICON.sun], ['dark', t('theme_dark'), ICON.moon]], applyTheme));
    row(t('set_screen_mode'), segmented('screenMode', [['browser', t('mode_browser'), ICON.browser], ['pwa', t('mode_pwa'), ICON.phone], ['fullscreen', t('mode_fullscreen'), ICON.fullscreen]], render));
    divider();
    row(t('set_custom_url'), textInput('customUrl', t('url_example'), null, updateChrome));
    row(t('set_custom_time'), textInput('customTime', t('time_example'), (v) => /^\d{1,2}:\d{2}$/.test(v), tickClock));
    divider();
    const uaSelect = el('select', 'fx-select');
    for (const [v, k] of [['ios', 'ua_ios'], ['android', 'ua_android'], ['desktop', 'ua_desktop']]) {
      const o = el('option', null, t(k)); o.value = v; uaSelect.appendChild(o);
    }
    uaSelect.value = state.headerType;
    uaSelect.addEventListener('change', async () => {
      state.headerType = uaSelect.value;
      try { await chrome.runtime.sendMessage({ action: 'setHeaderType', value: state.headerType }); } catch { /* context gone */ }
      reloadFrames();
    });
    row(t('ua_label'), uaSelect);
    const foot = el('div', 'fx-settings-foot');
    foot.appendChild(btn('fx-btn-text', t('custom_device'), `${ICON.plus}<span>${t('create_device')}</span>`, () => { closeSettings(); openModal(); }));
    let version = ''; try { version = `v${chrome.runtime.getManifest().version}`; } catch { /* context gone */ }
    foot.appendChild(el('span', 'fx-version', version));
    box.appendChild(foot);

    settings.appendChild(box);
    settings.addEventListener('click', (e) => { if (e.target === settings) closeSettings(); });
    app.appendChild(settings);
  }
  function closeSettings() { if (settings) { settings.remove(); settings = null; } }

  function placePopover(node, anchor, preferredWidth) {
    const a = anchor.getBoundingClientRect();
    const width = Math.min(preferredWidth, window.innerWidth - 16);
    let left = a.left + a.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - 8 - width));
    node.style.left = `${left}px`;
    node.style.top = `${a.bottom + 8}px`;
    node.style.width = `${width}px`;
    node.style.maxHeight = `${window.innerHeight - a.bottom - 24}px`;
  }

  // ----------------------------------------------------------- device picker
  // opts.mode: 'add' (append a new frame) | 'replace' (swap the device of opts.instance)
  function togglePicker(anchor, opts) {
    if (picker && picker._anchor === anchor) return closePicker();
    openPicker(anchor, opts);
  }

  function openPicker(anchor, opts) {
    closePicker();
    closeSettings();
    const filters = { query: '', chip: 'all' };
    picker = el('div', 'fx-picker');
    picker._anchor = anchor;
    anchor.classList.add('fx-open');

    const searchWrap = el('div', 'fx-picker-search');
    searchWrap.innerHTML = ICON.search;
    const search = el('input');
    search.type = 'search';
    search.placeholder = t('search_placeholder', [String(PRESETS.length)]);
    search.spellcheck = false;
    searchWrap.appendChild(search);
    picker.appendChild(searchWrap);

    const chips = el('div', 'fx-picker-chips');
    const years = [...new Set(PRESETS.map((d) => d.year))].sort((a, b) => b - a).slice(0, 2);
    const chipDefs = [
      ['all', t('filter_all')], ...years.map((y) => [String(y), String(y)]),
      ['flagship', t('filter_flagship')], ['top', t('filter_top')],
    ];
    chipDefs.forEach(([value, label]) => {
      const c = el('button', `fx-chip${value === 'all' ? ' fx-active' : ''}`, label);
      c.type = 'button';
      c.dataset.value = value;
      c.addEventListener('click', () => {
        filters.chip = value;
        chips.querySelectorAll('.fx-chip').forEach((x) => x.classList.toggle('fx-active', x === c));
        renderList();
      });
      chips.appendChild(c);
    });
    picker.appendChild(chips);

    const list = el('div', 'fx-picker-list');
    picker.appendChild(list);

    const footer = el('div', 'fx-picker-footer');
    footer.appendChild(btn('fx-btn-text', t('custom_device'), `${ICON.plus}<span>${t('create_device')}</span>`, () => { closePicker(); openModal(); }));
    picker.appendChild(footer);

    const matches = (d) => {
      const q = filters.query;
      if (q && !`${d.brand} ${d.name} ${d.w}x${d.h}`.toLowerCase().includes(q)) return false;
      if (filters.chip === 'all') return true;
      if (filters.chip === 'flagship' || filters.chip === 'top') return d.tag === filters.chip;
      return String(d.year) === filters.chip;
    };

    const choose = (d) => {
      if (opts.mode === 'replace' && opts.instance) {
        opts.instance.deviceId = d.id;
        state.selectedUid = opts.instance.uid;
      } else {
        const inst = { uid: uid(), deviceId: d.id, landscape: false };
        state.instances.push(inst);
        state.selectedUid = inst.uid;
      }
      saveInstances();
      closePicker();
      render();
    };

    const row = (d, { custom = false } = {}) => {
      const r = el('div', 'fx-row-device');
      r.dataset.id = d.id;
      r.setAttribute('role', 'button');
      r.tabIndex = 0;
      const icon = el('span', 'fx-row-icon', custom ? (d.os === 'ios' ? 'iOS' : 'And') : (d.short || '•'));
      r.appendChild(icon);
      r.appendChild(el('span', 'fx-row-name', d.name));
      const meta = el('span', 'fx-row-meta');
      if (d.tag === 'flagship') meta.appendChild(el('span', 'fx-badge fx-badge-flagship', `🔥 ${t('filter_flagship')}`));
      else if (d.tag === 'top') meta.appendChild(el('span', 'fx-badge fx-badge-top', `👑 ${t('filter_top')}`));
      else if (d.year >= years[years.length - 1]) meta.appendChild(el('span', 'fx-badge fx-badge-year', String(d.year)));
      meta.appendChild(el('span', 'fx-row-dims', `${d.w} × ${d.h}`));
      r.appendChild(meta);
      if (custom) {
        r.appendChild(btn('fx-btn-sm fx-btn-icon fx-btn-danger', t('delete_custom'), ICON.close, (e) => {
          e.stopPropagation();
          state.customDevices = state.customDevices.filter((x) => x.id !== d.id);
          state.instances = state.instances.filter((i) => i.deviceId !== d.id);
          state.favorites = state.favorites.filter((x) => x !== d.id);
          saveCustom(); saveInstances(); saveFavorites(); render(); renderList();
        }));
      } else {
        const fav = state.favorites.includes(d.id);
        r.appendChild(btn(`fx-btn-sm fx-btn-icon fx-btn-fav${fav ? ' fx-active' : ''}`, t('favorite'), ICON.heart, (e) => {
          e.stopPropagation();
          state.favorites = fav ? state.favorites.filter((x) => x !== d.id) : [...state.favorites, d.id];
          saveFavorites(); renderList();
        }));
      }
      r.addEventListener('click', () => choose(d));
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(d); } });
      return r;
    };

    const section = (title, icon, cls) => {
      const h = el('div', `fx-picker-section ${cls || ''}`);
      h.innerHTML = `${icon}<span>${title}</span>`;
      return h;
    };

    const renderList = () => {
      list.innerHTML = '';
      let count = 0;
      const favs = state.favorites.map(findDevice).filter(Boolean).filter(matches);
      if (favs.length) {
        list.appendChild(section(t('favorites'), ICON.heart));
        favs.forEach((d) => { list.appendChild(row(d, { custom: d.id.startsWith('custom-') })); count++; });
      }
      const customs = state.customDevices.filter(matches);
      if (customs.length) {
        list.appendChild(section(t('my_devices'), ICON.star));
        customs.forEach((d) => { list.appendChild(row(d, { custom: true })); count++; });
      }
      const brands = [...BRAND_ORDER, ...new Set(PRESETS.map((d) => d.brand).filter((b) => !BRAND_ORDER.includes(b)))];
      brands.forEach((brand) => {
        const devices = PRESETS.filter((d) => d.brand === brand && matches(d));
        if (!devices.length) return;
        const label = brand === 'Laptops' ? t('group_laptops') : brand;
        list.appendChild(section(label, brand === 'Apple' ? ICON.apple : TYPE_ICON[devices[0].type] || ICON.phone));
        devices.forEach((d) => { list.appendChild(row(d)); count++; });
      });
      if (!count) list.appendChild(el('div', 'fx-picker-empty', t('no_results')));
    };
    search.addEventListener('input', () => { filters.query = search.value.trim().toLowerCase(); renderList(); });
    renderList();

    app.appendChild(picker);
    placePopover(picker, anchor, 460);
    search.focus();
    setTimeout(() => root.addEventListener('pointerdown', onOutside), 0);
  }

  function onOutside(e) {
    if (!picker) return;
    const path = e.composedPath();
    if (path.includes(picker) || path.includes(picker._anchor)) return;
    closePicker();
  }
  function closePicker() {
    if (!picker) return;
    picker._anchor?.classList.remove('fx-open');
    picker.remove();
    picker = null;
    root.removeEventListener('pointerdown', onOutside);
  }

  // ------------------------------------------------------------------ stage
  const RING = { phone: 6, tablet: 5, laptop: 4 };
  const BROWSER_UI = { // heights of the browser chrome drawn in "browser" screen mode
    'ios-phone': { top: 50, bottom: 54 }, 'ios-tablet': { top: 92, bottom: 0 },
    'android-phone': { top: 56, bottom: 22 }, 'android-tablet': { top: 92, bottom: 0 },
  };
  const hostOf = (url) => { try { return new URL(url).host.replace(/^www\./, ''); } catch { return url; } };
  const chromeLabel = () => state.settings.customUrl || hostOf(state.url);

  function buildBrowserTop(d) {
    const top = el('div', `fx-browser-top fx-b-${d.os} fx-b-${d.type}`);
    if (d.type === 'tablet') {
      const tabs = el('div', 'fx-b-tabs');
      tabs.innerHTML = `<span class="fx-b-tab"><span class="fx-b-favicon"></span><span class="fx-b-tab-title">${chromeLabel()}</span>${ICON.close}</span><span class="fx-b-newtab">${ICON.plus}</span>`;
      top.appendChild(tabs);
      const bar = el('div', 'fx-b-bar');
      bar.innerHTML = `${ICON.back}${ICON.fwd}${ICON.reload}<span class="fx-b-pill">${ICON.lock}<span class="fx-url-text">${chromeLabel()}</span>${ICON.mic}</span>${ICON.share}${ICON.tabs}${ICON.more}`;
      top.appendChild(bar);
    } else if (d.os === 'ios') {
      top.innerHTML = `<span class="fx-b-side">${ICON.aa}</span><span class="fx-b-pill">${ICON.lock}<span class="fx-url-text">${chromeLabel()}</span></span><span class="fx-b-side">${ICON.share}</span>`;
    } else {
      top.innerHTML = `<span class="fx-b-pill">${ICON.lock}<span class="fx-url-text">${chromeLabel()}</span></span><span class="fx-b-side">${ICON.share}</span><span class="fx-b-side fx-b-tabcount">1</span><span class="fx-b-side">${ICON.more}</span>`;
    }
    return top;
  }
  function buildBrowserBottom(d) {
    const bottom = el('div', `fx-browser-bottom fx-b-${d.os}`);
    if (d.os === 'ios') bottom.innerHTML = `${ICON.back}${ICON.fwd}<span class="fx-b-plus">${ICON.plus}</span><span class="fx-b-tabcount">1</span>${ICON.more}`;
    else bottom.innerHTML = `<span class="fx-b-gesture"></span>`;
    return bottom;
  }

  function buildDeviceCard(instance) {
    const d = findDevice(instance.deviceId);
    const S = state.settings;
    const screenW = instance.landscape ? d.h : d.w;
    const screenH = instance.landscape ? d.w : d.h;
    const showFrame = S.frameStyle !== 'none';
    const bezel = showFrame ? (BEZEL[d.type] || BEZEL.phone) : 0;
    const ring = showFrame ? (RING[d.type] || RING.phone) : 0;
    const realistic = S.realisticUI && d.type !== 'laptop';
    const mode = realistic ? S.screenMode : 'none';
    const statusH = mode === 'pwa' || mode === 'browser' ? (instance.landscape ? 24 : d.statusH ?? STATUS_H[d.cutout] ?? STATUS_H.none) : 0;
    const ui = mode === 'browser' ? (BROWSER_UI[`${d.os}-${d.type}`] || BROWSER_UI['android-phone']) : { top: 0, bottom: 0 };
    const pageH = Math.max(200, screenH - statusH - ui.top - ui.bottom);
    // frames with a physical home button get extra chin/forehead (see .fx-home-button in CSS)
    const chin = d.homeButton && showFrame ? (50 - bezel) + (70 - bezel) : 0;
    const base = d.type === 'laptop' && showFrame ? 22 : 0; // aluminium base drawn under the screen

    // Photo frame: a device render (PNG/AVIF with a transparent screen area) laid
    // over the page, exactly like the original extension does. Declared per device
    // as d.frame = { image, w, h, x, y, mask }. Falls back to the CSS frame.
    const photo = S.frameStyle === 'photo' && d.frame && d.frame.image ? d.frame : null;

    const card = el('div', 'fx-card');
    card.dataset.uid = instance.uid;
    card._screenW = screenW;
    card._screenH = screenH;
    card.addEventListener('pointerdown', (e) => {
      selectInstance(instance.uid);
      if (e.button === 0 && !e.target.closest?.('.fx-btn')) startDrag(e, card);
    });

    const wrap = el('div', 'fx-frame-wrap');
    const cls = ['fx-frame', `fx-${d.type}`, `fx-${d.os}`, `fx-cutout-${d.cutout || 'none'}`, `fx-mode-${mode}`];
    if (instance.landscape) cls.push('fx-landscape');
    if (d.homeButton && showFrame && !photo) cls.push('fx-home-button');
    if (!showFrame) cls.push('fx-noframe');
    if (photo) cls.push('fx-photo');
    const frame = el('div', cls.join(' '));

    const screen = el('div', 'fx-screen');
    const iframe = document.createElement('iframe');
    iframe.className = 'fx-iframe';
    iframe.src = state.url;
    iframe.width = screenW;
    iframe.height = pageH;
    iframe.setAttribute('allow', 'fullscreen; geolocation; camera; microphone; clipboard-write; autoplay');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.addEventListener('load', () => attachScrollSync(iframe));

    if (statusH) {
      const status = el('div', 'fx-statusbar');
      status.innerHTML = `<span class="fx-time"></span><span class="fx-status-icons"><i class="fx-signal"></i><i class="fx-wifi"></i><i class="fx-battery"></i></span>`;
      if (d.statusPad && !instance.landscape) status.style.padding = `0 ${d.statusPad[1]}px 0 ${d.statusPad[0]}px`;
      if (d.statusAlign === 'top') status.style.alignItems = 'flex-start';
      if (d.cutout && d.cutout !== 'none' && !photo) status.appendChild(el('div', `fx-cutout fx-cutout-shape-${d.cutout}`));
      screen.appendChild(status);
    }
    if (ui.top) screen.appendChild(buildBrowserTop(d));
    screen.appendChild(iframe);
    if (ui.bottom) screen.appendChild(buildBrowserBottom(d));
    if (mode === 'fullscreen' && d.cutout && d.cutout !== 'none' && !instance.landscape && !photo) {
      screen.appendChild(el('div', `fx-cutout fx-cutout-overlay fx-cutout-shape-${d.cutout}`));
    }
    frame.appendChild(screen);
    let photoImg = null;
    if (photo) {
      photoImg = el('div', 'fx-photo-img');
      photoImg.style.backgroundImage = `url(${chrome.runtime.getURL(photo.image)})`;
      frame.appendChild(photoImg);
      // the render's screen cut-out has rounded corners: clip the page the same way,
      // otherwise the black corners of the screen show outside the device outline
      if (photo.mask) screen.style.clipPath = `path('${photo.mask}')`;
      else if (photo.r) {
        // one radius per corner (tl tr br bl): the hinge side of a foldable, for
        // instance, needs a bigger radius than the screen cut-out itself
        const rs = Array.isArray(photo.r) ? photo.r : [photo.r, photo.r, photo.r, photo.r];
        const rr = instance.landscape ? [rs[3], rs[0], rs[1], rs[2]] : rs; // rotated 90° ccw
        screen.style.clipPath = `inset(0 round ${rr.map((v) => `${v}px`).join(' ')})`;
      }
    } else if (showFrame) {
      if (d.homeButton) frame.appendChild(el('div', 'fx-home-btn'));
      if (d.type === 'laptop') {
        frame.appendChild(el('div', 'fx-laptop-cam'));
      } else {
        frame.appendChild(el('div', 'fx-side-btn fx-side-power'));
        frame.appendChild(el('div', 'fx-side-btn fx-side-vol-up'));
        frame.appendChild(el('div', 'fx-side-btn fx-side-vol-down'));
      }
    }

    wrap.appendChild(frame);
    card.appendChild(wrap);
    const label = el('div', 'fx-card-label');
    label.innerHTML = `${ICON.grip}<span class="fx-card-name">${d.name}</span><span class="fx-card-dot">•</span><span class="fx-card-dims">${screenW} × ${screenH}</span>`;
    label.title = t('drag_hint');
    card.appendChild(label);
    card.appendChild(btn('fx-btn-sm fx-btn-remove', t('remove'), ICON.close, (e) => {
      e.stopPropagation();
      state.instances = state.instances.filter((i) => i.uid !== instance.uid);
      if (state.selectedUid === instance.uid) state.selectedUid = null;
      saveInstances();
      render();
    }));

    const overhang = base && !photo ? LAPTOP_OVERHANG : 0;
    const outerW0 = photo ? (instance.landscape ? photo.h : photo.w) : screenW + 2 * (bezel + ring) + (instance.landscape ? chin : 0) + 2 * overhang;
    const outerH0 = photo ? (instance.landscape ? photo.w : photo.h) : screenH + 2 * (bezel + ring) + (instance.landscape ? 0 : chin) + base;
    card._outerW = outerW0;
    card._outerH = outerH0;
    card._maxScale = () => Math.min(1, (card.clientHeight - label.offsetHeight - 44) / outerH0, (card.clientWidth - 44) / outerW0);
    card._fit = (forced) => {
      const avail = card.clientHeight - label.offsetHeight - 44;
      const availW = card.clientWidth - 44;
      const dpr = window.devicePixelRatio || 1;
      // Every edge of the page must land on a whole device pixel, otherwise the
      // compositor filters the iframe layer and a light seam shows around the
      // page while it scrolls. Pick a scale that makes the screen width an
      // integer number of device pixels, then size every strip (ring, bezel,
      // status bar, browser bars, chin) so their scaled sizes are integers too.
      let s = forced ?? Math.min(1, avail / outerH0, availW / outerW0);
      s = Math.max(0.05, Math.floor(screenW * s * dpr) / (screenW * dpr));
      const snap = (v) => (v ? Math.round(v * s * dpr) / (s * dpr) : 0);
      const bz = snap(bezel), rg = snap(ring), st = snap(statusH), bt = snap(ui.top), bb = snap(ui.bottom);
      const ph = Math.ceil(pageH * s * dpr) / (s * dpr); // page viewport grows by < 1px
      const chinA = d.homeButton && showFrame ? snap(50) : 0, chinB = d.homeButton && showFrame ? snap(70) : 0;
      const chinTotal = chinA && chinB ? chinA + chinB - 2 * bz : 0;
      const oh = snap(overhang);
      let oW = screenW + 2 * (bz + rg) + (instance.landscape ? chinTotal : 0);
      let oH = st + bt + ph + bb + 2 * (bz + rg) + (instance.landscape ? 0 : chinTotal) + base;
      if (photo) {
        // the render fixes the outer size; the screen sits at (x, y) inside it.
        // In landscape the portrait render is rotated 90° counter-clockwise, so a
        // point (u, v) of the render lands at (v, W - u).
        let px = photo.x, py = photo.y;
        if (instance.landscape) { px = photo.y; py = photo.w - photo.x - d.w; }
        px = snap(px); py = snap(py);
        oW = snap(instance.landscape ? photo.h : photo.w);
        oH = snap(instance.landscape ? photo.w : photo.h);
        screen.style.left = `${px}px`;
        screen.style.top = `${py}px`;
        screen.style.width = `${screenW}px`;
        screen.style.height = `${st + bt + ph + bb}px`;
        if (photoImg) {
          // the image element always has the render's portrait size; rotate it into place
          photoImg.style.width = `${snap(photo.w)}px`;
          photoImg.style.height = `${snap(photo.h)}px`;
          photoImg.style.left = instance.landscape ? `${(oW - snap(photo.w)) / 2}px` : '0';
          photoImg.style.top = instance.landscape ? `${(oH - snap(photo.h)) / 2}px` : '0';
          photoImg.style.transform = instance.landscape ? 'rotate(-90deg)' : '';
        }
      }
      frame.style.setProperty('--bezel', `${bz}px`);
      frame.style.setProperty('--ring-w', `${rg}px`);
      frame.style.setProperty('--status-h', `${st}px`);
      frame.style.setProperty('--btop-h', `${bt}px`);
      frame.style.setProperty('--bbottom-h', `${bb}px`);
      if (chinTotal) { frame.style.setProperty('--chin-a', `${chinA}px`); frame.style.setProperty('--chin-b', `${chinB}px`); }
      iframe.style.height = `${ph}px`;
      frame.style.width = `${oW}px`;
      frame.style.height = `${oH}px`;
      frame.style.setProperty('--overhang', `${oh}px`);
      frame.style.left = `${oh * s}px`; // leave room for the laptop base on the left
      wrap.style.width = `${Math.round((oW + 2 * oh) * s)}px`;
      wrap.style.height = `${Math.round(oH * s)}px`;
      // CSS zoom instead of transform: the page inside the iframe is laid out and
      // rasterised at the final size, so the compositor never has to filter a
      // scaled layer edge. The iframe still reports its real viewport size to the
      // site; only its devicePixelRatio changes.
      frame.style.transform = '';
      frame.style.zoom = String(s);
      // nudge the wrapper (layout offset, not a transform) so the frame origin
      // sits on a whole device pixel
      wrap.style.left = '0px';
      wrap.style.top = '0px';
      const r = frame.getBoundingClientRect();
      wrap.style.left = `${Math.round(r.left * dpr) / dpr - r.left}px`;
      wrap.style.top = `${Math.round(r.top * dpr) / dpr - r.top}px`;
    };
    return card;
  }

  function updateChrome() {
    const label = chromeLabel();
    root.querySelectorAll('.fx-url-text, .fx-b-tab-title').forEach((e) => { e.textContent = label; });
  }

  function render() {
    closePicker();
    stage.innerHTML = '';
    if (!state.instances.length) {
      stage.appendChild(el('div', 'fx-empty', t('empty_stage')));
      updateToolbar();
      return;
    }
    state.instances.forEach((i, idx) => {
      const c = buildDeviceCard(i);
      c.style.order = idx * 2;
      stage.appendChild(c);
      if (idx < state.instances.length - 1) {
        const sp = el('div', 'fx-splitter');
        sp.style.order = idx * 2 + 1;
        sp.title = t('resize_hint');
        sp.addEventListener('pointerdown', (e) => startResize(e, idx));
        sp.addEventListener('dblclick', equalizeColumns);
        stage.appendChild(sp);
      }
    });
    if (state.settings.layout === 'proportional') {
      state.instances.forEach((i) => { const c = stage.querySelector(`.fx-card[data-uid="${i.uid}"]`); if (c?._outerW) i.weight = Math.round(c._outerW); });
    }
    applyColumns();
    if (!state.instances.some((i) => i.uid === state.selectedUid)) state.selectedUid = state.instances[0].uid;
    selectInstance(state.selectedUid);
    fitAll();
    tickClock();
  }

  const fitAll = () => {
    const cards = [...stage.querySelectorAll('.fx-card')].filter((c) => c._fit);
    if (state.settings.layout === 'proportional' && cards.length > 1) {
      const shared = Math.min(...cards.map((c) => c._maxScale()));
      cards.forEach((c) => c._fit(shared));
    } else {
      cards.forEach((c) => c._fit());
    }
  };

  function reloadFrames() {
    stage.querySelectorAll('.fx-iframe').forEach((f) => { f.src = state.url; });
  }

  function tickClock() {
    if (!alive()) return teardown();
    const now = new Date();
    const custom = state.settings.customTime && /^\d{1,2}:\d{2}$/.test(state.settings.customTime) ? state.settings.customTime : null;
    const txt = custom || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    root.querySelectorAll('.fx-time').forEach((e) => (e.textContent = txt));
  }

  // --------------------------------------------------------- drag to reorder
  // Cards are reordered through the grid `order` property: moving an <iframe>
  // in the DOM would reload the page inside it.
  const orderedCards = () => [...stage.querySelectorAll('.fx-card')].sort((a, b) => Number(a.style.order) - Number(b.style.order));

  function startDrag(e, card) {
    const startX = e.clientX, startY = e.clientY;
    let active = false;
    try { card.setPointerCapture(e.pointerId); } catch { /* synthetic event */ }

    const move = (ev) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        active = true;
        stage.classList.add('fx-dragging');
        card.classList.add('fx-drag');
      }
      const over = root.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n.classList?.contains('fx-card') && n !== card);
      if (!over) return;
      const r = over.getBoundingClientRect();
      const cards = orderedCards().filter((c) => c !== card);
      let idx = cards.indexOf(over);
      if (ev.clientX >= r.left + r.width / 2) idx += 1;
      cards.splice(idx, 0, card);
      cards.forEach((c, i) => { c.style.order = i * 2; });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (!active) return;
      stage.classList.remove('fx-dragging');
      card.classList.remove('fx-drag');
      const order = orderedCards().map((c) => c.dataset.uid);
      state.instances.sort((a, b) => order.indexOf(a.uid) - order.indexOf(b.uid));
      applyColumns();
      saveInstances();
      fitAll();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ------------------------------------------------------ resizable columns
  // Each instance carries a `weight`; the grid template is rebuilt from the
  // instances in visual order, with an 8px splitter column between devices.
  // ------------------------------------------------------------ layout menu
  function toggleLayoutMenu() {
    if (layoutMenu) return closeLayoutMenu();
    closePicker(); closeSettings();
    layoutMenu = el('div', 'fx-popover fx-menu');
    layoutBtn.classList.add('fx-open');
    const item = (key, label, icon, active) => {
      const b = el('button', `fx-menu-item${active ? ' fx-active' : ''}`);
      b.type = 'button';
      b.innerHTML = `${icon}<span>${label}</span>`;
      b.addEventListener('click', () => { closeLayoutMenu(); key === 'equal' ? equalizeColumns() : proportionalColumns(); });
      layoutMenu.appendChild(b);
    };
    item('equal', t('layout_equal'), ICON.columns, state.settings.layout === 'equal');
    item('proportional', t('layout_proportional'), ICON.proportional, state.settings.layout === 'proportional');
    app.appendChild(layoutMenu);
    placePopover(layoutMenu, layoutBtn, 300);
    setTimeout(() => root.addEventListener('pointerdown', onOutsideLayoutMenu), 0);
  }
  function onOutsideLayoutMenu(e) {
    if (!layoutMenu) return;
    const path = e.composedPath();
    if (path.includes(layoutMenu) || path.includes(layoutBtn)) return;
    closeLayoutMenu();
  }
  function closeLayoutMenu() {
    if (!layoutMenu) return;
    layoutBtn.classList.remove('fx-open');
    layoutMenu.remove();
    layoutMenu = null;
    root.removeEventListener('pointerdown', onOutsideLayoutMenu);
  }

  // every column the same width; each device scaled to fit its own column
  function equalizeColumns() {
    state.settings.layout = 'equal';
    state.instances.forEach((i) => { i.weight = 1; });
    applyColumns();
    saveSettings(); saveInstances();
    fitAll();
  }
  // columns proportional to each device's real size, and one shared scale for
  // all of them, so a Pro Max really looks bigger than a mini
  function proportionalColumns() {
    state.settings.layout = 'proportional';
    state.instances.forEach((i) => {
      const card = stage.querySelector(`.fx-card[data-uid="${i.uid}"]`);
      i.weight = card && card._outerW ? Math.round(card._outerW) : 1;
    });
    applyColumns();
    saveSettings(); saveInstances();
    fitAll();
  }

  function applyColumns() {
    if (!state.instances.length) { stage.style.gridTemplateColumns = ''; return; }
    stage.style.gridTemplateColumns = state.instances.map((i) => `minmax(0, ${i.weight || 1}fr)`).join(' 8px ');
  }

  function startResize(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    const cards = orderedCards();
    const insts = cards.map((c) => state.instances.find((i) => i.uid === c.dataset.uid));
    const px = cards.map((c) => c.getBoundingClientRect().width);
    const startX = e.clientX, left = px[idx], right = px[idx + 1], min = 140;
    if (left + right < min * 2) return;
    stage.classList.add('fx-resizing');
    let raf = 0;
    if (state.settings.layout === 'proportional') { state.settings.layout = 'manual'; saveSettings(); }
    const move = (ev) => {
      const nl = Math.min(Math.max(left + (ev.clientX - startX), min), left + right - min);
      px[idx] = nl;
      px[idx + 1] = left + right - nl;
      insts.forEach((i, k) => { if (i) i.weight = Math.round(px[k]); });
      applyColumns();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fitAll);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      stage.classList.remove('fx-resizing');
      saveInstances();
      fitAll();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  // ------------------------------------------------------------------ sync
  // Frames that share the top page's origin expose their window: navigation in
  // one frame is mirrored to the others, and scrolling is mirrored by fraction.
  const frames = () => (stage ? [...stage.querySelectorAll('.fx-iframe')] : []);
  const frameHref = (f) => { try { return f.contentWindow.location.href; } catch { return null; } };

  function pollNavigation() {
    if (!alive()) return teardown();
    const fs = frames();
    for (const f of fs) {
      const href = frameHref(f);
      if (!href || href === 'about:blank' || href === state.url) continue;
      state.url = href;
      updateChrome();
      fs.forEach((o) => { if (o !== f && frameHref(o) !== href) o.src = href; });
      break;
    }
  }

  const HIDE_SCROLLBAR_CSS = '*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';

  function attachScrollSync(iframe) {
    try {
      const w = iframe.contentWindow;
      // same-origin frames: hide scrollbars from here too (the worker also injects
      // this CSS into every frame, but this path works even if the worker is stale)
      const doc = w.document;
      if (doc && !doc.getElementById('flexi-device-scrollbar')) {
        const st = doc.createElement('style');
        st.id = 'flexi-device-scrollbar';
        st.textContent = HIDE_SCROLLBAR_CSS;
        (doc.head || doc.documentElement).appendChild(st);
      }
      if (w._flexiScrollSync) return;
      w._flexiScrollSync = true;
      iframe._lastY = w.scrollY;
      w.addEventListener('scroll', () => onFrameScroll(iframe), { passive: true });
    } catch { /* cross-origin frame: nothing to sync */ }
  }

  // Each target moves by whichever is smaller: the proportional position (same
  // fraction of its own page) or the same pixel distance the source moved. So a
  // long mobile page never races ahead when a short tablet page is scrolled,
  // while scrolling the mobile still moves the tablet proportionally.
  function onFrameScroll(source) {
    if (!state.settings.syncScroll) return;
    let y, delta, fraction;
    try {
      const w = source.contentWindow, doc = w.document.documentElement;
      y = w.scrollY;
      delta = y - (source._lastY ?? y);
      source._lastY = y;
      if (source._syncedAt && performance.now() - source._syncedAt < 200) return; // echo of our own scrollTo
      const max = doc.scrollHeight - w.innerHeight;
      fraction = max > 0 ? y / max : 0;
    } catch { return; }
    if (!delta && !y) return;
    frames().forEach((o) => {
      if (o === source) return;
      try {
        const w = o.contentWindow, doc = w.document.documentElement;
        const max = Math.max(0, doc.scrollHeight - w.innerHeight);
        const cur = w.scrollY;
        const byFraction = fraction * max;
        const byDelta = cur + delta;
        const pick = Math.abs(byFraction - cur) <= Math.abs(byDelta - cur) ? byFraction : byDelta;
        const target = Math.round(Math.min(max, Math.max(0, pick)));
        if (Math.abs(cur - target) < 1) return;
        o._syncedAt = performance.now();
        o._lastY = target;
        w.scrollTo({ top: target, behavior: 'instant' });
      } catch { /* cross-origin */ }
    });
  }

  // -------------------------------------------------------------- screenshot
  async function screenshot(card, device, w, h) {
    const frame = card.querySelector('.fx-frame');
    const b = card.querySelector('.fx-btn-shot');
    b && b.classList.add('fx-busy');
    try {
      // captureVisibleTab only sees what is on screen: bring the device into view first
      card.classList.add('fx-capturing');
      card.scrollIntoView({ inline: 'center', block: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 150));
      const res = await chrome.runtime.sendMessage({ action: 'captureVisibleTab' });
      if (!res?.ok) throw new Error(res?.error || 'capture failed');
      const img = new Image();
      await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = res.dataUrl; });
      const r = frame.getBoundingClientRect();
      const dpr = img.naturalWidth / window.innerWidth;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.getContext('2d').drawImage(img, r.left * dpr, r.top * dpr, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${device.name.replace(/[^\w-]+/g, '-')}-${w}x${h}.png`;
      a.click();
    } catch (e) {
      console.error('[Flexi Device]', e);
      toast(t('screenshot_failed'));
    } finally {
      card.classList.remove('fx-capturing');
      b && b.classList.remove('fx-busy');
    }
  }

  function toast(text) {
    const n = el('div', 'fx-toast', text);
    app.appendChild(n);
    setTimeout(() => n.classList.add('fx-show'), 10);
    setTimeout(() => { n.classList.remove('fx-show'); setTimeout(() => n.remove(), 300); }, 2500);
  }

  // ------------------------------------------------------ custom device modal
  function openModal() {
    closeModal();
    modal = el('div', 'fx-modal-backdrop');
    const box = el('form', 'fx-modal');
    box.innerHTML = `
      <h2>${t('custom_title')}</h2>
      <label>${t('custom_name')}<input name="name" required maxlength="40"></label>
      <div class="fx-row">
        <label>${t('custom_width')}<input name="w" type="number" min="200" max="4000" required value="390"></label>
        <label>${t('custom_height')}<input name="h" type="number" min="200" max="4000" required value="844"></label>
      </div>
      <div class="fx-row">
        <label>${t('custom_type')}<select name="type"><option value="phone">${t('type_phone')}</option><option value="tablet">${t('type_tablet')}</option><option value="laptop">${t('type_laptop')}</option></select></label>
        <label>${t('custom_os')}<select name="os"><option value="ios">${t('os_ios')}</option><option value="android">${t('os_android')}</option></select></label>
      </div>
      <div class="fx-modal-actions">
        <button type="button" class="fx-btn fx-btn-text fx-cancel">${t('cancel')}</button>
        <button type="submit" class="fx-btn fx-btn-primary">${t('save')}</button>
      </div>`;
    box.querySelector('.fx-cancel').addEventListener('click', closeModal);
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(box);
      const type = f.get('type');
      const os = type === 'laptop' ? 'desktop' : f.get('os');
      const d = {
        id: `custom-${Date.now()}`,
        name: String(f.get('name')).trim(),
        brand: 'custom',
        w: Number(f.get('w')), h: Number(f.get('h')),
        type, os, year: new Date().getFullYear(),
        cutout: type === 'phone' ? (os === 'ios' ? 'island' : 'punch') : 'none',
      };
      state.customDevices.push(d);
      state.instances.push({ uid: uid(), deviceId: d.id, landscape: false });
      saveCustom(); saveInstances(); render(); closeModal();
    });
    modal.appendChild(box);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    app.appendChild(modal);
    box.querySelector('input[name=name]').focus();
  }
  function closeModal() { if (modal) { modal.remove(); modal = null; } }

  // ------------------------------------------------------------------ close
  async function closeSimulator() {
    teardown();
    try { await chrome.runtime.sendMessage({ action: 'close' }); } catch { /* worker gone */ }
  }
  function teardown() {
    clearInterval(clockTimer);
    clearInterval(navTimer);
    closePicker(); closeSettings(); closeModal(); closeLayoutMenu();
    window.removeEventListener('unhandledrejection', onInvalidated);
    window.removeEventListener('error', onInvalidated);
    window.removeEventListener('resize', fitAll);
    host.remove();
    document.documentElement.style.overflow = prevOverflow;
    delete window.__flexiDevice;
  }

  // Last line of defence: once the context is gone, swallow this script's own
  // "Extension context invalidated" errors and dismantle the UI.
  const onInvalidated = (e) => {
    const msg = String(e?.reason?.message || e?.message || e?.reason || '');
    if (msg.includes('Extension context invalidated')) { e.preventDefault?.(); if (window.__flexiDevice) teardown(); }
  };
  window.addEventListener('unhandledrejection', onInvalidated);
  window.addEventListener('error', onInvalidated);

  // ------------------------------------------------------------------- boot
  let clockTimer, navTimer;
  (async () => {
    await Promise.all([loadState(), cssReady]);
    applyTheme();
    app.appendChild(buildToolbar());
    stage = el('div', 'fx-stage');
    app.appendChild(stage);
    render();
    updateToolbar();
    requestAnimationFrame(fitAll);
    clockTimer = setInterval(tickClock, 15000);
    navTimer = setInterval(pollNavigation, 400);
    window.addEventListener('resize', fitAll);
    new ResizeObserver(fitAll).observe(stage);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); closePicker(); closeSettings(); closeLayoutMenu(); } });
    window.addEventListener('blur', () => setTimeout(() => {
      const active = root.activeElement;
      const card = active?.classList?.contains('fx-iframe') && active.closest('.fx-card');
      if (card && card.dataset.uid !== state.selectedUid) selectInstance(card.dataset.uid);
    }, 0));
    window.__flexiDevice = { render, teardown, alive };
  })();
})();
