if (!window.browser) {
    browser = chrome;
}

// ── Constants ────────────────────────────────────────────────────────────────


const DEFAULT_SETTINGS = {
    filterReposts: {enabled: false, type: "allowRepostedTracksOfFollowers"},
    trackLengthInMin: {enabled: false, min: 0, max: 30},
    contentAgeInDays: {enabled: false, min: null, max: null},
    freeDownloadsOnly: {enabled: false},
    // mode: what to hide — "off" | "played" | "seen"; every mode but "off" records seen tracks.
    // paused: record without hiding. source: whose history to hide — "tab" (this tab's) | "all".
    alreadySeen: {mode: "played", paused: false, source: "all"},
    playlistFilter: {enabled: false, mode: "hideLarge", nameInTitles: false},
    tagFilter: {enabled: false, mode: "include", tags: []},
};

const VALID_SEEN_MODES = new Set(["off", "played", "seen"]);
const HISTORY_KINDS = new Set(["seen", "played"]);
const VALID_SEEN_SOURCES = new Set(["tab", "all"]);

// How long seen tracks are kept (global, storage.sync scfSeenRetention), in months.
const SEEN_RETENTION_LABELS = {1: "1 month", 3: "3 months", 6: "6 months", 12: "1 year"};
const DEFAULT_SEEN_RETENTION = 12;

// Seconds of listening before a play counts (global, scfPlayedThreshold). 0 is
// SoundCloud's own play count, after about a second.
const PLAYED_THRESHOLD_LABELS = {0: "Any play", 10: "10 seconds", 30: "30 seconds", 60: "1 minute"};
const DEFAULT_PLAYED_THRESHOLD = 0;

// When a playlist counts as played (global, scfPlaylistPlayedRule).
const PLAYLIST_PLAYED_RULE_LABELS = {any: "Any track", all: "All tracks"};
const DEFAULT_PLAYLIST_PLAYED_RULE = "any";

const REPOST_TYPE_LABELS = {
    allowNone: "Block all",
    allowRepostedTracksOfFollowers: "Allow from followers",
    allowOnlyFromNotFollowing: "Allow not following",
};
const VALID_FILTER_REPOSTS_TYPES = new Set(Object.keys(REPOST_TYPE_LABELS));

const VALID_PLAYLIST_FILTER_MODES = new Set(["hideLarge", "hideAll"]);

// External links, also used by cards.js.
const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/toaster2";
const GITHUB_ISSUES_URL = "https://github.com/Toasbi/sc-filter-extended/issues";
const COFFEE_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20.216 6.415l-.132-.666c-.119-.598-.388-1.163-1.001-1.379-.197-.069-.42-.098-.57-.241-.152-.143-.196-.366-.231-.572-.065-.378-.125-.756-.192-1.133-.057-.325-.102-.69-.25-.987-.195-.4-.597-.634-.996-.788a5.723 5.723 0 00-.626-.194c-1-.263-2.05-.36-3.077-.416a25.834 25.834 0 00-3.7.062c-.915.083-1.88.184-2.75.5-.318.116-.646.256-.888.501-.297.302-.393.77-.177 1.146.154.267.415.456.692.58.36.162.737.284 1.123.366 1.075.238 2.189.331 3.287.37 1.218.05 2.437.01 3.65-.118.299-.033.598-.073.896-.119.352-.054.578-.513.474-.834-.124-.383-.457-.531-.834-.473-.466.074-.96.108-1.382.146-1.177.08-2.358.082-3.536.006a22.228 22.228 0 01-1.157-.107c-.086-.01-.18-.025-.258-.036-.243-.036-.484-.08-.724-.13-.111-.027-.111-.185 0-.212h.005c.277-.06.557-.108.838-.147h.002c.131-.009.263-.032.394-.048a25.076 25.076 0 013.426-.12c.674.019 1.347.067 2.017.144l.228.031c.267.04.533.088.798.145.392.085.895.113 1.07.542.055.137.08.288.111.431l.319 1.484a.237.237 0 01-.199.284h-.003c-.037.006-.075.01-.112.015a36.704 36.704 0 01-4.743.295 37.059 37.059 0 01-4.699-.304c-.14-.017-.293-.042-.417-.06-.326-.048-.649-.108-.973-.161-.393-.065-.768-.032-1.123.161-.29.16-.527.404-.675.701-.154.316-.199.66-.267 1.001-.069.34-.176.707-.135 1.056.087.753.613 1.365 1.37 1.502a39.69 39.69 0 0011.343.376.483.483 0 01.535.53l-.071.697-1.018 9.907c-.041.41-.047.832-.125 1.237-.122.637-.553 1.028-1.182 1.171-.577.131-1.165.2-1.756.205-.656.004-1.31-.025-1.966-.022-.699.004-1.556-.06-2.095-.58-.475-.458-.54-1.174-.605-1.793l-.731-7.13-.322-3.152c-.037-.36-.351-.634-.708-.618-.339.014-.618.322-.579.694l.318 3.106.907 8.844c.083.808.83 1.6 1.664 1.789.905.204 1.803.238 2.719.243 1.19.007 2.401.007 3.567-.238.85-.178 1.696-.579 2.077-1.412.145-.318.244-.686.312-1.027.09-.457.14-.919.19-1.379l.24-2.2.522-4.789.19-1.751a.237.237 0 01.264-.209c.31.045.63.108.94.16.42.07.844.14 1.267.212 1.24.207 2.454.481 3.685.717.35.067.7.146 1.05.187a.237.237 0 01.208.263l-.174 1.61c-.041.376.207.7.579.72.339.017.626-.247.663-.585l.393-3.625c.017-.16.017-.322-.02-.48z"/></svg>`;

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
    // Legacy "Hide seen tracks" was {enabled: boolean}, later {mode: "on" | "paused" | "off"}.
    // Read it before deepMerge, which drops keys that aren't in DEFAULT_SETTINGS.
    const legacySeen = stored !== null && typeof stored === "object" ? stored.alreadySeen : null;
    const s = deepMerge(DEFAULT_SETTINGS, stored);
    if (legacySeen !== null && typeof legacySeen === "object") {
        if (!("mode" in legacySeen) && typeof legacySeen.enabled === "boolean") {
            s.alreadySeen.mode = legacySeen.enabled ? "seen" : "off";
        } else if (legacySeen.mode === "on" || legacySeen.mode === "paused") {
            s.alreadySeen.mode = "seen";
            s.alreadySeen.paused = legacySeen.mode === "paused";
        }
    }
    if (!VALID_SEEN_MODES.has(s.alreadySeen.mode)) {
        s.alreadySeen.mode = DEFAULT_SETTINGS.alreadySeen.mode;
    }
    if (!VALID_SEEN_SOURCES.has(s.alreadySeen.source)) {
        s.alreadySeen.source = DEFAULT_SETTINGS.alreadySeen.source;
    }
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

// filter.js clamps durations to this, so the slider's top end means "no upper limit".
const TRACK_LENGTH_MAX_MIN = 120;

function tlLabel(minutes) {
    return minutes >= TRACK_LENGTH_MAX_MIN ? `${minutes}+ min` : `${minutes} min`;
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
                trackLengthInMin: {enabled: true, min: 45, max: TRACK_LENGTH_MAX_MIN},
                playlistFilter: {enabled: true, mode: "hideLarge", nameInTitles: true},
            }),
        },
        {
            id: "onlyMixesDowntempo",
            name: "Downtempo mixes",
            type: "settings",
            settings: sanitizeSettings({
                trackLengthInMin: {enabled: true, min: 45, max: TRACK_LENGTH_MAX_MIN},
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

function withSeenPaused(tab, paused) {
    return {...tab, settings: {...tab.settings, alreadySeen: {...tab.settings.alreadySeen, paused}}};
}

// Flips the active tab's paused flag; returns `tabs` itself when there is nothing to flip.
function tabsWithSeenPauseToggled(tabs, activeTabId) {
    const active = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
    if (active?.type !== "settings") return tabs;
    const {mode, paused} = active.settings.alreadySeen;
    if (mode === "off") return tabs;
    return tabs.map((t) => (t === active ? withSeenPaused(t, !paused) : t));
}

// The panel doesn't show the paused flag; it belongs to the tab bar. Changing the mode clears it.
function withStoredPause(tab, stored) {
    if (tab.type !== "settings") return tab;
    const {mode} = tab.settings.alreadySeen;
    const was = stored.settings?.alreadySeen;
    return withSeenPaused(tab, mode !== "off" && was?.mode === mode && was?.paused === true);
}

// kind: "seen" | "played"; scope: "tab" | "all".
function historyListId(tabId, kind, scope) {
    if (kind === "played") return scope === "all" ? "played" : `played:tab:${tabId}`;
    return scope === "all" ? "all" : `tab:${tabId}`;
}

// The scope ("tab" | "all") a tab's history settings hide from, or null when off.
function activeScopeOf({mode, source}) {
    return mode === "off" ? null : source;
}

// The list a tab hides against right now, or null when it hides nothing.
function hiddenListIdOf(tab) {
    if (tab?.type !== "settings") return null;
    const {mode, paused, source} = tab.settings.alreadySeen;
    return mode === "off" || paused ? null : historyListId(tab.id, mode, source);
}

const HISTORY_SENTENCES = {
    "played:tab": "Hides tracks you played while this tab was open.",
    "played:all": "Hides tracks you played on any tab.",
    "seen:tab": "Hides tracks that scrolled past while this tab was open, and ones you played here.",
    "seen:all": "Hides tracks that scrolled past on any tab, and every track you played.",
};

// mode: "played" | "seen"
function historySentence({mode, source}) {
    return HISTORY_SENTENCES[`${mode}:${source}`];
}

// Returns tabs with the entry matching `id` removed and the new active id.
// Precondition: tabs.length > 1 (caller must not call when only 1 tab remains).
function tabsAfterDelete(tabs, id) {
    const idx = tabs.findIndex((t) => t.id === id);
    const newTabs = tabs.filter((t) => t.id !== id);
    const newActiveIdx = idx > 0 ? idx - 1 : 0;
    return {tabs: newTabs, newActiveId: newTabs[newActiveIdx].id};
}

// "9,999" up to 9,999, then "12.3k", "1.2M".
function formatCount(n) {
    if (n < 10000) return n.toLocaleString("en-US");
    return new Intl.NumberFormat("en-US", {notation: "compact", maximumFractionDigits: 1})
        .format(n)
        .replace("K", "k");
}

function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Impure: storage ───────────────────────────────────────────────────────────

async function loadState() {
    try {
        const stored = await browser.storage.sync.get([
            "scFilterTabs",
            "scActiveTabId",
            "scfDebug",
            "scfSeenRetention",
            "scfInfoOpen",
            "scfPlayedThreshold",
            "scfPlaylistPlayedRule",
        ]);

        let tabs = Array.isArray(stored.scFilterTabs) ? stored.scFilterTabs : null;
        if (!tabs) {
            tabs = buildDefaultTabs();
        } else {
            tabs = tabs
                .filter((t) => t && typeof t.id === "string" && typeof t.name === "string" &&
                    (t.type === "settings" || t.type === "deepCuts"))
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

        const seenRetention = Number.isInteger(stored.scfSeenRetention) && stored.scfSeenRetention in SEEN_RETENTION_LABELS
            ? stored.scfSeenRetention
            : DEFAULT_SEEN_RETENTION;

        const infoOpen = stored.scfInfoOpen === true;

        const prefs = {
            debug: stored.scfDebug === true,
            playedThreshold: Number.isInteger(stored.scfPlayedThreshold) && stored.scfPlayedThreshold in PLAYED_THRESHOLD_LABELS
                ? stored.scfPlayedThreshold
                : DEFAULT_PLAYED_THRESHOLD,
            playlistPlayedRule: Object.hasOwn(PLAYLIST_PLAYED_RULE_LABELS, stored.scfPlaylistPlayedRule)
                ? stored.scfPlaylistPlayedRule
                : DEFAULT_PLAYLIST_PLAYED_RULE,
        };

        return {tabs, activeTabId, prefs, seenRetention, infoOpen};
    } catch (_e) {
        const tabs = buildDefaultTabs();
        return {tabs, activeTabId: tabs[0].id, prefs: defaultPrefs(), seenRetention: DEFAULT_SEEN_RETENTION, infoOpen: false};
    }
}

function defaultPrefs() {
    return {debug: false, playedThreshold: DEFAULT_PLAYED_THRESHOLD, playlistPlayedRule: DEFAULT_PLAYLIST_PLAYED_RULE};
}

async function save(tabs, activeTabId) {
    await browser.storage.sync.set({scFilterTabs: tabs, scActiveTabId: activeTabId});
}

// Writes the active tab config (plus the global prefs from loadState) to the
// DOM and notifies filter.js. intent must be "reset-feed" (rebuild the feed
// from scratch) or "update-only" (swap the config for future requests, keep
// the feed as-is). The event payload is a plain string — objects don't cross
// the content-script ↔ page boundary cleanly in Firefox.
function applyConfig(tabConfig, prefs, intent) {
    document.documentElement.dataset.scfConfig = JSON.stringify({...tabConfig, ...prefs});
    document.dispatchEvent(new CustomEvent("scf:apply-config", {detail: intent}));
}

// Persists state, then pushes the new active config into the page and asks
// filter.js to rebuild the feed in place (no page reload). If the in-place
// rebuild fails, filter.js itself falls back to window.location.reload() —
// state is already persisted at that point, so the reload boots into the
// correct tab either way.
async function saveAndResetFeed(tabs, activeTabId, prefs) {
    await save(tabs, activeTabId);
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
    // Start loading the new active tab's seen lists before the feed refetches,
    // so the first scf:seen-query doesn't wait on storage.
    warmSeenLists(activeTab);
    // Before applyConfig: the reset's scf:stats carries the new tab's id.
    setInfoTab(activeTab);
    applyConfig(activeTab, prefs, "reset-feed");
}

// ── Impure: seen storage ──────────────────────────────────────────────────────
// Lists ("tab:<id>", "all", "played:tab:<id>" or "played") are stored as month buckets scfSeen:<listId>:<YYYY-MM>, sized in scfSeenIndex.

const SEEN_INDEX_KEY = "scfSeenIndex";
const SEEN_FLUSH_DELAY_MS = 2000;
// Stays under storage.local's 10 MB quota without needing unlimitedStorage.
const SEEN_MAX_BYTES = 8 * 1024 * 1024;
const SEEN_BYTES_PER_ID = 11;

// listId → Promise<Set<number>>. Loaded lazily; the promise is the "ready"
// gate that seen queries wait on.
const seenSets = new Map();
// listId → Set<number>, filled once the list's load finished. recordIds adds
// to these synchronously, so the next query already sees fresh ids.
const seenLoaded = new Map();
// listId → Set<number> of ids recorded but not yet written to storage.
let seenPending = new Map();
let seenFlushTimer = null;
// Loads and flushes run one at a time, so a load never reads storage halfway
// through a flush (which could drop ids that are neither pending nor stored).
let seenQueue = Promise.resolve();

function enqueueSeenOp(fn) {
    const run = seenQueue.then(fn);
    seenQueue = run.catch(() => {});
    return run;
}

function seenBucketKey(listId, month) {
    return `scfSeen:${listId}:${month}`;
}

function seenMonth(monthsAgo = 0) {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Returns a plain {listId: {month: count}} object from untrusted stored data.
function sanitizeSeenIndex(raw) {
    const index = {};
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return index;
    for (const [listId, months] of Object.entries(raw)) {
        if (months === null || typeof months !== "object" || Array.isArray(months)) continue;
        const clean = {};
        for (const [month, count] of Object.entries(months)) {
            if (/^\d{4}-\d{2}$/.test(month) && Number.isInteger(count) && count >= 0) clean[month] = count;
        }
        index[listId] = clean;
    }
    return index;
}

async function loadSeenSet(listId) {
    const set = new Set();
    try {
        const stored = await browser.storage.local.get(SEEN_INDEX_KEY);
        const months = Object.keys(sanitizeSeenIndex(stored[SEEN_INDEX_KEY])[listId] ?? {});
        if (months.length > 0) {
            const keys = months.map((m) => seenBucketKey(listId, m));
            const buckets = await browser.storage.local.get(keys);
            for (const key of keys) {
                if (!Array.isArray(buckets[key])) continue;
                for (const id of buckets[key]) set.add(id);
            }
        }
    } catch (e) {
        console.error(`[SCF] failed to load seen list ${listId}:`, e);
    }
    // Ids recorded while the list was loading: keep them in memory, but drop
    // the ones storage already has so they stay in their first-seen month.
    const pending = seenPending.get(listId);
    if (pending) {
        for (const id of [...pending]) {
            if (set.has(id)) pending.delete(id);
            else set.add(id);
        }
    }
    seenLoaded.set(listId, set);
    return set;
}

// Returns the list's Set, loading it from storage on first use. Never rejects:
// a failed load yields an empty Set.
function getSeenSet(listId) {
    let ready = seenSets.get(listId);
    if (!ready) {
        ready = enqueueSeenOp(() => loadSeenSet(listId));
        seenSets.set(listId, ready);
    }
    return ready;
}

// Starts loading the lists a tab records into and hides against, if it records at all.
function warmSeenLists(tab) {
    if (tab?.type !== "settings" || tab.settings.alreadySeen.mode === "off") return;
    getSeenSet(historyListId(tab.id, "seen", "tab"));
    getSeenSet("all");
    const hidden = hiddenListIdOf(tab);
    if (hidden !== null) getSeenSet(hidden);
}

function recordSeen(tabId, ids) {
    recordIds([historyListId(tabId, "seen", "tab"), "all"], ids);
}

// A played track also counts as seen, in the shared list and the tab's own, whatever its mode.
function recordPlayed(tabId, ids) {
    const lists = ["played", "all"];
    if (typeof tabId === "string") {
        lists.push(historyListId(tabId, "played", "tab"), historyListId(tabId, "seen", "tab"));
    }
    recordIds(lists, ids);
}

// The in-memory Sets update immediately; storage is written by a debounced flush.
function recordIds(listIds, ids) {
    let added = false;
    for (const listId of listIds) {
        getSeenSet(listId); // make sure the list loads before the flush runs
        const set = seenLoaded.get(listId); // undefined while still loading
        let pending = seenPending.get(listId);
        for (const id of ids) {
            if (set?.has(id) || pending?.has(id)) continue;
            set?.add(id);
            if (!pending) {
                pending = new Set();
                seenPending.set(listId, pending);
            }
            pending.add(id);
            added = true;
        }
    }
    if (added) {
        scheduleSeenFlush();
        scheduleInfoRefresh();
    }
}

function scheduleSeenFlush() {
    if (seenFlushTimer !== null) return;
    seenFlushTimer = setTimeout(() => {
        seenFlushTimer = null;
        enqueueSeenOp(flushSeen).catch(console.error);
    }, SEEN_FLUSH_DELAY_MS);
}

// Writes pending ids into the current month's buckets and updates the index.
// Read-merge-write, so two SoundCloud windows don't overwrite each other.
async function flushSeen() {
    if (seenPending.size === 0) return;
    const batch = seenPending;
    seenPending = new Map();
    const month = seenMonth();
    try {
        const keys = [...batch.keys()].map((listId) => seenBucketKey(listId, month));
        const stored = await browser.storage.local.get([SEEN_INDEX_KEY, ...keys]);
        const index = sanitizeSeenIndex(stored[SEEN_INDEX_KEY]);
        const updates = {};
        for (const [listId, ids] of batch) {
            const key = seenBucketKey(listId, month);
            const bucket = Array.isArray(stored[key]) ? stored[key] : [];
            const inBucket = new Set(bucket);
            for (const id of ids) {
                if (!inBucket.has(id)) {
                    bucket.push(id);
                    inBucket.add(id);
                }
            }
            updates[key] = bucket;
            index[listId] = {...(index[listId] ?? {}), [month]: bucket.length};
        }
        updates[SEEN_INDEX_KEY] = index;
        await browser.storage.local.set(updates);
    } catch (e) {
        console.error("[SCF] failed to save seen tracks:", e);
        // Keep the ids for the next flush.
        for (const [listId, ids] of batch) {
            const pending = seenPending.get(listId) ?? new Set();
            for (const id of ids) pending.add(id);
            seenPending.set(listId, pending);
        }
    }
}

// Flushes immediately (best effort) when the page goes away, so a refresh
// right after scrolling doesn't lose the last debounce window.
function flushSeenNow() {
    if (seenFlushTimer !== null) {
        clearTimeout(seenFlushTimer);
        seenFlushTimer = null;
    }
    if (seenPending.size > 0) enqueueSeenOp(flushSeen).catch(console.error);
}

// Queued so an in-flight flush is either fully counted (index) or still pending.
function seenCount(listId) {
    return enqueueSeenOp(async () => {
        const stored = await browser.storage.local.get(SEEN_INDEX_KEY);
        const months = sanitizeSeenIndex(stored[SEEN_INDEX_KEY])[listId] ?? {};
        const flushed = Object.values(months).reduce((sum, n) => sum + n, 0);
        return flushed + (seenPending.get(listId)?.size ?? 0);
    }).catch((e) => {
        console.error(`[SCF] failed to count seen list ${listId}:`, e);
        return 0;
    });
}

// Removes the given lists from storage and memory; null removes every list.
function clearSeen(listIds) {
    return enqueueSeenOp(async () => {
        const stored = await browser.storage.local.get(SEEN_INDEX_KEY);
        const index = sanitizeSeenIndex(stored[SEEN_INDEX_KEY]);
        const targets = listIds ?? [...new Set([...Object.keys(index), ...seenSets.keys(), ...seenPending.keys()])];
        const keys = [];
        for (const listId of targets) {
            for (const month of Object.keys(index[listId] ?? {})) keys.push(seenBucketKey(listId, month));
            delete index[listId];
            seenSets.delete(listId);
            seenLoaded.delete(listId);
            seenPending.delete(listId);
        }
        if (listIds === null) {
            await browser.storage.local.remove([...keys, SEEN_INDEX_KEY]);
        } else {
            await browser.storage.local.remove(keys);
            await browser.storage.local.set({[SEEN_INDEX_KEY]: index});
        }
    }).catch((e) => console.error("[SCF] failed to clear seen tracks:", e))
        .finally(() => { refreshInfoCounts(); });
}

// Keeps the current month plus the last `retentionMonths`, so a track stays
// hidden for N to N+1 months. Then drops the oldest buckets of any list
// until the estimated size fits SEEN_MAX_BYTES.
function pruneSeen(retentionMonths) {
    return enqueueSeenOp(async () => {
        const stored = await browser.storage.local.get(SEEN_INDEX_KEY);
        const index = sanitizeSeenIndex(stored[SEEN_INDEX_KEY]);
        const oldestKept = seenMonth(retentionMonths);
        const buckets = [];
        for (const [listId, months] of Object.entries(index)) {
            for (const [month, count] of Object.entries(months)) buckets.push({listId, month, count});
        }
        buckets.sort((a, b) => a.month.localeCompare(b.month));
        let bytes = buckets.reduce((sum, b) => sum + b.count * SEEN_BYTES_PER_ID, 0);
        const dropped = buckets.filter((b) => {
            if (b.month >= oldestKept && bytes <= SEEN_MAX_BYTES) return false;
            bytes -= b.count * SEEN_BYTES_PER_ID;
            return true;
        });
        if (dropped.length === 0) return;
        for (const {listId, month} of dropped) {
            delete index[listId][month];
            if (Object.keys(index[listId]).length === 0) delete index[listId];
            // Reloaded on next use; pending ids are merged back in by loadSeenSet.
            seenSets.delete(listId);
            seenLoaded.delete(listId);
        }
        await browser.storage.local.remove(dropped.map((b) => seenBucketKey(b.listId, b.month)));
        await browser.storage.local.set({[SEEN_INDEX_KEY]: index});
    }).catch((e) => console.error("[SCF] failed to prune seen tracks:", e))
        .finally(() => { refreshInfoCounts(); });
}

// Estimated from the index so no ids have to be loaded.
function seenBytes() {
    return enqueueSeenOp(async () => {
        const stored = await browser.storage.local.get(SEEN_INDEX_KEY);
        let ids = 0;
        for (const months of Object.values(sanitizeSeenIndex(stored[SEEN_INDEX_KEY]))) {
            for (const count of Object.values(months)) ids += count;
        }
        for (const pending of seenPending.values()) ids += pending.size;
        return ids * SEEN_BYTES_PER_ID;
    }).catch((e) => {
        console.error("[SCF] failed to measure seen tracks:", e);
        return 0;
    });
}

// {tabSeen, tabPlayed, allSeen, allPlayed} for the tab with id `tabId`.
async function historyCounts(tabId) {
    const [tabSeen, tabPlayed, allSeen, allPlayed] = await Promise.all([
        seenCount(historyListId(tabId, "seen", "tab")),
        seenCount(historyListId(tabId, "played", "tab")),
        seenCount("all"),
        seenCount("played"),
    ]);
    return {tabSeen, tabPlayed, allSeen, allPlayed};
}

async function seenSummary(tabId) {
    const [counts, bytes] = await Promise.all([historyCounts(tabId), seenBytes()]);
    return {...counts, bytes};
}

// Clears both lists of one scope ("tab" | "all") and rebuilds the feed only if
// the active tab currently hides against one of them.
async function resetHistoryScope(tabId, scope) {
    const listIds = [historyListId(tabId, "seen", scope), historyListId(tabId, "played", scope)];
    await clearSeen(listIds);
    const {tabs, activeTabId, prefs} = await loadState();
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
    if (listIds.includes(hiddenListIdOf(activeTab))) {
        await saveAndResetFeed(tabs, activeTabId, prefs);
    }
}

// Seen channel with filter.js. Registered once per page; details are JSON
// strings (Firefox-safe, see applyConfig). Page scripts can dispatch these
// events too, so every payload is validated.
document.addEventListener("scf:seen-query", (event) => {
    let query;
    try {
        query = JSON.parse(event.detail);
    } catch (_e) {
        return;
    }
    if (!query || typeof query.tabId !== "string" || !Array.isArray(query.ids)) return;
    if (!HISTORY_KINDS.has(query.list) || !VALID_SEEN_SOURCES.has(query.source)) return;
    getSeenSet(historyListId(query.tabId, query.list, query.source)).then((set) => {
        const seen = query.ids.filter((id) => set.has(id));
        document.dispatchEvent(new CustomEvent("scf:seen-result", {
            detail: JSON.stringify({reqId: query.reqId, seen}),
        }));
    });
});

document.addEventListener("scf:seen", (event) => {
    let report;
    try {
        report = JSON.parse(event.detail);
    } catch (_e) {
        return;
    }
    if (!report || typeof report.tabId !== "string" || !Array.isArray(report.ids)) return;
    const ids = report.ids.filter((id) => Number.isInteger(id));
    if (ids.length > 0) recordSeen(report.tabId, ids);
});

document.addEventListener("scf:played", (event) => {
    let report;
    try {
        report = JSON.parse(event.detail);
    } catch (_e) {
        return;
    }
    if (!report || !(report.tabId === null || typeof report.tabId === "string") || !Array.isArray(report.ids)) return;
    const ids = report.ids.filter((id) => Number.isInteger(id));
    if (ids.length > 0) recordPlayed(report.tabId, ids);
});

window.addEventListener("pagehide", flushSeenNow);
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSeenNow();
});

// ── Impure: tab bar info section ──────────────────────────────────────────────

let infoTab = null; // the active tab the info section describes
let infoCounts = {tabSeen: 0, tabPlayed: 0, allSeen: 0, allPlayed: 0};
let infoStats = null; // last scf:stats of infoTab, null until its feed reports

function setInfoTab(tab) {
    if (infoTab?.id !== tab.id) infoStats = null;
    infoTab = tab;
    const counted = refreshInfoCounts();
    renderInfo();
    return counted;
}

let infoRefreshTimer = null;

// recordSeen runs once per track scrolled on screen; one count read per burst is enough.
function scheduleInfoRefresh() {
    if (infoRefreshTimer !== null) return;
    infoRefreshTimer = setTimeout(() => {
        infoRefreshTimer = null;
        refreshInfoCounts();
    }, 500);
}

async function refreshInfoCounts() {
    const tab = infoTab;
    if (!tab) return;
    const counts = await historyCounts(tab.id);
    // A newer refresh for the new tab is already on its way.
    if (infoTab?.id !== tab.id) return;
    infoCounts = counts;
    renderInfo();
}

// Queries the live bar each time: initFilters can swap in a new one at any point.
function renderInfo() {
    const item = document.querySelector("#scf-tab-bar .scf-info-item");
    if (!item || !infoTab) return;
    const {mode, paused, source} = infoTab.type === "settings"
        ? infoTab.settings.alreadySeen
        : {mode: "off", paused: false, source: "tab"};
    const off = mode === "off";
    const played = mode === "played";
    const noun = played ? "Played" : "Seen";
    const toggle = item.querySelector(".scf-seen-toggle");
    toggle.hidden = off;
    toggle.classList.toggle("scf-paused", paused);
    toggle.querySelector(".scf-seen-toggle-label").textContent = paused ? "Resume hiding" : "Pause hiding";
    toggle.title = paused ? `Hide ${noun.toLowerCase()} tracks on this tab again` : "Show hidden tracks temporarily";
    item.querySelector(".scf-info-seen-label").textContent =
        off ? "Seen: off" : paused ? `${noun} (paused):` : `${noun}:`;
    for (const el of item.querySelectorAll(".scf-info-seen")) {
        const scope = el.dataset.source;
        el.textContent = `${formatCount(infoCounts[scope + noun])} ${scope === "all" ? "all tabs" : "this tab"}`;
        el.classList.toggle("scf-info-muted", scope !== source);
        el.hidden = off;
    }
    item.querySelector(".scf-info-seen-sep").hidden = off;
    const {filtered, scanned} = infoStats ?? {filtered: 0, scanned: 0};
    item.querySelector(".scf-info-filtered").textContent =
        `Skipped: ${formatCount(filtered)} of ${formatCount(scanned)}`;
}

document.addEventListener("scf:stats", (event) => {
    let stats;
    try {
        stats = JSON.parse(event.detail);
    } catch (_e) {
        return;
    }
    if (!stats || typeof stats.tabId !== "string" || stats.tabId !== infoTab?.id) return;
    if (!Number.isInteger(stats.filtered) || !Number.isInteger(stats.scanned)) return;
    infoStats = {filtered: stats.filtered, scanned: stats.scanned};
    renderInfo();
});

// ── Pure: DOM builders ────────────────────────────────────────────────────────

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
function buildTabBar(tabs, activeId, {infoOpen}) {
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

    // Numbers are filled in by renderInfo().
    const infoLi = document.createElement("li");
    infoLi.className = "g-tabs-item scf-info-item";
    infoLi.innerHTML = `<button class="scf-seen-toggle" hidden>
        <svg class="scf-seen-pause-icon" width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>
        <svg class="scf-seen-play-icon" width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 4 2.5Z"/></svg>
        <span class="scf-seen-toggle-label"></span>
      </button>
      <a class="g-tabs-link scf-info-link" href="#"><svg width="13" height="13" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM7.25 7h1.5v4.5h-1.5V7ZM8 4.1a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z"/></svg></a>
      <span class="scf-info-body">
        <span class="scf-info-seen-label"></span>
        <span class="scf-info-seen" data-source="all"></span>
        <span class="scf-info-sep scf-info-seen-sep">·</span>
        <span class="scf-info-seen" data-source="tab"></span>
        <span class="scf-info-sep">|</span>
        <span class="scf-info-filtered" title="Items hidden by this tab since the feed was last loaded"></span>
      </span>`;
    setInfoOpen(infoLi, infoOpen);
    ul.appendChild(infoLi);

    return ul;
}

function setInfoOpen(infoLi, open) {
    infoLi.classList.toggle("scf-info-open", open);
    infoLi.querySelector(".scf-info-link").title = open ? "Hide tab stats" : "Show tab stats";
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

function selectHtml(id, labels, selected) {
    const options = Object.entries(labels).map(([value, label]) =>
        `<option value="${value}"${value === String(selected) ? " selected" : ""}>${label}</option>`
    ).join("");
    return `<div class="scf-select-wrap">
          <select class="scf-select" id="${id}">${options}</select>
          <svg class="scf-select-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>
        </div>`;
}

function retentionTip(months) {
    return `Hides seen and played tracks for ${SEEN_RETENTION_LABELS[months]}, then they show up again. Applies to every tab.`;
}

function historyTip(months) {
    return `Played hides tracks you played; Seen also hides everything that scrolled past on screen. Both are remembered for ${SEEN_RETENTION_LABELS[months]}. Pause hiding from the tab bar.`;
}

// scope: "tab" | "all"
function historyCountLine(scope, label, seen, played, activeScope) {
    return `<div class="scf-seen-count${scope === activeScope ? "" : " scf-seen-count-muted"}" data-source="${scope}" data-seen="${seen}" data-played="${played}">
          ${label}: <span class="scf-seen-num">${formatCount(seen)}</span> seen · <span class="scf-seen-num">${formatCount(played)}</span> played<span class="scf-seen-reset-wrap"${seen + played === 0 ? " hidden" : ""}> · <button class="scf-seen-reset">Reset</button></span>
        </div>`;
}

function buildSettingsPanel(tab, {counts, retention}) {
    const s = tab.type === "settings" ? tab.settings : sanitizeSettings({});
    const historyOn = s.alreadySeen.mode !== "off";
    // Preselected while off, so re-enabling has a sensible mode.
    const historyMode = historyOn ? s.alreadySeen.mode : "played";
    const panel = document.createElement("div");
    panel.id = "scf-settings-panel";

    panel.innerHTML = `
    <div class="scf-panel-header">
      <input class="scf-name-input" type="text" placeholder="Filter name">
      <button class="scf-close-btn" title="Close">×</button>
    </div>
    <div class="scf-body">
      <div class="scf-group">
        <div class="scf-row">
          <span class="scf-row-label">Repost filter <span class="scf-help" data-tip="Block all reposts, allow only from people you follow, or show only from people you don't follow.">?</span></span>
          <label class="scf-toggle">
            <input type="checkbox" id="scf-fr-toggle"${s.filterReposts.enabled ? " checked" : ""}>
            <span class="scf-toggle-track"></span>
          </label>
        </div>
        <div class="scf-sub-section${s.filterReposts.enabled ? " scf-visible" : ""}" id="scf-fr-sub">
          ${selectHtml("scf-fr-type", REPOST_TYPE_LABELS, s.filterReposts.type)}
          <p id="scf-fr-info" class="scf-filter-info">${REPOST_INFO[s.filterReposts.type] ?? ""}</p>
        </div>
      </div>

      <div class="scf-group">
        <div class="scf-row">
          <span class="scf-row-label">Playlist filter <span class="scf-help" data-tip="Controls how playlists are handled in your feed.">?</span></span>
          <label class="scf-toggle">
            <input type="checkbox" id="scf-pf-toggle"${s.playlistFilter.enabled ? " checked" : ""}>
            <span class="scf-toggle-track"></span>
          </label>
        </div>
        <div class="scf-sub-section${s.playlistFilter.enabled ? " scf-visible" : ""}" id="scf-pf-sub">
          <div class="scf-segmented" id="scf-pf-mode">
            <button class="scf-seg-btn${s.playlistFilter.mode === "hideLarge" ? " scf-active" : ""}" data-mode="hideLarge">Hide large</button>
            <button class="scf-seg-btn${s.playlistFilter.mode === "hideAll" ? " scf-active" : ""}" data-mode="hideAll">Hide all</button>
          </div>
          <p id="scf-pf-info" class="scf-filter-info">${PLAYLIST_INFO[s.playlistFilter.mode] ?? ""}</p>
          <div class="scf-inline-row${s.playlistFilter.mode !== "hideLarge" ? " scf-row-disabled" : ""}" id="scf-pf-nit-row">
            <span class="scf-row-label">Reposter name in titles <span class="scf-help" data-tip="Only show playlists where the reposter's username appears in at least one track title. Only available when Hide large mode is selected.">?</span></span>
            <label class="scf-toggle">
              <input type="checkbox" id="scf-pf-nit-toggle"${s.playlistFilter.nameInTitles ? " checked" : ""}${s.playlistFilter.mode !== "hideLarge" ? " disabled" : ""}>
              <span class="scf-toggle-track"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="scf-group">
        <div class="scf-row">
          <span class="scf-row-label">Tag filter <span class="scf-help" data-tip="Include mode: only show items matching your tags. Exclude mode: hide items with your tags.">?</span></span>
          <label class="scf-toggle">
            <input type="checkbox" id="scf-tf-toggle"${s.tagFilter.enabled ? " checked" : ""}>
            <span class="scf-toggle-track"></span>
          </label>
        </div>
        <div id="scf-tag-section" class="scf-sub-section${s.tagFilter.enabled ? " scf-visible" : ""}">
          <div class="scf-segmented">
            <button id="scf-tf-include" class="scf-seg-btn${s.tagFilter.mode === "include" ? " scf-active" : ""}">Include</button>
            <button id="scf-tf-exclude" class="scf-seg-btn${s.tagFilter.mode === "exclude" ? " scf-active" : ""}">Exclude</button>
          </div>
          <div class="scf-tag-input-row">
            <input type="text" id="scf-tf-input" class="scf-tag-input" placeholder="add tag…">
            <button id="scf-tf-add" class="scf-btn scf-btn-sm scf-tag-add-btn">Add</button>
          </div>
          <div id="scf-tag-chips" class="scf-tag-chips"></div>
          <p class="scf-warning" id="scf-tf-warning"${!(s.tagFilter.enabled && s.tagFilter.mode === "include" && s.tagFilter.tags.length === 0) ? " hidden" : ""}>⚠ Include mode with no tags will hide everything</p>
        </div>
      </div>

      <div class="scf-group">
        <div class="scf-row">
          <span class="scf-row-label">Track length <span class="scf-help" data-tip="Filter tracks by duration in minutes.">?</span></span>
          <label class="scf-toggle">
            <input type="checkbox" id="scf-tl-toggle"${s.trackLengthInMin.enabled ? " checked" : ""}>
            <span class="scf-toggle-track"></span>
          </label>
        </div>
        <div class="scf-sub-section scf-slider-section${s.trackLengthInMin.enabled ? " scf-visible" : ""}" id="scf-tl-section">
          <div class="scf-slider-labels">
            <span id="scf-tl-min-label">${tlLabel(s.trackLengthInMin.min)}</span>
            <span id="scf-tl-max-label">${tlLabel(s.trackLengthInMin.max)}</span>
          </div>
          <div class="scf-slider-wrap">
            <div class="scf-slider-base"></div>
            <div class="scf-slider-fill" id="scf-tl-fill"></div>
            <input type="range" id="scf-tl-min" min="0" max="${TRACK_LENGTH_MAX_MIN}" step="1" value="${s.trackLengthInMin.min}">
            <input type="range" id="scf-tl-max" min="0" max="${TRACK_LENGTH_MAX_MIN}" step="1" value="${s.trackLengthInMin.max}">
          </div>
        </div>
      </div>

      <div class="scf-group">
        <div class="scf-row">
          <span class="scf-row-label">Content age <span class="scf-help" data-tip="Filter by how long ago tracks appeared in your feed (left) and were uploaded (right).">?</span></span>
          <label class="scf-toggle">
            <input type="checkbox" id="scf-ca-toggle"${s.contentAgeInDays.enabled ? " checked" : ""}>
            <span class="scf-toggle-track"></span>
          </label>
        </div>
        <div class="scf-sub-section scf-slider-section${s.contentAgeInDays.enabled ? " scf-visible" : ""}" id="scf-ca-section">
          <div class="scf-slider-labels" id="scf-ca-label">${caLabel(s.contentAgeInDays.min, s.contentAgeInDays.max)}</div>
          <div class="scf-slider-wrap">
            <div class="scf-slider-base"></div>
            <div class="scf-slider-fill" id="scf-ca-fill"></div>
            <input type="range" id="scf-ca-min" min="0" max="31" step="1" value="${storageToUiMin(s.contentAgeInDays.min)}">
            <input type="range" id="scf-ca-max" min="0" max="31" step="1" value="${storageToUiMax(s.contentAgeInDays.max)}">
          </div>
        </div>
      </div>

      <div class="scf-row">
        <span class="scf-row-label">Free downloads only <span class="scf-help" data-tip="Only show tracks with a free download link.">?</span></span>
        <label class="scf-toggle">
          <input type="checkbox" id="scf-fd-toggle"${s.freeDownloadsOnly.enabled ? " checked" : ""}>
          <span class="scf-toggle-track"></span>
        </label>
      </div>

      <div class="scf-group">
        <div class="scf-row">
          <span class="scf-row-label">Hide tracks I've… <span class="scf-help" data-tip="${historyTip(retention)}">?</span></span>
          <label class="scf-toggle">
            <input type="checkbox" id="scf-as-toggle"${historyOn ? " checked" : ""}>
            <span class="scf-toggle-track"></span>
          </label>
        </div>
        <div class="scf-sub-section${historyOn ? " scf-visible" : ""}" id="scf-as-sub">
          <div class="scf-segmented" id="scf-as-mode">
            <button class="scf-seg-btn${historyMode === "played" ? " scf-active" : ""}" data-mode="played">Played</button>
            <button class="scf-seg-btn${historyMode === "seen" ? " scf-active" : ""}" data-mode="seen">Seen</button>
          </div>
          <div class="scf-segmented" id="scf-as-source">
            <button class="scf-seg-btn${s.alreadySeen.source === "tab" ? " scf-active" : ""}" data-source="tab">In this tab</button>
            <button class="scf-seg-btn${s.alreadySeen.source === "all" ? " scf-active" : ""}" data-source="all">In any tab</button>
          </div>
          <p class="scf-filter-info" id="scf-as-info">${historySentence({mode: historyMode, source: s.alreadySeen.source})}</p>
        </div>
      </div>

      <div class="scf-group">
        <div class="scf-row">
          <span class="scf-row-label">History</span>
        </div>
        <div class="scf-sub-section scf-visible scf-seen-counts">
          ${historyCountLine("tab", "This tab", counts.tabSeen, counts.tabPlayed, activeScopeOf(s.alreadySeen))}
          ${historyCountLine("all", "All tabs", counts.allSeen, counts.allPlayed, activeScopeOf(s.alreadySeen))}
        </div>
      </div>
    </div>
    <div class="scf-panel-footer">
      <button class="scf-text-btn scf-delete-btn" id="scf-delete-btn">Delete</button>
      <button class="scf-btn" id="scf-close-footer-btn">Close</button>
      <button class="scf-btn scf-btn-primary" id="scf-save-btn">Save</button>
    </div>
  `;

    panel.querySelector(".scf-name-input").value = tab.name;

    return panel;
}

function buildGlobalPanel({debug, playedThreshold, playlistPlayedRule}, {retention, activeTab, seen}) {
    const panel = document.createElement("div");
    panel.id = "scf-global-panel";
    panel.innerHTML = `
    <div class="scf-panel-header">
      <span class="scf-panel-title">Extension settings</span>
      <button class="scf-close-btn" title="Close">×</button>
    </div>
    <div class="scf-body">
      <div class="scf-row">
        <span class="scf-row-label">Remember seen &amp; played tracks <span class="scf-help" id="scf-seen-retention-help" data-tip="${retentionTip(retention)}">?</span></span>
        ${selectHtml("scf-seen-retention", SEEN_RETENTION_LABELS, retention)}
      </div>
      <div class="scf-row">
        <span class="scf-row-label">Track counts as played <span class="scf-nowrap">after <span class="scf-help" data-tip="How long a track has to play before it counts as played. Any play counts as soon as SoundCloud does, after about a second. Seeking doesn't count.">?</span></span></span>
        ${selectHtml("scf-played-threshold", PLAYED_THRESHOLD_LABELS, playedThreshold)}
      </div>
      <div class="scf-row">
        <span class="scf-row-label">Playlists count as played <span class="scf-nowrap">after playing <span class="scf-help" data-tip="On tabs that hide played tracks: hide a playlist once any of its tracks was played, or only once all of them were.">?</span></span></span>
        ${selectHtml("scf-playlist-played-rule", PLAYLIST_PLAYED_RULE_LABELS, playlistPlayedRule)}
      </div>
      <div class="scf-group" id="scf-seen-data">
        <div class="scf-row">
          <span class="scf-row-label">History</span>
          <button class="scf-seen-reset" id="scf-clear-seen-btn"${seen.bytes === 0 ? " hidden" : ""}>Clear all</button>
        </div>
        <div class="scf-sub-section scf-visible scf-seen-counts">
          <div class="scf-seen-count"><span class="scf-seen-tab-name"></span>: <span class="scf-seen-num" data-count="tabSeen">${formatCount(seen.tabSeen)}</span> seen · <span class="scf-seen-num" data-count="tabPlayed">${formatCount(seen.tabPlayed)}</span> played</div>
          <div class="scf-seen-count">All tabs: <span class="scf-seen-num" data-count="allSeen">${formatCount(seen.allSeen)}</span> seen · <span class="scf-seen-num" data-count="allPlayed">${formatCount(seen.allPlayed)}</span> played · <span class="scf-seen-num" data-count="bytes">${formatBytes(seen.bytes)}</span></div>
        </div>
      </div>
      <div class="scf-row">
        <span class="scf-row-label">Debug logging <span class="scf-help" data-tip="Logs each feed item and why it was shown or filtered to the browser console (DevTools → Console).">?</span></span>
        <label class="scf-toggle">
          <input type="checkbox" id="scf-debug-checkbox"${debug ? " checked" : ""}>
          <span class="scf-toggle-track"></span>
        </label>
      </div>
      <div class="scf-row">
        <span class="scf-row-label">Default tabs</span>
        <button class="scf-btn scf-btn-sm" id="scf-restore-btn">Restore</button>
      </div>
      <div class="scf-global-links">
        <button class="scf-help-btn" id="scf-tour-btn">Show welcome tour</button>
        <a class="scf-help-btn" href="${GITHUB_ISSUES_URL}" target="_blank" rel="noopener noreferrer">Help &amp; report an issue</a>
        <a class="scf-coffee-btn" href="${BUY_ME_A_COFFEE_URL}" target="_blank" rel="noopener noreferrer">
          ${COFFEE_ICON_SVG}
          <span>Buy me a coffee</span>
        </a>
      </div>
    </div>
    <div class="scf-panel-footer">
      <a class="scf-help-btn scf-rate-btn" href="${STORE_URL}" target="_blank" rel="noopener noreferrer">Rate the extension</a>
    </div>
  `;
    // textContent: tab names are user input.
    panel.querySelector(".scf-seen-tab-name").textContent = activeTab.name;
    return panel;
}

// ── Impure: tab bar listeners ─────────────────────────────────────────────────

function attachTabBarListeners(el, handlers) {
    const {onTabClick, onGearClick, onGlobalGearClick, onPlusClick, onInfoToggle, onSeenPauseToggle} = handlers;

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

    const infoLi = el.querySelector(".scf-info-item");
    infoLi.querySelector(".scf-info-link").addEventListener("click", (e) => {
        e.preventDefault();
        const open = !infoLi.classList.contains("scf-info-open");
        setInfoOpen(infoLi, open);
        onInfoToggle(open);
    });

    const seenToggle = infoLi.querySelector(".scf-seen-toggle");
    seenToggle.addEventListener("click", () => {
        seenToggle.disabled = true;
        onSeenPauseToggle()
            .catch(console.error)
            .finally(() => { seenToggle.disabled = false; });
    });
}

// ── Impure: panels ────────────────────────────────────────────────────────────

function dualSlider(el, prefix, maxFloor, renderLabel) {
    const minEl = el.querySelector(`#scf-${prefix}-min`);
    const maxEl = el.querySelector(`#scf-${prefix}-max`);
    const fill = el.querySelector(`#scf-${prefix}-fill`);
    const range = Number(maxEl.max);

    function update() {
        const mn = parseInt(minEl.value, 10);
        const mx = parseInt(maxEl.value, 10);
        fill.style.left = (mn / range * 100) + "%";
        fill.style.right = ((range - mx) / range * 100) + "%";
        renderLabel(mn, mx);
    }

    minEl.addEventListener("input", () => {
        if (parseInt(minEl.value, 10) > parseInt(maxEl.value, 10)) minEl.value = maxEl.value;
        update();
    });
    maxEl.addEventListener("input", () => {
        const limit = Math.max(maxFloor, parseInt(minEl.value, 10));
        if (parseInt(maxEl.value, 10) < limit) maxEl.value = limit;
        update();
    });

    update();
}

function attachPanelListeners(el, tab, {onSave, onDelete, onClose, onResetHistory}) {
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
        const updatedTab = readPanelState();
        onSave(updatedTab).catch(console.error);
    });

    // filterReposts toggle ↔ sub-section visibility
    const frToggle = el.querySelector("#scf-fr-toggle");
    const frSub = el.querySelector("#scf-fr-sub");
    frToggle.addEventListener("change", () => {
        frSub.classList.toggle("scf-visible", frToggle.checked);
    });

    // Segmented controls — mutually exclusive within their own group
    for (const group of el.querySelectorAll(".scf-segmented")) {
        const buttons = group.querySelectorAll(".scf-seg-btn");
        for (const btn of buttons) {
            btn.addEventListener("click", () => {
                for (const b of buttons) b.classList.toggle("scf-active", b === btn);
            });
        }
    }

    const frInfoEl = el.querySelector("#scf-fr-info");
    el.querySelector("#scf-fr-type").addEventListener("change", (e) => {
        frInfoEl.textContent = REPOST_INFO[e.target.value] ?? "";
    });

    const countLines = el.querySelectorAll(".scf-seen-count");
    const asToggle = el.querySelector("#scf-as-toggle");
    const asSub = el.querySelector("#scf-as-sub");
    const infoEl = el.querySelector("#scf-as-info");
    // Runs after the segmented group's own handler has moved scf-active.
    function renderHistoryChoice() {
        const choice = readHistoryChoice();
        asSub.classList.toggle("scf-visible", asToggle.checked);
        infoEl.textContent = historySentence({mode: selectedHistoryMode(), source: choice.source});
        const activeScope = activeScopeOf(choice);
        for (const line of countLines) {
            line.classList.toggle("scf-seen-count-muted", line.dataset.source !== activeScope);
        }
    }
    asToggle.addEventListener("change", renderHistoryChoice);
    for (const btn of el.querySelectorAll("#scf-as-mode .scf-seg-btn, #scf-as-source .scf-seg-btn")) {
        btn.addEventListener("click", renderHistoryChoice);
    }
    for (const line of countLines) {
        const scope = line.dataset.source;
        line.querySelector(".scf-seen-reset").addEventListener("click", () => {
            const counts = `${formatCount(Number(line.dataset.seen))} seen and ${formatCount(Number(line.dataset.played))} played tracks`;
            const question = scope === "all"
                ? `Forget ${counts} across all tabs? Each tab's own history is kept.`
                : `Forget ${counts} of this tab?`;
            if (!confirm(question)) return;
            onResetHistory(tab.id, scope)
                .then(() => {
                    line.dataset.seen = "0";
                    line.dataset.played = "0";
                    for (const num of line.querySelectorAll(".scf-seen-num")) num.textContent = formatCount(0);
                    line.querySelector(".scf-seen-reset-wrap").hidden = true;
                })
                .catch(console.error);
        });
    }

    // Playlist filter toggle shows/hides sub-section
    el.querySelector("#scf-pf-toggle").addEventListener("change", (e) => {
        el.querySelector("#scf-pf-sub").classList.toggle("scf-visible", e.target.checked);
    });

    // Playlist filter mode segmented buttons
    const pfNitRow = el.querySelector("#scf-pf-nit-row");
    const pfNitToggle = el.querySelector("#scf-pf-nit-toggle");
    for (const btn of el.querySelectorAll("#scf-pf-mode .scf-seg-btn")) {
        btn.addEventListener("click", () => {
            // nameInTitles is only active with hideLarge — disable the row for other modes
            const isHideLarge = btn.dataset.mode === "hideLarge";
            pfNitRow.classList.toggle("scf-row-disabled", !isHideLarge);
            pfNitToggle.disabled = !isHideLarge;
            if (!isHideLarge) pfNitToggle.checked = false;
            el.querySelector("#scf-pf-info").textContent = PLAYLIST_INFO[btn.dataset.mode] ?? "";
        });
    }

    // Track length toggle + dual slider
    el.querySelector("#scf-tl-toggle").addEventListener("change", (e) => {
        el.querySelector("#scf-tl-section").classList.toggle("scf-visible", e.target.checked);
    });
    const tlMinLabel = el.querySelector("#scf-tl-min-label");
    const tlMaxLabel = el.querySelector("#scf-tl-max-label");
    dualSlider(el, "tl", 0, (mn, mx) => {
        tlMinLabel.textContent = tlLabel(mn);
        tlMaxLabel.textContent = tlLabel(mx);
    });

    // Content age toggle + dual slider
    el.querySelector("#scf-ca-toggle").addEventListener("change", (e) => {
        el.querySelector("#scf-ca-section").classList.toggle("scf-visible", e.target.checked);
    });
    const caLabelEl = el.querySelector("#scf-ca-label");
    // The right knob must stay ≥ 1 — a 0-day upload cap hides everything.
    dualSlider(el, "ca", 1, (mn, mx) => {
        caLabelEl.textContent = caLabel(uiToStorageMin(mn), uiToStorageMax(mx));
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
    const tfClear = document.createElement("button");
    tfClear.className = "scf-seen-reset scf-tag-clear-btn";
    tfClear.textContent = "Clear all";

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
        chipContainer.appendChild(tfClear);
        chipContainer.hidden = localTags.length === 0;
        tagWarning.hidden = !(
            tfToggle.checked && localMode === "include" && localTags.length === 0
        );
    }

    renderChips();

    tfToggle.addEventListener("change", () => {
        tagSection.classList.toggle("scf-visible", tfToggle.checked);
        renderChips();
    });

    tfInclude.addEventListener("click", () => {
        localMode = "include";
        renderChips();
    });
    tfExclude.addEventListener("click", () => {
        localMode = "exclude";
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

    function selectedHistoryMode() {
        return el.querySelector("#scf-as-mode .scf-seg-btn.scf-active")?.dataset.mode ?? "played";
    }

    function readHistoryChoice() {
        const current = tab.type === "settings" ? tab.settings.alreadySeen : sanitizeSettings({}).alreadySeen;
        return {
            mode: asToggle.checked ? selectedHistoryMode() : "off",
            paused: current.paused,
            source: el.querySelector("#scf-as-source .scf-seg-btn.scf-active")?.dataset.source ?? current.source,
        };
    }

    function readPanelState() {
        const settings = tab.type === "settings"
            ? JSON.parse(JSON.stringify(tab.settings))
            : sanitizeSettings({});

        settings.filterReposts.enabled = el.querySelector("#scf-fr-toggle").checked;
        settings.filterReposts.type = el.querySelector("#scf-fr-type").value;

        settings.trackLengthInMin.enabled = el.querySelector("#scf-tl-toggle").checked;
        settings.trackLengthInMin.min = parseInt(el.querySelector("#scf-tl-min").value, 10);
        settings.trackLengthInMin.max = parseInt(el.querySelector("#scf-tl-max").value, 10);

        settings.contentAgeInDays.enabled = el.querySelector("#scf-ca-toggle").checked;
        settings.contentAgeInDays.min = uiToStorageMin(parseInt(el.querySelector("#scf-ca-min").value, 10));
        settings.contentAgeInDays.max = uiToStorageMax(parseInt(el.querySelector("#scf-ca-max").value, 10));

        settings.freeDownloadsOnly.enabled = el.querySelector("#scf-fd-toggle").checked;
        settings.alreadySeen = readHistoryChoice();
        settings.playlistFilter.enabled = el.querySelector("#scf-pf-toggle").checked;
        settings.playlistFilter.mode = el.querySelector("#scf-pf-mode .scf-seg-btn.scf-active")?.dataset.mode ?? "hideLarge";
        settings.playlistFilter.nameInTitles = el.querySelector("#scf-pf-nit-toggle").checked;

        settings.tagFilter.enabled = el.querySelector("#scf-tf-toggle").checked;
        settings.tagFilter.mode = localMode;
        settings.tagFilter.tags = [...localTags];

        return {
            ...tab,
            name: el.querySelector(".scf-name-input").value.trim() || tab.name,
            settings,
        };
    }
}

function attachGlobalPanelListeners(el, {onRestore, onClose, onDebugChange, onRetentionChange, onPlayedThresholdChange, onPlaylistRuleChange, onClearAllSeen, onShowTour}) {
    el.querySelector(".scf-close-btn").addEventListener("click", onClose);
    el.querySelector("#scf-tour-btn").addEventListener("click", onShowTour);
    el.querySelector("#scf-restore-btn").addEventListener("click", onRestore);
    el.querySelector("#scf-debug-checkbox").addEventListener("change", (e) => {
        onDebugChange(e.target.checked).catch(console.error);
    });

    const clearSeenBtn = el.querySelector("#scf-clear-seen-btn");
    function showSeen(seen) {
        for (const num of el.querySelectorAll("#scf-seen-data .scf-seen-num")) {
            const {count} = num.dataset;
            num.textContent = count === "bytes" ? formatBytes(seen.bytes) : formatCount(seen[count]);
        }
        clearSeenBtn.hidden = seen.bytes === 0;
    }

    const retentionHelp = el.querySelector("#scf-seen-retention-help");
    el.querySelector("#scf-seen-retention").addEventListener("change", (e) => {
        retentionHelp.dataset.tip = retentionTip(Number(e.target.value));
        onRetentionChange(Number(e.target.value)).then(showSeen).catch(console.error);
    });
    el.querySelector("#scf-played-threshold").addEventListener("change", (e) => {
        onPlayedThresholdChange(Number(e.target.value)).catch(console.error);
    });
    el.querySelector("#scf-playlist-played-rule").addEventListener("change", (e) => {
        onPlaylistRuleChange(e.target.value).catch(console.error);
    });

    clearSeenBtn.addEventListener("click", () => {
        if (!confirm("Forget all seen and played tracks?")) return;
        onClearAllSeen().then(() => showSeen({tabSeen: 0, tabPlayed: 0, allSeen: 0, allPlayed: 0, bytes: 0})).catch(console.error);
    });
}

async function openSettingsPanel(tab, handlers) {
    const counts = await historyCounts(tab.id);
    document.getElementById("scf-settings-panel")?.remove();
    document.getElementById("scf-global-panel")?.remove();
    const el = buildSettingsPanel(tab, {counts, retention: handlers.retention});
    attachPanelListeners(el, tab, handlers);
    attachTooltipListeners(el);
    document.body.appendChild(el);
}

async function openGlobalPanel(handlers) {
    const seen = await seenSummary(handlers.activeTab.id);
    document.getElementById("scf-global-panel")?.remove();
    document.getElementById("scf-settings-panel")?.remove();
    const el = buildGlobalPanel(handlers.prefs, {retention: handlers.retention, activeTab: handlers.activeTab, seen});
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

// initFilters runs on every #content mutation; pruning once per page load is enough.
let seenPruned = false;

async function initFilters() {
    // A restored scroll offset lands below the spinner once seen tracks are hidden,
    // so infinite scroll never fires. Firefox reads the mode when the reload starts.
    history.scrollRestoration = window.location.href.includes("soundcloud.com/feed") ? "manual" : "auto";

    const {tabs, activeTabId, prefs, seenRetention, infoOpen} = await loadState();
    const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
    applyConfig(activeTab, prefs, "update-only");
    // On every page: a play recorded off the feed would otherwise pass for an existing user.
    const cardStateLoaded = loadCardState();

    if (!window.location.href.includes("soundcloud.com/feed")) return;

    // Queued ahead of warmSeenLists, so lists load already pruned.
    if (!seenPruned) {
        seenPruned = true;
        pruneSeen(seenRetention);
    }

    // Load the active tab's seen lists early so the feed's first
    // scf:seen-query is answered without waiting on storage.
    warmSeenLists(activeTab);
    const countsLoaded = setInfoTab(activeTab);

    const header = await waitForElement(".stream__header");
    header.id = "scf-stream-header";

    const tabBarEl = buildTabBar(tabs, activeTabId, {infoOpen});
    attachTabBarListeners(tabBarEl, {
        onTabClick: async (id) => {
            const {tabs, activeTabId, prefs} = await loadState();
            if (id === activeTabId) return;
            await saveAndResetFeed(tabs, id, prefs);
            // The tab set is unchanged — just move the active highlight.
            for (const li of tabBarEl.querySelectorAll("[data-tab-id]")) {
                li.querySelector(".g-tabs-link").classList.toggle("active", li.dataset.tabId === id);
            }
            renderCard();
        },
        onGearClick: async (id) => {
            const {tabs, seenRetention} = await loadState();
            const tab = tabs.find((t) => t.id === id);
            if (!tab) return;
            await openSettingsPanel(tab, {
                retention: seenRetention,
                // Save and Delete re-read state: the tab bar stays usable while the panel is open.
                onSave: async (updatedTab) => {
                    const {tabs, activeTabId, prefs} = await loadState();
                    const stored = tabs.find((t) => t.id === updatedTab.id);
                    if (!stored) return;
                    const saved = withStoredPause(updatedTab, stored);
                    const newTabs = tabs.map((t) => (t.id === saved.id ? saved : t));
                    if (saved.id === activeTabId) {
                        await saveAndResetFeed(newTabs, activeTabId, prefs);
                    } else {
                        await save(newTabs, activeTabId);
                    }
                    document.getElementById("scf-settings-panel")?.remove();
                    initFilters(); // tab name may have changed — rebuild the tab bar
                },
                // Only pass onDelete when there is more than one tab — attachPanelListeners
                // hides the Delete button when onDelete is undefined.
                onDelete: tabs.length > 1 ? async () => {
                    if (!confirm("Delete this filter?")) return;
                    const {tabs, activeTabId, prefs} = await loadState();
                    if (tabs.length <= 1 || !tabs.some((t) => t.id === id)) return;
                    const {tabs: newTabs, newActiveId} = tabsAfterDelete(tabs, id);
                    if (id === activeTabId) {
                        await saveAndResetFeed(newTabs, newActiveId, prefs);
                        document.getElementById("scf-settings-panel")?.remove();
                        initFilters();
                    } else {
                        await save(newTabs, activeTabId);
                        document.getElementById("scf-settings-panel")?.remove();
                        initFilters();
                    }
                    await clearSeen([historyListId(id, "seen", "tab"), historyListId(id, "played", "tab")]);
                } : undefined,
                onResetHistory: resetHistoryScope,
                onClose: () => {
                    document.getElementById("scf-settings-panel")?.remove();
                },
            });
        },
        onGlobalGearClick: async () => {
            const {tabs, activeTabId, prefs, seenRetention} = await loadState();
            const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
            async function savePref(key, value, resetsFeed) {
                await browser.storage.sync.set({[key]: value});
                const {tabs, activeTabId, prefs} = await loadState();
                const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
                if (resetsFeed(activeTab)) {
                    await saveAndResetFeed(tabs, activeTabId, prefs);
                } else {
                    applyConfig(activeTab, prefs, "update-only");
                }
            }
            await openGlobalPanel({
                prefs,
                retention: seenRetention,
                activeTab,
                onRestore: async () => {
                    const defaults = buildDefaultTabs();
                    await clearSeen(null);
                    await saveAndResetFeed(defaults, defaults[0].id, (await loadState()).prefs);
                    document.getElementById("scf-global-panel")?.remove();
                    initFilters();
                },
                onDebugChange: (enabled) => savePref("scfDebug", enabled, () => false),
                onPlayedThresholdChange: (seconds) => savePref("scfPlayedThreshold", seconds, () => false),
                onPlaylistRuleChange: (rule) => savePref("scfPlaylistPlayedRule", rule,
                    (tab) => hiddenListIdOf(tab) !== null && tab.settings.alreadySeen.mode === "played"),
                onRetentionChange: async (months) => {
                    await browser.storage.sync.set({scfSeenRetention: months});
                    await pruneSeen(months);
                    return seenSummary(activeTab.id);
                },
                onClearAllSeen: async () => {
                    await clearSeen(null);
                    const {tabs, activeTabId, prefs} = await loadState();
                    await saveAndResetFeed(tabs, activeTabId, prefs);
                },
                onShowTour: () => {
                    document.getElementById("scf-global-panel")?.remove();
                    replayTour();
                },
                onClose: () => {
                    document.getElementById("scf-global-panel")?.remove();
                },
            });
        },
        onPlusClick: async () => {
            const {tabs, seenRetention} = await loadState();
            const newTab = {
                id: crypto.randomUUID(),
                name: uniqueName("New Filter", tabs.map((t) => t.name)),
                type: "settings",
                settings: sanitizeSettings({}),
            };
            await openSettingsPanel(newTab, {
                retention: seenRetention,
                onSave: async (updatedTab) => {
                    const {tabs, activeTabId} = await loadState();
                    // save(), not saveAndResetFeed(): the new tab does not become active.
                    await save([...tabs, updatedTab], activeTabId);
                    document.getElementById("scf-settings-panel")?.remove();
                    initFilters();
                },
                onResetHistory: resetHistoryScope,
                onClose: () => {
                    document.getElementById("scf-settings-panel")?.remove();
                },
            });
        },
        onInfoToggle: (open) => {
            browser.storage.sync.set({scfInfoOpen: open}).catch(console.error);
        },
        onSeenPauseToggle: async () => {
            const {tabs, activeTabId, prefs} = await loadState();
            const newTabs = tabsWithSeenPauseToggled(tabs, activeTabId);
            if (newTabs === tabs) return;
            await saveAndResetFeed(newTabs, activeTabId, prefs);
        },
    });

    header.replaceChildren(tabBarEl);
    renderInfo();
    // Put back the card replaceChildren just dropped, before the awaits below.
    renderCard();
    await Promise.all([countsLoaded, cardStateLoaded]);
    renderCardAtLoad();
}

// SoundCloud saves {scrollTop} on unload and scrolls back to it on load (see initFilters).
if (window.location.href.includes("soundcloud.com/feed") && history.state?.scrollTop != null) {
    history.replaceState(null, "");
}

waitForElement("#content").then((content) => {
    const observer = new MutationObserver(initFilters);
    observer.observe(content, {childList: true});
});

initFilters();
