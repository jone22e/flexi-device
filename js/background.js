// Flexi Device — background service worker (Manifest V3)
//
// Responsibilities:
//  - toggle the simulator per tab (action click / context menu)
//  - install per-tab declarativeNetRequest session rules so the site can be
//    iframed (strip X-Frame-Options / CSP) and sees a mobile user agent
//  - inject the content script + stylesheet, and re-inject after navigations
//  - answer messages from the content script (screenshot, settings, UA change)

const RESTRICTED_PREFIXES = [
  'chrome://', 'chrome-extension://', 'edge://', 'opera://', 'brave://', 'about:',
  'view-source:', 'devtools://', 'data:', 'https://chromewebstore.google.com/',
  'https://chrome.google.com/webstore',
];

const USER_AGENTS = {
  ios: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    mobile: '?1',
    platform: '"iOS"',
  },
  android: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
    mobile: '?1',
    platform: '"Android"',
  },
  desktop: null,
};

// Rule id namespaces, offset by tab id so rules never collide between tabs.
const RULE_FRAME = 1000000;   // strip anti-framing response headers
const RULE_UA = 2000000;      // mobile user agent request headers
const RULE_FETCH = 3000000;   // make sub_frame requests look like top-level navigations

/** tabId -> { origin } for tabs where the simulator is active.
 * Kept in memory for speed, mirrored to chrome.storage.session so it survives
 * the service worker being shut down (Chrome kills it after ~30 s idle). Without
 * that, a page reload (Vite HMR, F5) would find no active tab and never re-inject. */
const activeTabs = new Map();
const ready = chrome.storage.session.get('activeTabs').then(({ activeTabs: saved }) => {
  for (const [id, info] of Object.entries(saved || {})) activeTabs.set(Number(id), info);
}).catch(() => {});
const persistActive = () => chrome.storage.session.set({ activeTabs: Object.fromEntries(activeTabs) }).catch(() => {});
/** memory first, then session storage (covers a worker that was restarted) */
async function isActive(tabId) {
  await ready;
  if (activeTabs.has(tabId)) return true;
  const { activeTabs: saved } = await chrome.storage.session.get('activeTabs').catch(() => ({}));
  if (saved && saved[tabId]) { activeTabs.set(tabId, saved[tabId]); return true; }
  return false;
}

const isRestricted = (url) => !url || RESTRICTED_PREFIXES.some((p) => url.startsWith(p));

async function getHeaderType() {
  const { headerType } = await chrome.storage.local.get('headerType');
  return headerType && USER_AGENTS[headerType] !== undefined ? headerType : 'ios';
}

function buildRules(tabId, headerType) {
  const rules = [
    {
      id: RULE_FRAME + tabId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
          { header: 'content-security-policy-report-only', operation: 'remove' },
        ],
      },
      condition: { resourceTypes: ['main_frame', 'sub_frame'], tabIds: [tabId] },
    },
    {
      id: RULE_FETCH + tabId,
      priority: 3,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Sec-Fetch-Dest', operation: 'set', value: 'document' },
          { header: 'Sec-Fetch-Mode', operation: 'set', value: 'navigate' },
          { header: 'Sec-Fetch-Site', operation: 'set', value: 'none' },
          { header: 'Sec-Fetch-User', operation: 'set', value: '?1' },
        ],
      },
      condition: { resourceTypes: ['sub_frame'], tabIds: [tabId] },
    },
  ];
  const ua = USER_AGENTS[headerType];
  if (ua) {
    rules.push({
      id: RULE_UA + tabId,
      priority: 2,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'user-agent', operation: 'set', value: ua.userAgent },
          { header: 'sec-ch-ua-mobile', operation: 'set', value: ua.mobile },
          { header: 'sec-ch-ua-platform', operation: 'set', value: ua.platform },
        ],
      },
      condition: {
        resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'font', 'media', 'other'],
        tabIds: [tabId],
      },
    });
  }
  return rules;
}

const ruleIdsFor = (tabId) => [RULE_FRAME + tabId, RULE_UA + tabId, RULE_FETCH + tabId];

async function applyRules(tabId, headerType) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: ruleIdsFor(tabId),
    addRules: buildRules(tabId, headerType),
  });
}

async function removeRules(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ruleIdsFor(tabId) });
}

// Pages inside the device frames should look like a real phone: no scrollbars.
const HIDE_SCROLLBAR_CSS = '*{scrollbar-width:none!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
async function hideScrollbars(tabId, frameId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId, frameIds: [frameId] }, css: HIDE_SCROLLBAR_CSS });
  } catch { /* frame gone or not injectable */ }
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['js/devices.js', 'js/content.js'] });
}

// Resolves once the tab has finished loading. Checks the current status first:
// fast pages (a local Vite server, for instance) reach "complete" before an
// async caller gets to register the listener, and the event would be missed.
const waitForComplete = async (tabId) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.status === 'complete') return;
  await new Promise((resolve) => {
    const done = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, 15000);
    chrome.tabs.onUpdated.addListener(listener);
  });
};

async function enable(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (isRestricted(tab.url)) {
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#dc2626' });
    await chrome.action.setTitle({ tabId, title: chrome.i18n.getMessage('restricted_page') });
    return;
  }
  const headerType = await getHeaderType();
  await applyRules(tabId, headerType);
  activeTabs.set(tabId, { origin: new URL(tab.url).origin });
  await persistActive();
  await waitForComplete(tabId);
  await inject(tabId);
  await chrome.action.setBadgeText({ tabId, text: 'ON' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
}

async function disable(tabId, { reload = true } = {}) {
  activeTabs.delete(tabId);
  await persistActive();
  await removeRules(tabId).catch(() => {});
  await chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  if (reload) await chrome.tabs.reload(tabId).catch(() => {});
}

async function toggle(tabId) {
  if (await isActive(tabId)) await disable(tabId);
  else await enable(tabId);
}

// ---------------------------------------------------------------- listeners

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'flexi-device-toggle',
    title: chrome.i18n.getMessage('toggle_menu'),
    contexts: ['page', 'action'],
  });
});

chrome.action.onClicked.addListener((tab) => toggle(tab.id).catch((e) => console.error('toggle', e)));

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'flexi-device-toggle' && tab?.id != null) toggle(tab.id).catch(console.error);
});

// Re-inject after a top-level navigation while the simulator is active
// (user reloaded, or the URL bar inside the simulator navigated the tab).
chrome.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (!(await isActive(tabId))) return;
  if (frameId !== 0) return hideScrollbars(tabId, frameId);
  if (isRestricted(url)) return disable(tabId, { reload: false });
  activeTabs.set(tabId, { origin: new URL(url).origin });
  persistActive();
  await waitForComplete(tabId);
  inject(tabId).catch((e) => {
    console.error('re-inject failed', e);
    disable(tabId, { reload: false });
  });
});

// late fallback: some documents only accept CSS once loading has finished
chrome.webNavigation.onCompleted.addListener(async ({ tabId, frameId }) => {
  if (frameId !== 0 && (await isActive(tabId))) hideScrollbars(tabId, frameId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (await isActive(tabId)) disable(tabId, { reload: false });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  switch (msg?.action) {
    case 'ping':
      isActive(tabId).then((active) => sendResponse({ active }));
      return true;
    case 'close':
      disable(tabId).then(() => sendResponse({ ok: true }));
      return true;

    case 'isActive':
      isActive(tabId).then((active) => sendResponse({ active }));
      return true;

    case 'setHeaderType': {
      const headerType = USER_AGENTS[msg.value] !== undefined ? msg.value : 'ios';
      chrome.storage.local.set({ headerType }).then(async () => {
        if (activeTabs.has(tabId)) await applyRules(tabId, headerType);
        sendResponse({ ok: true });
      });
      return true;
    }

    case 'captureVisibleTab':
      chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' })
        .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
        .catch((e) => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'openLink':
      chrome.tabs.create({ url: msg.url });
      return false;

    default:
      return false;
  }
});
