if (!window.browser) {
    browser = chrome;
}

// ── Constants ────────────────────────────────────────────────────────────────


const DEFAULT_SETTINGS = {
    filterReposts: {enabled: false, type: "allowRepostedTracksOfFollowers"},
    trackLengthInMin: {enabled: false, min: 0, max: 30},
    contentAgeInDays: {enabled: false, min: null, max: null},
    freeDownloadsOnly: {enabled: false},
    alreadySeen: {enabled: true},
    playlistFilter: {enabled: false, mode: "hideLarge", nameInTitles: false},
    tagFilter: {enabled: false, mode: "include", tags: []},
};

const VALID_FILTER_REPOSTS_TYPES = new Set([
    "allowNone",
    "allowRepostedTracksOfFollowers",
    "allowOnlyFromNotFollowing",
]);

const VALID_PLAYLIST_FILTER_MODES = new Set(["hideLarge", "hideAll"]);

// External links shown in the global settings panel.
const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/toaster2";
const GITHUB_ISSUES_URL = "https://github.com/Toasbi/sc-filter-extended/issues";

// ── Pure: settings helpers ────────────────────────────────────────────────────

// Deep-merges `stored` into `defaults`, applying defaults for any key
// that is absent or has the wrong type in `stored`.
function deepMerge(defaults, stored) {
    if (stored === null || typeof stored !== "object") stored = {};
    const result = {};
    for (const key of Object.keys(defaults)) {
        if (defaults[key] !== null && typeof defaults[key] === "object" && !Array.isArray(defaults[key])) {
            result[key] = deepMerge(defaults[key], stored[key] != null ? stored[key] : null);
        } else if (key in stored && (
            typeof stored[key] === typeof defaults[key] ||
            (defaults[key] === null && (stored[key] === null || typeof stored[key] === "number"))
        )) {
            result[key] = stored[key];
        } else {
            result[key] = defaults[key];
        }
    }
    return result;
}

// Produces a fully-valid FilterSettings from untrusted stored data.
// Note: typeof null === "object", so deepMerge's object-recursion branch is guarded
// with `defaults[key] !== null` to handle null default leaf values (min/max of
// contentAgeInDays). The Array.isArray guard is load-bearing — do not remove.
function sanitizeSettings(stored) {
    const s = deepMerge(DEFAULT_SETTINGS, stored);
    if (!VALID_FILTER_REPOSTS_TYPES.has(s.filterReposts.type)) {
        s.filterReposts.type = "allowNone";
    }
    if (!Array.isArray(s.tagFilter.tags)) {
        s.tagFilter.tags = [];
    }
    if (!VALID_PLAYLIST_FILTER_MODES.has(s.playlistFilter.mode)) {
        s.playlistFilter.mode = "hideLarge";
    }
    return s;
}

// ── Pure: content age UI ↔ storage conversion ─────────────────────────────

// Left knob sentinel: 0 in UI = null (no min) in storage.
function uiToStorageMin(val) {
    return val === 0 ? null : val;
}

function storageToUiMin(val) {
    return val === null ? 0 : val;
}

// Right knob sentinel: 31 in UI = null (no limit) in storage.
function uiToStorageMax(val) {
    return val === 31 ? null : val;
}

function storageToUiMax(val) {
    return val === null ? 31 : val;
}

// Returns the display label for the content age slider.
// Both arguments are storage values (null = no constraint).
function caLabel(min, max) {
    if (min === null && max === null) return "No filter applied";
    const parts = [];
    if (min !== null) parts.push(`Feed age ≥ ${min} days`);
    if (max !== null) parts.push(`Uploaded ≤ ${max} days ago`);
    return parts.join(", ");
}

// ── Pure: tab helpers ─────────────────────────────────────────────────────────

function buildDefaultTabs() {
    return [
        {
            id: "default",
            name: "Default",
            type: "settings",
            settings: sanitizeSettings({}),
        },
        {
            id: "noReposts",
            name: "No reposts",
            type: "settings",
            settings: sanitizeSettings({
                filterReposts: {enabled: true, type: "allowNone"},
            }),
        },
        {
            id: "notFollowing",
            name: "Not following",
            type: "settings",
            settings: sanitizeSettings({
                filterReposts: {enabled: true, type: "allowOnlyFromNotFollowing"},
            }),
        },
        {
            id: "onlySinglesFollowed",
            name: "Only singles by followed",
            type: "settings",
            settings: sanitizeSettings({
                filterReposts: {enabled: true, type: "allowRepostedTracksOfFollowers"},
                trackLengthInMin: {enabled: true, min: 0, max: 20},
                playlistFilter: {enabled: true, mode: "hideLarge", nameInTitles: true}
            }),
        },
        {
            id: "onlyMixesByFollowed",
            name: "Only mixes by followed",
            type: "settings",
            settings: sanitizeSettings({
                filterReposts: {enabled: true, type: "allowNone"},
                trackLengthInMin: {enabled: true, min: 45, max: 120},
                playlistFilter: {enabled: true, mode: "hideLarge", nameInTitles: true},
            }),
        },
        {
            id: "onlyMixesDowntempo",
            name: "Downtempo mixes",
            type: "settings",
            settings: sanitizeSettings({
                trackLengthInMin: {enabled: true, min: 45, max: 120},
                playlistFilter: {enabled: true, mode: "hideLarge", nameInTitles: true},
                tagFilter: {enabled: true, mode: "include", tags: ["downtempo"]}
            }),
        },
        {
            id: "onlyFreeDl",
            name: "Free Downloads",
            type: "settings",
            settings: sanitizeSettings({
                freeDownloadsOnly: {enabled: true},
                trackLengthInMin: {enabled: true, min: 0, max: 20},
                playlistFilter: {enabled: true, mode: "hideLarge", nameInTitles: true}
            }),
        },
        {
            id: "onlyFreeDlNew",
            name: "New Free Downloads",
            type: "settings",
            settings: sanitizeSettings({
                freeDownloadsOnly: {enabled: true},
                trackLengthInMin: {enabled: true, min: 0, max: 20},
                contentAgeInDays: {enabled: true, min: null, max: 7},
                playlistFilter: {enabled: true, mode: "hideLarge", nameInTitles: true}
            }),
        },
        {
            id: "deepCuts",
            name: "Deep cuts",
            type: "deepCuts",
        },
    ];
}

// Returns a name that does not collide with existingNames.
// Appends " (2)", " (3)" etc. until unique. Case-sensitive exact match.
function uniqueName(name, existingNames) {
    const nameSet = new Set(existingNames);
    if (!nameSet.has(name)) return name;
    let n = 2;
    while (nameSet.has(`${name} (${n})`)) n++;
    return `${name} (${n})`;
}

// Returns tabs with the entry matching `id` removed and the new active id.
// Precondition: tabs.length > 1 (caller must not call when only 1 tab remains).
function tabsAfterDelete(tabs, id) {
    const idx = tabs.findIndex((t) => t.id === id);
    const newTabs = tabs.filter((t) => t.id !== id);
    const newActiveIdx = idx > 0 ? idx - 1 : 0;
    return {tabs: newTabs, newActiveId: newTabs[newActiveIdx].id};
}

// ── Impure: storage ───────────────────────────────────────────────────────────

async function loadState() {
    try {
        const stored = await browser.storage.sync.get([
            "scFilterTabs",
            "scActiveTabId",
            "scfDebug",
        ]);

        let tabs = Array.isArray(stored.scFilterTabs) ? stored.scFilterTabs : null;
        if (!tabs) {
            tabs = buildDefaultTabs();
        } else {
            tabs = tabs
                .filter((t) => t && (t.type === "settings" || t.type === "deepCuts"))
                .map((t) => {
                    if (t.type === "settings") {
                        return {...t, settings: sanitizeSettings(t.settings)};
                    }
                    return t;
                });
            if (tabs.length === 0) tabs = buildDefaultTabs();
        }

        const activeTabId = tabs.some((t) => t.id === stored.scActiveTabId)
            ? stored.scActiveTabId
            : tabs[0].id;

        const debug = stored.scfDebug === true;

        return {tabs, activeTabId, debug};
    } catch (_e) {
        const tabs = buildDefaultTabs();
        return {tabs, activeTabId: tabs[0].id, debug: false};
    }
}

async function save(tabs, activeTabId) {
    await browser.storage.sync.set({scFilterTabs: tabs, scActiveTabId: activeTabId});
}

// Writes the active tab config (plus the debug flag) to the DOM and notifies
// filter.js. intent must be "reset-feed" (rebuild the feed from scratch) or
// "update-only" (swap the config for future requests, keep the feed as-is).
// The event payload is a plain string — objects don't cross the
// content-script ↔ page boundary cleanly in Firefox.
function applyConfig(tabConfig, debug, intent) {
    document.documentElement.dataset.scfConfig = JSON.stringify({...tabConfig, debug});
    document.dispatchEvent(new CustomEvent("scf:apply-config", {detail: intent}));
}

// Persists state, then pushes the new active config into the page and asks
// filter.js to rebuild the feed in place (no page reload). If the in-place
// rebuild fails, filter.js itself falls back to window.location.reload() —
// state is already persisted at that point, so the reload boots into the
// correct tab either way.
async function saveAndResetFeed(tabs, activeTabId) {
    await save(tabs, activeTabId);
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
    const {debug} = await loadState();
    applyConfig(activeTab, debug, "reset-feed");
}

// ── Impure: script injection ──────────────────────────────────────────────────

// Injects filter.js into the page context and pushes the active config.
// Safe to call multiple times per page load: the filter script guard prevents
// double-injection, and repeated "update-only" config pushes are idempotent.
function injectFilterScripts(tabConfig, debug) {
    // IMPORTANT: applyConfig's dataset write must come before the filterScript
    // append. filter.js reads document.documentElement.dataset.scfConfig once
    // at IIFE load time (and re-reads it on every scf:apply-config event
    // afterwards). The <script src> tag executes asynchronously (after
    // fetch + parse), so the attribute is guaranteed to be set before
    // filter.js first runs — but only if the applyConfig call comes first.
    applyConfig(tabConfig, debug, "update-only");
    if (!document.getElementById("scf-filter-script")) {
        const filterScript = document.createElement("script");
        filterScript.id = "scf-filter-script";
        filterScript.src = browser.runtime.getURL("/src/filter.js");
        document.documentElement.appendChild(filterScript);
    }
}

// ── Pure: DOM builders ────────────────────────────────────────────────────────

function injectStyles() {
    if (document.getElementById("scf-styles")) return;
    const style = document.createElement("style");
    style.id = "scf-styles";
    style.textContent = `
    body.theme-dark {
      --scf-bg: #1a1a1a;
      --scf-bg-input: #2a2a2a;
      --scf-bg-hover: #333333;
      --scf-border: #333333;
      --scf-border-row: #222222;
      --scf-border-ctrl: #444444;
      --scf-text: #e0e0e0;
      --scf-text-2: #bbbbbb;
      --scf-text-muted: #888888;
      --scf-text-dim: #666666;
    }
    body.theme-light {
      --scf-bg: #ffffff;
      --scf-bg-input: #f5f5f5;
      --scf-bg-hover: #e8e8e8;
      --scf-border: #dddddd;
      --scf-border-row: #ebebeb;
      --scf-border-ctrl: #d0d0d0;
      --scf-text: #222222;
      --scf-text-2: #444444;
      --scf-text-muted: #767676;
      --scf-text-dim: #999999;
    }
    /* ── Tab bar additions ─────────────────────────── */
    #scf-stream-header {
      overflow: visible;
      height: auto;
      min-height: 0;
      position: sticky;
      top: var(--header-height, 46px);
      z-index: 100;
      background: var(--background-surface-color, var(--scf-bg));
    }
    #scf-tab-bar {
      display: flex;
      flex-wrap: wrap;
      flex-direction: row;
      white-space: normal;
      overflow: visible;
      justify-content: flex-start;
      align-items: center;
      height: auto;
      min-height: 0;
    }
    #scf-tab-bar .g-tabs-item[data-tab-id],
    #scf-tab-bar .scf-global-gear-item,
    #scf-tab-bar .scf-add-item {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      margin: 0 2px 0 2px;
    }
    #scf-tab-bar .g-tabs-item[data-tab-id] .g-tabs-link {
      position: relative;
      text-align: center;
      padding-left: 10px;
      padding-right: 10px;
    }
    .scf-gear-btn {
      position: absolute;
      right: -4px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      color: var(--scf-text-muted);
      padding: 0;
      line-height: 0;
      display: inline-flex;
      align-items: center;
      opacity: 0;
      transition: opacity 0.15s;
    }
    /* Show gear when the tab item is hovered */
    .g-tabs-item[data-tab-id]:hover .scf-gear-btn {
      opacity: 0.7;
    }
    .g-tabs-item[data-tab-id]:hover .scf-gear-btn:hover {
      opacity: 1;
      color: var(--scf-text-2);
    }
    /* global gear and add links — use g-tabs-link for automatic height alignment */
    #scf-tab-bar .scf-global-gear-link,
    #scf-tab-bar .scf-add-link {
      display: inline-flex;
      align-items: center;
      color: var(--scf-text-muted);
      opacity: 0.8;
    }
    #scf-tab-bar .scf-global-gear-link:hover { opacity: 1; color: var(--scf-text-2); }
    #scf-tab-bar .scf-add-link {
      font-size: 16px;
      line-height: 1;
      padding-left: 6px;
    }
    #scf-tab-bar .scf-add-link:hover { color: #ff5500; opacity: 1; }

    /* ── Settings panel ────────────────────────────── */
    #scf-settings-panel, #scf-global-panel {
      position: fixed;
      top: 60px;
      right: 16px;
      z-index: 9999;
      background: var(--scf-bg);
      color: var(--scf-text);
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      width: 260px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.6);
      user-select: none;
      border: 1px solid var(--scf-border);
    }
    #scf-settings-panel .scf-panel-header,
    #scf-global-panel .scf-panel-header {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      gap: 8px;
      border-bottom: 1px solid var(--scf-border);
    }
    #scf-settings-panel .scf-name-input {
      flex: 1;
      background: var(--scf-bg-input);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 4px;
      color: var(--scf-text);
      font-size: 13px;
      padding: 4px 8px;
      outline: none;
    }
    #scf-settings-panel .scf-name-input:focus {
      border-color: #ff5500;
    }
    #scf-global-panel .scf-panel-title {
      flex: 1;
      font-weight: 500;
      font-size: 13px;
    }
    .scf-close-btn {
      background: none;
      border: none;
      color: var(--scf-text-muted);
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 0;
    }
    .scf-close-btn:hover { color: var(--scf-text); }

    #scf-settings-panel .scf-body {
      max-height: 60vh;
      overflow-y: auto;
    }
    .scf-section-header {
      padding: 6px 12px 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--scf-text-dim);
      border-bottom: 1px solid var(--scf-border-row);
    }
    .scf-row {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      gap: 8px;
      border-bottom: 1px solid var(--scf-border-row);
    }
    .scf-row-label {
      flex: 1;
      font-size: 12px;
      color: var(--scf-text-2);
      line-height: 1.3;
    }
    .scf-help {
      display: inline-block;
      width: 14px;
      height: 14px;
      line-height: 14px;
      text-align: center;
      font-size: 10px;
      font-weight: 600;
      color: var(--scf-text-dim);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 50%;
      cursor: default;
      position: relative;
      margin-left: 4px;
      flex-shrink: 0;
      vertical-align: middle;
    }
    #scf-tooltip {
      position: fixed;
      background: var(--scf-bg-input);
      color: var(--scf-text);
      font-size: 11px;
      font-weight: 400;
      line-height: 1.4;
      padding: 6px 8px;
      border-radius: 4px;
      border: 1px solid var(--scf-border-ctrl);
      width: 180px;
      white-space: normal;
      z-index: 99999;
      pointer-events: none;
      display: none;
    }
    .scf-toggle {
      position: relative;
      width: 32px;
      height: 18px;
      flex-shrink: 0;
      cursor: pointer;
    }
    .scf-toggle input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }
    .scf-toggle-track {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: var(--scf-border-ctrl);
      border-radius: 9px;
      transition: background 0.2s;
    }
    .scf-toggle input:checked + .scf-toggle-track { background: #ff5500; }
    .scf-toggle-track::after {
      content: '';
      position: absolute;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #fff;
      top: 2px;
      left: 2px;
      transition: transform 0.2s;
    }
    .scf-toggle input:checked + .scf-toggle-track::after { transform: translateX(14px); }
    .scf-row-disabled {
      opacity: 0.4;
      pointer-events: none;
    }
    .scf-row-disabled .scf-help {
      pointer-events: auto;
    }
    #scf-pf-nit-row {
      border-bottom: none;
    }

    /* Segmented control for filterReposts.type */
    .scf-sub-section {
      display: none;
      padding: 6px 12px 10px;
      border-bottom: 1px solid var(--scf-border-row);
    }
    .scf-sub-section.scf-visible { display: block; }
    .scf-filter-info {
      margin: 8px 0 0;
      font-size: 11px;
      color: var(--scf-text-muted);
      line-height: 1.5;
    }
    .scf-segmented {
      display: flex;
      gap: 4px;
    }
    .scf-seg-btn {
      flex: 1;
      padding: 4px 0;
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--scf-bg-input);
      color: var(--scf-text-2);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 3px;
      cursor: pointer;
    }
    .scf-seg-btn.scf-active {
      background: #ff5500;
      color: #fff;
      border-color: #ff5500;
    }
    .scf-pf-mode-btn {
      flex: 1;
      padding: 4px 0;
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--scf-bg-input);
      color: var(--scf-text-2);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 3px;
      cursor: pointer;
    }
    .scf-pf-mode-btn.scf-active {
      background: #ff5500;
      color: #fff;
      border-color: #ff5500;
    }

    /* Sliders */
    .scf-slider-section {
      display: none;
      padding: 8px 12px 12px;
      border-bottom: 1px solid var(--scf-border-row);
    }
    .scf-slider-section.scf-visible { display: block; }
    .scf-slider-labels {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--scf-text-muted);
      margin-bottom: 6px;
    }
    .scf-slider-wrap, .scf-single-wrap {
      position: relative;
      height: 24px;
      display: flex;
      align-items: center;
    }
    .scf-slider-base {
      position: absolute;
      left: 0; right: 0;
      height: 4px;
      background: var(--scf-border-ctrl);
      border-radius: 2px;
      pointer-events: none;
    }
    .scf-slider-fill {
      position: absolute;
      height: 4px;
      background: #ff5500;
      border-radius: 2px;
      pointer-events: none;
    }
    .scf-slider-wrap input[type=range],
    .scf-single-wrap input[type=range] {
      position: absolute;
      width: 100%;
      -webkit-appearance: none;
      -moz-appearance: none;
      background: transparent;
      pointer-events: none;
      margin: 0; padding: 0;
      height: 4px;
    }
    .scf-slider-wrap input[type=range]::-webkit-slider-runnable-track,
    .scf-single-wrap input[type=range]::-webkit-slider-runnable-track {
      background: transparent; height: 4px;
    }
    .scf-slider-wrap input[type=range]::-webkit-slider-thumb,
    .scf-single-wrap input[type=range]::-webkit-slider-thumb {
      -webkit-appearance: none;
      pointer-events: all;
      width: 14px; height: 14px;
      border-radius: 50%;
      background: #ff5500;
      border: 2px solid var(--scf-bg);
      cursor: pointer;
      margin-top: -5px;
    }
    .scf-slider-wrap input[type=range]::-moz-range-thumb,
    .scf-single-wrap input[type=range]::-moz-range-thumb {
      -moz-appearance: none;
      pointer-events: all;
      width: 14px; height: 14px;
      border-radius: 50%;
      background: #ff5500;
      border: 2px solid var(--scf-bg);
      cursor: pointer;
    }
    .scf-warning {
      display: none;
      font-size: 11px;
      color: #f5a623;
      margin: 6px 0 0;
      line-height: 1.4;
    }
    .scf-warning:not([hidden]) { display: block; }

    /* Tag filter */
    .scf-tag-section {
      display: none;
      padding: 8px 12px 12px;
      border-bottom: 1px solid var(--scf-border-row);
    }
    .scf-tag-section.scf-visible { display: block; }
    .scf-tag-mode-row { display: flex; gap: 4px; margin-bottom: 8px; }
    .scf-tag-mode-btn {
      flex: 1;
      padding: 4px 0;
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--scf-bg-input);
      color: var(--scf-text-2);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 3px;
      cursor: pointer;
    }
    .scf-tag-mode-btn.scf-active { background: #ff5500; color: #fff; border-color: #ff5500; }
    .scf-tag-input-row { display: flex; gap: 4px; margin-bottom: 8px; }
    .scf-tag-input {
      flex: 1;
      padding: 3px 6px;
      font-size: 11px;
      background: var(--scf-bg-input);
      color: var(--scf-text);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 3px;
      outline: none;
    }
    .scf-tag-add-btn, .scf-tag-clear-btn {
      padding: 3px 8px;
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--scf-bg-input);
      color: var(--scf-text-2);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 3px;
      cursor: pointer;
    }
    .scf-tag-add-btn:hover, .scf-tag-clear-btn:hover { background: var(--scf-bg-hover); color: var(--scf-text); }
    .scf-tag-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
    .scf-tag-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 6px;
      font-size: 11px;
      background: var(--scf-bg-input);
      color: var(--scf-text-2);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 10px;
    }
    .scf-tag-chip-remove {
      background: none; border: none; color: var(--scf-text-muted);
      cursor: pointer; font-size: 12px; line-height: 1; padding: 0;
    }
    .scf-tag-chip-remove:hover { color: var(--scf-text); }

    /* Panel footer */
    .scf-panel-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--scf-border);
    }
    .scf-panel-footer .scf-delete-btn {
      margin-right: auto;
      background: none;
      border: none;
      color: var(--scf-text-muted);
      font-size: 12px;
      cursor: pointer;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .scf-panel-footer .scf-delete-btn:hover { color: #e04040; }
    .scf-btn {
      padding: 5px 14px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid var(--scf-border-ctrl);
      background: var(--scf-bg-input);
      color: var(--scf-text-2);
    }
    .scf-btn:hover { background: var(--scf-bg-hover); color: var(--scf-text); }
    .scf-btn-primary {
      background: #ff5500;
      border-color: #ff5500;
      color: #fff;
    }
    .scf-btn-primary:hover { background: #e04d00; }

    /* Global panel body */
    #scf-global-panel .scf-body { padding: 12px; }
    #scf-global-panel .scf-restore-btn {
      width: 100%;
      padding: 8px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--scf-bg-input);
      color: var(--scf-text-2);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 4px;
      cursor: pointer;
    }
    #scf-global-panel .scf-restore-btn:hover { background: var(--scf-bg-hover); color: var(--scf-text); }
    #scf-global-panel .scf-global-links {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--scf-border);
    }
    /* Help link — matches the restore button above it */
    #scf-global-panel .scf-help-btn {
      display: block;
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      text-align: center;
      text-decoration: none;
      background: var(--scf-bg-input);
      color: var(--scf-text-2);
      border: 1px solid var(--scf-border-ctrl);
      border-radius: 4px;
      cursor: pointer;
    }
    #scf-global-panel .scf-help-btn:hover { background: var(--scf-bg-hover); color: var(--scf-text); }
    /* Buy Me a Coffee brand banner */
    #scf-global-panel .scf-coffee-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      box-sizing: border-box;
      padding: 8px;
      font-size: 13px;
      font-weight: 600;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #ffdd00;
      color: #000000;
      border: 1px solid #ffdd00;
      border-radius: 4px;
      cursor: pointer;
      text-decoration: none;
    }
    #scf-global-panel .scf-coffee-btn:hover { background: #ffe74d; border-color: #ffe74d; }
    #scf-global-panel .scf-coffee-btn svg { display: block; }
  `;
    document.head.appendChild(style);
}

// ── Tooltip helpers ───────────────────────────────────────────────────────────

function ensureTooltipEl() {
    let tip = document.getElementById("scf-tooltip");
    if (!tip) {
        tip = document.createElement("div");
        tip.id = "scf-tooltip";
        document.body.appendChild(tip);
    }
    return tip;
}

function showTooltip(helpEl) {
    const tip = ensureTooltipEl();
    tip.textContent = helpEl.dataset.tip;
    tip.style.display = "block";
    const rect = helpEl.getBoundingClientRect();
    // Position to the left of the element, vertically centered
    const left = rect.left - 180 - 8;
    const top = rect.top + rect.height / 2 - tip.offsetHeight / 2;
    tip.style.left = Math.max(8, left) + "px";
    tip.style.top = Math.max(8, top) + "px";
}

function hideTooltip() {
    const tip = document.getElementById("scf-tooltip");
    if (tip) tip.style.display = "none";
}

function attachTooltipListeners(el) {
    for (const h of el.querySelectorAll(".scf-help")) {
        h.addEventListener("mouseenter", () => showTooltip(h));
        h.addEventListener("mouseleave", hideTooltip);
    }
}

// Returns the full <ul> tab bar element. No event listeners attached.
function buildTabBar(tabs, activeId) {
    const ul = document.createElement("ul");
    ul.className = "collectionNav g-tabs";
    ul.id = "scf-tab-bar";

    // Global settings link (uses g-tabs-link so it naturally aligns with tabs)
    const globalLi = document.createElement("li");
    globalLi.className = "g-tabs-item scf-global-gear-item";
    const globalGearLink = document.createElement("a");
    globalGearLink.className = "g-tabs-link scf-global-gear-link";
    globalGearLink.href = "#";
    globalGearLink.title = "Extension settings";
    globalGearLink.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.00098 1C6.72483 1 6.50098 1.22386 6.50098 1.5V2.19722C6.50098 2.39346 6.37462 2.56748 6.18686 2.63097C5.98639 2.69822 5.79106 2.77634 5.60179 2.86466C5.42386 2.94862 5.21212 2.91627 5.07373 2.77788L4.57471 2.27886C4.37945 2.0836 4.0629 2.0836 3.86764 2.27886L2.27875 3.86775C2.08349 4.06301 2.08349 4.37959 2.27875 4.57485L2.77801 5.07412C2.9164 5.2125 2.94875 5.42424 2.86479 5.60217C2.77647 5.79144 2.69835 5.98677 2.6311 6.18724C2.56761 6.375 2.39359 6.50136 2.19735 6.50136H1.5C1.22386 6.50136 1 6.72522 1 7.00136V9.00136C1 9.27751 1.22386 9.50136 1.5 9.50136H2.19722C2.39346 9.50136 2.56748 9.62772 2.63097 9.81548C2.69822 10.0159 2.77634 10.2113 2.86466 10.4005C2.94862 10.5785 2.91627 10.7902 2.77788 10.9286L2.27886 11.4276C2.0836 11.6229 2.0836 11.9394 2.27886 12.1347L3.86775 13.7236C4.06301 13.9188 4.37959 13.9188 4.57485 13.7236L5.07412 13.2243C5.2125 13.0859 5.42424 13.0536 5.60217 13.1375C5.79144 13.2259 5.98677 13.304 6.18724 13.3712C6.375 13.4347 6.50136 13.6087 6.50136 13.805V14.5014C6.50136 14.7775 6.72522 15.0014 7.00136 15.0014H9.00136C9.27751 15.0014 9.50136 14.7775 9.50136 14.5014V13.8042C9.50136 13.6079 9.62772 13.4339 9.81548 13.3704C10.0159 13.3032 10.2113 13.225 10.4005 13.1367C10.5785 13.0528 10.7902 13.0851 10.9286 13.2235L11.4276 13.7225C11.6229 13.9178 11.9394 13.9178 12.1347 13.7225L13.7236 12.1336C13.9188 11.9384 13.9188 11.6218 13.7236 11.4265L13.2243 10.9273C13.0859 10.7889 13.0536 10.5771 13.1375 10.3992C13.2259 10.2099 13.304 10.0146 13.3712 9.81412C13.4347 9.62636 13.6087 9.5 13.805 9.5H14.5014C14.7775 9.5 15.0014 9.27614 15.0014 9V7C15.0014 6.72386 14.7775 6.5 14.5014 6.5H13.8042C13.6079 6.5 13.4339 6.37364 13.3704 6.18588C13.3032 5.98541 13.225 5.79008 13.1367 5.60081C13.0528 5.42288 13.0851 5.21114 13.2235 5.07275L13.7225 4.57373C13.9178 4.37847 13.9178 4.06189 13.7225 3.86663L12.1336 2.27774C11.9384 2.08248 11.6218 2.08248 11.4265 2.27774L10.9273 2.77701C10.7889 2.9154 10.5771 2.94775 10.3992 2.86379C10.2099 2.77547 10.0146 2.69735 9.81412 2.6301C9.62636 2.56661 9.5 2.39259 9.5 2.19635V1.5C9.5 1.22386 9.27614 1 9 1H7.00098ZM8 10.5C9.38071 10.5 10.5 9.38071 10.5 8C10.5 6.61929 9.38071 5.5 8 5.5C6.61929 5.5 5.5 6.61929 5.5 8C5.5 9.38071 6.61929 10.5 8 10.5Z"/></svg>`;
    globalLi.appendChild(globalGearLink);
    ul.appendChild(globalLi);

    // Tab items
    for (const tab of tabs) {
        const li = document.createElement("li");
        li.className = "g-tabs-item";
        li.dataset.tabId = tab.id;

        const link = document.createElement("a");
        link.className = tab.id === activeId ? "g-tabs-link active" : "g-tabs-link";
        link.href = "#";
        const labelSpan = document.createElement("span");
        labelSpan.textContent = tab.name;
        link.appendChild(labelSpan);
        if (tab.type !== "deepCuts") {
            const gearBtn = document.createElement("button");
            gearBtn.className = "scf-gear-btn";
            gearBtn.title = "Configure filter";
            gearBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M10.7626 1.57677C11.446 0.893354 12.554 0.893355 13.2374 1.57677L14.6517 2.99099C15.3351 3.6744 15.3351 4.78244 14.6517 5.46586L7.20733 12.9102C6.90545 13.2121 6.53743 13.4395 6.13241 13.5745L3.28636 14.5232C2.30916 14.8489 1.37949 13.9193 1.70522 12.9421L2.65391 10.096C2.78891 9.691 3.01636 9.32298 3.31824 9.0211L10.7626 1.57677ZM12.1768 2.63743C12.0791 2.5398 11.9209 2.5398 11.8232 2.63743L10.5858 3.87488L12.3535 5.64265L13.591 4.4052C13.6886 4.30757 13.6886 4.14928 13.591 4.05165L12.1768 2.63743ZM5.63604 8.82462L7.40381 10.5924L11.2929 6.70331L9.52512 4.93554L5.63604 8.82462ZM4.57538 9.88528L4.3789 10.0818C4.24168 10.219 4.1383 10.3863 4.07693 10.5704L3.28636 12.9421L5.65807 12.1515C5.84217 12.0901 6.00945 11.9867 6.14667 11.8495L6.34315 11.653L4.57538 9.88528Z" fill="currentColor"></path></svg>`;
            link.appendChild(gearBtn);
        }

        li.appendChild(link);

        ul.appendChild(li);
    }

    // Add link (uses g-tabs-link so it naturally aligns with tabs)
    const addLi = document.createElement("li");
    addLi.className = "g-tabs-item scf-add-item";
    const addLink = document.createElement("a");
    addLink.className = "g-tabs-link scf-add-link";
    addLink.href = "#";
    addLink.title = "Add filter tab";
    addLink.textContent = "+";
    addLi.appendChild(addLink);
    ul.appendChild(addLi);

    return ul;
}

const REPOST_INFO = {
    allowNone: "All reposts are hidden from your feed.",
    allowRepostedTracksOfFollowers: "Hides reposts from people you don't follow \u2014 except when the track title contains the name of someone you follow, such as when a label uploads a track by an artist you follow.",
    allowOnlyFromNotFollowing: "Shows only content from people you don't follow \u2014 both posts and reposts. Good for discovering new artists through your network.",
};

const PLAYLIST_INFO = {
    hideLarge: "Hides playlists with more than 5 tracks. Individual track reposts are kept.",
    hideAll: "All playlists are hidden from your feed.",
};

function buildSettingsPanel(tab) {
    const s = tab.type === "settings" ? tab.settings : sanitizeSettings({});
    const panel = document.createElement("div");
    panel.id = "scf-settings-panel";

    panel.innerHTML = `
    <div class="scf-panel-header">
      <input class="scf-name-input" type="text" value="${tab.name.replace(/"/g, '&quot;')}" placeholder="Filter name">
      <button class="scf-close-btn" title="Close">×</button>
    </div>
    <div class="scf-body">
      <div class="scf-row">
        <span class="scf-row-label">Repost filter <span class="scf-help" data-tip="Block all reposts, allow only from people you follow, or show only from people you don't follow.">?</span></span>
        <label class="scf-toggle">
          <input type="checkbox" id="scf-fr-toggle"${s.filterReposts.enabled ? " checked" : ""}>
          <span class="scf-toggle-track"></span>
        </label>
      </div>
      <div class="scf-sub-section${s.filterReposts.enabled ? " scf-visible" : ""}" id="scf-fr-sub">
        <div class="scf-segmented">
          <button class="scf-seg-btn${s.filterReposts.type === "allowNone" ? " scf-active" : ""}" data-type="allowNone">Block all</button>
          <button class="scf-seg-btn${s.filterReposts.type === "allowRepostedTracksOfFollowers" ? " scf-active" : ""}" data-type="allowRepostedTracksOfFollowers">Allow from followers</button>
          <button class="scf-seg-btn${s.filterReposts.type === "allowOnlyFromNotFollowing" ? " scf-active" : ""}" data-type="allowOnlyFromNotFollowing">Allow not following</button>
        </div>
        <p id="scf-fr-info" class="scf-filter-info">${REPOST_INFO[s.filterReposts.type] ?? ""}</p>
      </div>

      <div class="scf-row">
        <span class="scf-row-label">Playlist filter <span class="scf-help" data-tip="Controls how playlists are handled in your feed.">?</span></span>
        <label class="scf-toggle">
          <input type="checkbox" id="scf-pf-toggle"${s.playlistFilter.enabled ? " checked" : ""}>
          <span class="scf-toggle-track"></span>
        </label>
      </div>
      <div class="scf-sub-section${s.playlistFilter.enabled ? " scf-visible" : ""}" id="scf-pf-sub">
        <div class="scf-segmented">
          <button class="scf-pf-mode-btn${s.playlistFilter.mode === "hideLarge" ? " scf-active" : ""}" data-mode="hideLarge">Hide large</button>
          <button class="scf-pf-mode-btn${s.playlistFilter.mode === "hideAll" ? " scf-active" : ""}" data-mode="hideAll">Hide all</button>
        </div>
        <p id="scf-pf-info" class="scf-filter-info">${PLAYLIST_INFO[s.playlistFilter.mode] ?? ""}</p>
        <div class="scf-row${s.playlistFilter.mode !== "hideLarge" ? " scf-row-disabled" : ""}" id="scf-pf-nit-row">
          <span class="scf-row-label">Reposter name in titles <span class="scf-help" data-tip="Only show playlists where the reposter's username appears in at least one track title. Only available when Hide large mode is selected.">?</span></span>
          <label class="scf-toggle">
            <input type="checkbox" id="scf-pf-nit-toggle"${s.playlistFilter.nameInTitles ? " checked" : ""}${s.playlistFilter.mode !== "hideLarge" ? " disabled" : ""}>
            <span class="scf-toggle-track"></span>
          </label>
        </div>
      </div>

      <div class="scf-row">
        <span class="scf-row-label">Tag filter <span class="scf-help" data-tip="Include mode: only show items matching your tags. Exclude mode: hide items with your tags.">?</span></span>
        <label class="scf-toggle">
          <input type="checkbox" id="scf-tf-toggle"${s.tagFilter.enabled ? " checked" : ""}>
          <span class="scf-toggle-track"></span>
        </label>
      </div>
      <div id="scf-tag-section" class="scf-tag-section${s.tagFilter.enabled ? " scf-visible" : ""}">
        <div class="scf-tag-mode-row">
          <button id="scf-tf-include" class="scf-tag-mode-btn${s.tagFilter.mode === "include" ? " scf-active" : ""}">Include</button>
          <button id="scf-tf-exclude" class="scf-tag-mode-btn${s.tagFilter.mode === "exclude" ? " scf-active" : ""}">Exclude</button>
        </div>
        <div class="scf-tag-input-row">
          <input type="text" id="scf-tf-input" class="scf-tag-input" placeholder="add tag…">
          <button id="scf-tf-add" class="scf-tag-add-btn">Add</button>
        </div>
        <div id="scf-tag-chips" class="scf-tag-chips"></div>
        <p class="scf-warning" id="scf-tf-warning"${!(s.tagFilter.enabled && s.tagFilter.mode === "include" && s.tagFilter.tags.length === 0) ? " hidden" : ""}>⚠ Include mode with no tags will hide everything</p>
        <button id="scf-tf-clear" class="scf-tag-clear-btn">Clear all</button>
      </div>

      <div class="scf-row">
        <span class="scf-row-label">Track length <span class="scf-help" data-tip="Filter tracks by duration in minutes.">?</span></span>
        <label class="scf-toggle">
          <input type="checkbox" id="scf-tl-toggle"${s.trackLengthInMin.enabled ? " checked" : ""}>
          <span class="scf-toggle-track"></span>
        </label>
      </div>
      <div class="scf-slider-section${s.trackLengthInMin.enabled ? " scf-visible" : ""}" id="scf-tl-section">
        <div class="scf-slider-labels">
          <span id="scf-tl-min-label">${s.trackLengthInMin.min} min</span>
          <span id="scf-tl-max-label">${s.trackLengthInMin.max} min</span>
        </div>
        <div class="scf-slider-wrap">
          <div class="scf-slider-base"></div>
          <div class="scf-slider-fill" id="scf-tl-fill"></div>
          <input type="range" id="scf-tl-min" min="0" max="120" step="1" value="${s.trackLengthInMin.min}">
          <input type="range" id="scf-tl-max" min="0" max="120" step="1" value="${s.trackLengthInMin.max}">
        </div>
      </div>

      <div class="scf-row">
          <span class="scf-row-label">Content age <span class="scf-help" data-tip="Filter by how long ago tracks appeared in your feed (left) and were uploaded (right).">?</span></span>
          <label class="scf-toggle">
            <input type="checkbox" id="scf-ca-toggle"${s.contentAgeInDays.enabled ? " checked" : ""}>
            <span class="scf-toggle-track"></span>
          </label>
        </div>
        <div class="scf-slider-section${s.contentAgeInDays.enabled ? " scf-visible" : ""}" id="scf-ca-section">
          <div class="scf-slider-labels" id="scf-ca-label">${caLabel(s.contentAgeInDays.min, s.contentAgeInDays.max)}</div>
          <div class="scf-slider-wrap">
            <div class="scf-slider-base"></div>
            <div class="scf-slider-fill" id="scf-ca-fill"></div>
            <input type="range" id="scf-ca-min" min="0" max="31" step="1" value="${storageToUiMin(s.contentAgeInDays.min)}">
            <input type="range" id="scf-ca-max" min="0" max="31" step="1" value="${storageToUiMax(s.contentAgeInDays.max)}">
          </div>
        </div>

      <div class="scf-row">
        <span class="scf-row-label">Free downloads only <span class="scf-help" data-tip="Only show tracks with a free download link.">?</span></span>
        <label class="scf-toggle">
          <input type="checkbox" id="scf-fd-toggle"${s.freeDownloadsOnly.enabled ? " checked" : ""}>
          <span class="scf-toggle-track"></span>
        </label>
      </div>
      <div class="scf-row">
        <span class="scf-row-label">Hide seen tracks <span class="scf-help" data-tip="Hide tracks you've already scrolled past this session.">?</span></span>
        <label class="scf-toggle">
          <input type="checkbox" id="scf-as-toggle"${s.alreadySeen.enabled ? " checked" : ""}>
          <span class="scf-toggle-track"></span>
        </label>
      </div>
    </div>
    <div class="scf-panel-footer">
      <button class="scf-delete-btn" id="scf-delete-btn">Delete</button>
      <button class="scf-btn" id="scf-close-footer-btn">Close</button>
      <button class="scf-btn scf-btn-primary" id="scf-save-btn">Save</button>
    </div>
  `;

    return panel;
}

function buildGlobalPanel(debug) {
    const panel = document.createElement("div");
    panel.id = "scf-global-panel";
    panel.innerHTML = `
    <div class="scf-panel-header">
      <span class="scf-panel-title">Extension settings</span>
      <button class="scf-close-btn" title="Close">×</button>
    </div>
    <div class="scf-body">
      <div class="scf-global-links">
        <a class="scf-coffee-btn" href="${BUY_ME_A_COFFEE_URL}" target="_blank" rel="noopener noreferrer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1.001-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.13-.322-3.152c-.037-.36-.351-.634-.708-.618-.339.014-.618.322-.579.694l.318 3.106.907 8.844c.083.808.83 1.6 1.664 1.789.905.204 1.803.238 2.719.243 1.19.007 2.401.007 3.567-.238.85-.178 1.696-.579 2.077-1.412.145-.318.244-.686.312-1.027.09-.457.14-.919.19-1.379l.24-2.2.522-4.789.19-1.751a.237.237 0 01.264-.209c.31.045.63.108.94.16.42.07.844.14 1.267.212 1.24.207 2.454.481 3.685.717.35.067.7.146 1.05.187a.237.237 0 01.208.263l-.174 1.61c-.041.376.207.7.579.72.339.017.626-.247.663-.585l.393-3.625c.017-.16.017-.322-.02-.48z"/></svg>
          <span>Buy me a coffee</span>
        </a>
        <a class="scf-help-btn" href="${GITHUB_ISSUES_URL}" target="_blank" rel="noopener noreferrer">Help &amp; report an issue</a>
      </div>
      <button class="scf-restore-btn" id="scf-restore-btn">Restore default tabs</button>
      <div class="scf-row">
        <span class="scf-row-label">Debug logging <span class="scf-help" data-tip="Logs each feed item and why it was shown or filtered to the browser console (DevTools → Console).">?</span></span>
        <label class="scf-toggle">
          <input type="checkbox" id="scf-debug-checkbox"${debug ? " checked" : ""}>
          <span class="scf-toggle-track"></span>
        </label>
      </div>
    </div>
  `;
    return panel;
}

// ── Impure: tab bar listeners ─────────────────────────────────────────────────

function attachTabBarListeners(el, handlers) {
    const {onTabClick, onGearClick, onGlobalGearClick, onPlusClick} = handlers;

    el.querySelector(".scf-global-gear-link").addEventListener("click", (e) => {
        e.preventDefault();
        onGlobalGearClick();
    });

    for (const li of el.querySelectorAll("[data-tab-id]")) {
        const id = li.dataset.tabId;

        li.querySelector(".g-tabs-link").addEventListener("click", (e) => {
            e.preventDefault();
            onTabClick(id);
        });

        const gearBtn = li.querySelector(".scf-gear-btn");
        if (gearBtn) {
            gearBtn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                onGearClick(id);
            });
        }
    }

    el.querySelector(".scf-add-link").addEventListener("click", (e) => {
        e.preventDefault();
        onPlusClick();
    });
}

// ── Impure: panels ────────────────────────────────────────────────────────────

// Reads current values out of the panel DOM and returns an updated TabConfig.
function readPanelState(el, tab) {
    const settings = tab.type === "settings"
        ? JSON.parse(JSON.stringify(tab.settings))
        : sanitizeSettings({});

    settings.filterReposts.enabled = el.querySelector("#scf-fr-toggle").checked;
    const activeSegBtn = el.querySelector(".scf-seg-btn.scf-active");
    if (activeSegBtn) settings.filterReposts.type = activeSegBtn.dataset.type;

    settings.trackLengthInMin.enabled = el.querySelector("#scf-tl-toggle").checked;
    settings.trackLengthInMin.min = parseInt(el.querySelector("#scf-tl-min").value, 10);
    settings.trackLengthInMin.max = parseInt(el.querySelector("#scf-tl-max").value, 10);

    settings.contentAgeInDays.enabled = el.querySelector("#scf-ca-toggle").checked;
    settings.contentAgeInDays.min = uiToStorageMin(parseInt(el.querySelector("#scf-ca-min").value, 10));
    settings.contentAgeInDays.max = uiToStorageMax(parseInt(el.querySelector("#scf-ca-max").value, 10));

    settings.freeDownloadsOnly.enabled = el.querySelector("#scf-fd-toggle").checked;
    settings.alreadySeen.enabled = el.querySelector("#scf-as-toggle").checked;
    settings.playlistFilter.enabled = el.querySelector("#scf-pf-toggle").checked;
    settings.playlistFilter.mode = el.querySelector(".scf-pf-mode-btn.scf-active")?.dataset.mode ?? "hideLarge";
    settings.playlistFilter.nameInTitles = el.querySelector("#scf-pf-nit-toggle").checked;

    settings.tagFilter.enabled = el.querySelector("#scf-tf-toggle").checked;
    settings.tagFilter.mode = el.querySelector("#scf-tf-include").classList.contains("scf-active")
        ? "include"
        : "exclude";
    // Tags are kept in chipContainer.dataset.tags (set by renderChips on every mutation)
    const rawTags = el.querySelector("#scf-tag-chips").dataset.tags;
    settings.tagFilter.tags = rawTags ? JSON.parse(rawTags) : [];

    return {
        ...tab,
        name: el.querySelector(".scf-name-input").value.trim() || tab.name,
        settings,
    };
}

function attachPanelListeners(el, tab, {onSave, onDelete, onClose}) {
    // Close buttons
    el.querySelector(".scf-close-btn").addEventListener("click", onClose);
    el.querySelector("#scf-close-footer-btn").addEventListener("click", onClose);

    // Delete button — hidden when it shouldn't be available (caller sets display:none)
    const deleteBtn = el.querySelector("#scf-delete-btn");
    if (onDelete) {
        deleteBtn.addEventListener("click", () => onDelete().catch(console.error));
    } else {
        deleteBtn.style.display = "none";
    }

    // Save button
    el.querySelector("#scf-save-btn").addEventListener("click", () => {
        const updatedTab = readPanelState(el, tab);
        onSave(updatedTab).catch(console.error);
    });

    // filterReposts toggle ↔ segmented control visibility
    const frToggle = el.querySelector("#scf-fr-toggle");
    const frSub = el.querySelector("#scf-fr-sub");
    frToggle.addEventListener("change", () => {
        frSub.classList.toggle("scf-visible", frToggle.checked);
    });

    // Segmented control — mutually exclusive
    const frInfoEl = el.querySelector("#scf-fr-info");
    el.querySelectorAll(".scf-seg-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            el.querySelectorAll(".scf-seg-btn").forEach((b) => b.classList.remove("scf-active"));
            btn.classList.add("scf-active");
            frInfoEl.textContent = REPOST_INFO[btn.dataset.type] ?? "";
        });
    });

    // Playlist filter toggle shows/hides sub-section
    el.querySelector("#scf-pf-toggle").addEventListener("change", (e) => {
        el.querySelector("#scf-pf-sub").classList.toggle("scf-visible", e.target.checked);
    });

    // Playlist filter mode segmented buttons
    const pfModeButtons = el.querySelectorAll(".scf-pf-mode-btn");
    const pfNitRow = el.querySelector("#scf-pf-nit-row");
    const pfNitToggle = el.querySelector("#scf-pf-nit-toggle");
    for (const btn of pfModeButtons) {
        btn.addEventListener("click", () => {
            for (const b of pfModeButtons) {
                b.classList.toggle("scf-active", b === btn);
            }
            // nameInTitles is only active with hideLarge — disable the row for other modes
            const isHideLarge = btn.dataset.mode === "hideLarge";
            pfNitRow.classList.toggle("scf-row-disabled", !isHideLarge);
            pfNitToggle.disabled = !isHideLarge;
            if (!isHideLarge) pfNitToggle.checked = false;
            el.querySelector("#scf-pf-info").textContent = PLAYLIST_INFO[btn.dataset.mode] ?? "";
        });
    }

    // Track length toggle + dual slider
    const tlToggle = el.querySelector("#scf-tl-toggle");
    const tlSection = el.querySelector("#scf-tl-section");
    const tlFill = el.querySelector("#scf-tl-fill");
    const tlMin = el.querySelector("#scf-tl-min");
    const tlMax = el.querySelector("#scf-tl-max");
    const tlMinLabel = el.querySelector("#scf-tl-min-label");
    const tlMaxLabel = el.querySelector("#scf-tl-max-label");

    function updateTlFill() {
        const mn = parseInt(tlMin.value, 10);
        const mx = parseInt(tlMax.value, 10);
        tlFill.style.left = (mn / 120 * 100) + "%";
        tlFill.style.right = (100 - mx / 120 * 100) + "%";
    }

    updateTlFill();

    tlToggle.addEventListener("change", () =>
        tlSection.classList.toggle("scf-visible", tlToggle.checked)
    );
    tlMin.addEventListener("input", () => {
        if (parseInt(tlMin.value, 10) > parseInt(tlMax.value, 10))
            tlMin.value = tlMax.value;
        tlMinLabel.textContent = tlMin.value + " min";
        updateTlFill();
    });
    tlMax.addEventListener("input", () => {
        if (parseInt(tlMax.value, 10) < parseInt(tlMin.value, 10))
            tlMax.value = tlMin.value;
        tlMaxLabel.textContent = tlMax.value + " min";
        updateTlFill();
    });

    // Content age toggle + dual slider
    const caToggle = el.querySelector("#scf-ca-toggle");
    const caSection = el.querySelector("#scf-ca-section");
    const caFill = el.querySelector("#scf-ca-fill");
    const caMinSlider = el.querySelector("#scf-ca-min");
    const caMaxSlider = el.querySelector("#scf-ca-max");
    const caLabelEl = el.querySelector("#scf-ca-label");

    function updateCaLabel() {
        caLabelEl.textContent = caLabel(
            uiToStorageMin(parseInt(caMinSlider.value, 10)),
            uiToStorageMax(parseInt(caMaxSlider.value, 10))
        );
    }

    function updateCaFill() {
        const mn = parseInt(caMinSlider.value, 10);
        const mx = parseInt(caMaxSlider.value, 10);
        caFill.style.left = (mn / 31 * 100) + "%";
        caFill.style.right = ((31 - mx) / 31 * 100) + "%";
    }

    updateCaFill();
    updateCaLabel();

    caToggle.addEventListener("change", () =>
        caSection.classList.toggle("scf-visible", caToggle.checked)
    );
    caMinSlider.addEventListener("input", () => {
        if (parseInt(caMinSlider.value, 10) > parseInt(caMaxSlider.value, 10))
            caMinSlider.value = caMaxSlider.value;
        updateCaLabel();
        updateCaFill();
    });
    caMaxSlider.addEventListener("input", () => {
        if (parseInt(caMaxSlider.value, 10) < Math.max(1, parseInt(caMinSlider.value, 10)))
            caMaxSlider.value = Math.max(1, parseInt(caMinSlider.value, 10));
        updateCaLabel();
        updateCaFill();
    });

    // Tag filter toggle + mode + chips
    const tfToggle = el.querySelector("#scf-tf-toggle");
    const tagSection = el.querySelector("#scf-tag-section");
    const tfInclude = el.querySelector("#scf-tf-include");
    const tfExclude = el.querySelector("#scf-tf-exclude");
    const tfInput = el.querySelector("#scf-tf-input");
    const tfAdd = el.querySelector("#scf-tf-add");
    const chipContainer = el.querySelector("#scf-tag-chips");
    const tagWarning = el.querySelector("#scf-tf-warning");
    const tfClear = el.querySelector("#scf-tf-clear");

    // Local mutable copy of tags for this panel session
    let localTags = [...(tab.type === "settings" ? tab.settings.tagFilter.tags : [])];
    let localMode = tab.type === "settings" ? tab.settings.tagFilter.mode : "include";

    function renderChips() {
        chipContainer.innerHTML = "";
        localTags.forEach((tag) => {
            const chip = document.createElement("span");
            chip.className = "scf-tag-chip";
            chip.textContent = tag;
            const rm = document.createElement("button");
            rm.className = "scf-tag-chip-remove";
            rm.textContent = "×";
            rm.addEventListener("click", () => {
                localTags = localTags.filter((t) => t !== tag);
                renderChips();
            });
            chip.appendChild(rm);
            chipContainer.appendChild(chip);
        });
        tagWarning.hidden = !(
            tfToggle.checked && localMode === "include" && localTags.length === 0
        );
        // Sync localTags back into the hidden tag-chips data so readPanelState can read it
        chipContainer.dataset.tags = JSON.stringify(localTags);
    }

    renderChips();

    tfToggle.addEventListener("change", () => {
        tagSection.classList.toggle("scf-visible", tfToggle.checked);
        renderChips();
    });

    tfInclude.addEventListener("click", () => {
        localMode = "include";
        tfInclude.classList.add("scf-active");
        tfExclude.classList.remove("scf-active");
        renderChips();
    });
    tfExclude.addEventListener("click", () => {
        localMode = "exclude";
        tfExclude.classList.add("scf-active");
        tfInclude.classList.remove("scf-active");
        renderChips();
    });

    function addTag() {
        const tag = tfInput.value.trim().toLowerCase();
        if (!tag || localTags.includes(tag)) {
            tfInput.value = "";
            return;
        }
        localTags.push(tag);
        renderChips();
        tfInput.value = "";
    }

    tfAdd.addEventListener("click", addTag);
    tfInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") addTag();
    });
    tfClear.addEventListener("click", () => {
        localTags = [];
        renderChips();
    });
}

function attachGlobalPanelListeners(el, {onRestore, onClose, onDebugChange}) {
    el.querySelector(".scf-close-btn").addEventListener("click", onClose);
    el.querySelector("#scf-restore-btn").addEventListener("click", onRestore);
    el.querySelector("#scf-debug-checkbox").addEventListener("change", (e) => {
        onDebugChange(e.target.checked).catch(console.error);
    });
}

function openSettingsPanel(tab, handlers) {
    document.getElementById("scf-settings-panel")?.remove();
    document.getElementById("scf-global-panel")?.remove();
    const el = buildSettingsPanel(tab);
    attachPanelListeners(el, tab, handlers);
    attachTooltipListeners(el);
    document.body.appendChild(el);
}

function openGlobalPanel(handlers) {
    document.getElementById("scf-global-panel")?.remove();
    document.getElementById("scf-settings-panel")?.remove();
    const el = buildGlobalPanel(handlers.debug);
    attachGlobalPanelListeners(el, handlers);
    attachTooltipListeners(el);
    document.body.appendChild(el);
}

// ── Impure: init ──────────────────────────────────────────────────────────────

// https://stackoverflow.com/a/61511955
function waitForElement(selector) {
    return new Promise((resolve) => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }
        const observer = new MutationObserver(() => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });
        observer.observe(document.documentElement, {childList: true, subtree: true});
    });
}

async function initFilters() {
    // Always inject filter scripts (guarded internally against double-inject)

    const {tabs, activeTabId, debug} = await loadState();
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
    injectFilterScripts(activeTab, debug);

    if (!window.location.href.includes("soundcloud.com/feed")) return;

    injectStyles();

    const header = await waitForElement(".stream__header");
    header.id = "scf-stream-header";

    const tabBarEl = buildTabBar(tabs, activeTabId);
    attachTabBarListeners(tabBarEl, {
        onTabClick: async (id) => {
            const {tabs, activeTabId} = await loadState();
            if (id === activeTabId) return;
            await saveAndResetFeed(tabs, id);
            // The tab set is unchanged — just move the active highlight.
            for (const li of tabBarEl.querySelectorAll("[data-tab-id]")) {
                li.querySelector(".g-tabs-link").classList.toggle("active", li.dataset.tabId === id);
            }
        },
        onGearClick: async (id) => {
            const {tabs, activeTabId} = await loadState();
            const tab = tabs.find((t) => t.id === id);
            if (!tab) return;
            openSettingsPanel(tab, {
                // onSave uses the panel-open snapshot of tabs/activeTabId intentionally.
                // The settings panel is modal — no concurrent state changes are possible while it is open.
                onSave: async (updatedTab) => {
                    const newTabs = tabs.map((t) => (t.id === updatedTab.id ? updatedTab : t));
                    if (updatedTab.id === activeTabId) {
                        await saveAndResetFeed(newTabs, activeTabId);
                        document.getElementById("scf-settings-panel")?.remove();
                        initFilters(); // tab name may have changed — rebuild the tab bar
                    } else {
                        await save(newTabs, activeTabId);
                        document.getElementById("scf-settings-panel")?.remove();
                    }
                },
                // Only pass onDelete when there is more than one tab — attachPanelListeners
                // hides the Delete button when onDelete is undefined.
                // tabs.length uses the panel-open snapshot — safe because the panel is modal.
                onDelete: tabs.length > 1 ? async () => {
                    if (!confirm("Delete this filter?")) return;
                    const {tabs: newTabs, newActiveId} = tabsAfterDelete(tabs, id);
                    if (id === activeTabId) {
                        await saveAndResetFeed(newTabs, newActiveId);
                        document.getElementById("scf-settings-panel")?.remove();
                        initFilters();
                    } else {
                        await save(newTabs, activeTabId);
                        document.getElementById("scf-settings-panel")?.remove();
                        initFilters();
                    }
                } : undefined,
                onClose: () => {
                    document.getElementById("scf-settings-panel")?.remove();
                },
            });
        },
        onGlobalGearClick: async () => {
            const {debug} = await loadState();
            openGlobalPanel({
                debug,
                onRestore: async () => {
                    const defaults = buildDefaultTabs();
                    await saveAndResetFeed(defaults, defaults[0].id);
                    document.getElementById("scf-global-panel")?.remove();
                    initFilters();
                },
                onDebugChange: async (enabled) => {
                    await browser.storage.sync.set({scfDebug: enabled});
                    const {tabs, activeTabId} = await loadState();
                    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
                    applyConfig(activeTab, enabled, "update-only");
                },
                onClose: () => {
                    document.getElementById("scf-global-panel")?.remove();
                },
            });
        },
        onPlusClick: async () => {
            const {tabs, activeTabId} = await loadState();
            const newTab = {
                id: crypto.randomUUID(),
                name: uniqueName("New Filter", tabs.map((t) => t.name)),
                type: "settings",
                settings: sanitizeSettings({}),
            };
            openSettingsPanel(newTab, {
                onSave: async (updatedTab) => {
                    const newTabs = [...tabs, updatedTab];
                    // NOTE: `await save(...)` is intentional — activeTabId preserved so new tab does not become active automatically.
                    await save(newTabs, activeTabId);
                    document.getElementById("scf-settings-panel")?.remove();
                    initFilters();
                },
                onClose: () => {
                    document.getElementById("scf-settings-panel")?.remove();
                },
            });
        },
    });

    header.replaceChildren(tabBarEl);
}

waitForElement("#content").then((content) => {
    const observer = new MutationObserver(initFilters);
    observer.observe(content, {childList: true});
});

initFilters();
