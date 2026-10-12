// Dependency-free tests for src/filter.js. Run: node test/filter.test.js
//
// filter.js is a page script with no module exports, so each test loads it
// into a fresh vm context with stubbed browser globals (document, console,
// XMLHttpRequest, fetch) and drives the patched XHR prototype the same way
// SoundCloud's own code would: open() → send() → onload(). Top-level function
// declarations in the script become properties of the sandbox, which lets
// tests also call helpers like getFollowingIdsAndUsernames directly.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const filterSource = fs.readFileSync(
    path.join(__dirname, "..", "src", "filter.js"),
    "utf8"
);

const DAY_MS = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString();

function defaultSettings(overrides = {}) {
    return {
        filterReposts: {enabled: false, type: "allowRepostedTracksOfFollowers"},
        trackLengthInMin: {enabled: false, min: 0, max: 30},
        contentAgeInDays: {enabled: false, min: null, max: null},
        freeDownloadsOnly: {enabled: false},
        alreadySeen: {mode: "off", source: "tab"},
        playlistFilter: {enabled: false, mode: "hideLarge", nameInTitles: false},
        tagFilter: {enabled: false, mode: "include", tags: []},
        ...overrides,
    };
}

// Minimal CustomEvent for the sandbox: filter.js only uses type + detail.
class FakeCustomEvent {
    constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
    }
}

// Loads filter.js into a fresh sandbox. `config` becomes the active tab config
// (written to the dataset exactly like content.js does). With no cookie the
// followings lookup resolves to [] without touching fetch.
//
// The sandbox document is a small event bus: every dispatched event is
// recorded in `events`, and listeners run synchronously like in a browser.
// `seenResponder(query) → ids` plays content.js: it answers each
// scf:seen-query with scf:seen-result. Without it, queries go unanswered.
function loadFilter({config = null, cookie = "", fetch, seenResponder} = {}) {
    class FakeXHR {}
    FakeXHR.prototype.open = function () {};
    FakeXHR.prototype.send = function () {};
    FakeXHR.prototype.addEventListener = function () {};

    const warnings = [];
    const events = [];
    const listeners = new Map();
    const document = {
        cookie,
        documentElement: {dataset: {scfConfig: config ? JSON.stringify(config) : ""}},
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            const fns = listeners.get(type);
            if (fns) listeners.set(type, fns.filter((f) => f !== fn));
        },
        dispatchEvent(event) {
            events.push(event);
            for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event);
            return true;
        },
        // The response handler updates the skip-info spinner text on every
        // page (scfUpdateSkipInfo); without this stub that throws and the
        // pass-through catch returns the response unfiltered.
        querySelectorAll: () => [],
    };
    if (seenResponder) {
        // Answer asynchronously, like content.js (which awaits the list load).
        document.addEventListener("scf:seen-query", (event) => {
            const query = JSON.parse(event.detail);
            Promise.resolve().then(() => {
                document.dispatchEvent(new FakeCustomEvent("scf:seen-result", {
                    detail: JSON.stringify({reqId: query.reqId, seen: seenResponder(query)}),
                }));
            });
        });
    }
    const sandbox = {
        console: {log() {}, warn: (...a) => warnings.push(a.join(" ")), error() {}},
        URL,
        setTimeout,
        clearTimeout,
        window: {},
        document,
        CustomEvent: FakeCustomEvent,
        XMLHttpRequest: FakeXHR,
    };
    if (fetch) sandbox.fetch = fetch;
    vm.createContext(sandbox);
    vm.runInContext(filterSource, sandbox);
    return {sandbox, warnings, events, XHR: FakeXHR};
}

// Returns the parsed details of every recorded event of `type`.
function eventDetails({events}, type) {
    return events.filter((e) => e.type === type).map((e) => JSON.parse(e.detail));
}

// Simulates one stream API response flowing through the patched XHR and
// returns the (possibly rewritten) response body SoundCloud would see.
async function runStream({XHR}, {collection, next_href = "https://api-v2.soundcloud.com/stream?offset=2"}) {
    const xhr = new XHR();
    let originalOnloadCalled = false;
    xhr.onload = () => { originalOnloadCalled = true; };
    xhr.open("GET", "https://api-v2.soundcloud.com/stream?limit=10");
    xhr.responseText = JSON.stringify({collection, next_href});
    xhr.send();
    xhr.onload({}); // network arrival — invokes the wrapper installed by send()
    // Let the followings / seen-query chain settle (bounded, so a hang fails).
    for (let waited = 0; !originalOnloadCalled && waited < 2000; waited += 5) {
        await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(originalOnloadCalled, "original onload must always be invoked");
    return JSON.parse(xhr.responseText);
}

function seenConfig(mode, source = "tab") {
    return {
        id: "t1",
        type: "settings",
        settings: defaultSettings({alreadySeen: {mode, source}}),
        debug: false,
    };
}

const ids = (out) => out.collection.map((item) => item.track?.id ?? "playlist");

function track(id, ageDays, extra = {}) {
    return {
        type: "track",
        created_at: daysAgo(ageDays),
        track: {id, title: `track ${id}`, duration: 180000, created_at: daysAgo(ageDays), user_id: 100 + id, ...extra},
    };
}

function playlistRepost(ageDays) {
    return {
        type: "playlist-repost",
        created_at: daysAgo(ageDays),
        playlist: {
            created_at: daysAgo(ageDays),
            track_count: 2,
            user_id: 42,
            user: {username: "someone"},
            tracks: [
                {id: 901, title: "a", duration: 120000, created_at: daysAgo(ageDays)},
                {id: 902, title: "b", duration: 120000, created_at: daysAgo(ageDays)},
            ],
        },
    };
}

async function stopsPaginationWhenPageReachesAgeCap() {
    const config = {
        type: "settings",
        settings: defaultSettings({contentAgeInDays: {enabled: true, min: null, max: 7}}),
        debug: false,
    };
    const bits = loadFilter({config});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 30)]});
    assert.strictEqual(out.collection.length, 1, "track older than the cap is filtered out");
    assert.strictEqual(out.next_href, null, "next_href is nulled once the page reaches items older than the age cap");
}

async function allowNoneFiltersPlaylistReposts() {
    const config = {
        type: "settings",
        settings: defaultSettings({filterReposts: {enabled: true, type: "allowNone"}}),
        debug: false,
    };
    const bits = loadFilter({config});
    const out = await runStream(bits, {collection: [playlistRepost(1), track(1, 1)]});
    assert.strictEqual(out.collection.length, 1, "playlist repost is removed, direct track post is kept");
    assert.strictEqual(out.collection[0].type, "track");
}

async function hideAllPlaylistsFiltersPlaylistReposts() {
    const config = {
        type: "settings",
        settings: defaultSettings({playlistFilter: {enabled: true, mode: "hideAll", nameInTitles: false}}),
        debug: false,
    };
    const bits = loadFilter({config});
    const out = await runStream(bits, {collection: [playlistRepost(1), track(1, 1)]});
    assert.strictEqual(out.collection.length, 1, "playlist repost is removed, direct track post is kept");
    assert.strictEqual(out.collection[0].type, "track");
}

async function followingsPaginationStopsWhenNextHrefAbsent() {
    const fetchStub = async (url) => {
        if (url === undefined || String(url).includes("undefined")) {
            throw new Error("fetched bogus url: " + url);
        }
        const body = String(url).includes("/me")
            ? {id: 77}
            : {collection: [{id: 1, username: "a"}]}; // deliberately no next_href key
        return {ok: true, json: async () => body};
    };
    const bits = loadFilter({cookie: "oauth_token=tok123", fetch: fetchStub});
    const result = await bits.sandbox.getFollowingIdsAndUsernames();
    assert.deepStrictEqual([...result.ids], [1], "collects the single page of followings");
    assert.deepStrictEqual(bits.warnings, [], "no failure warning when next_href is absent");
}

function freeDownloadMatchesLabelVariants() {
    const isFreeDownload = loadFilter().sandbox.isFreeDownload;
    const free = [
        "Free DL", "FREE DL", "Free DL \u2192", "FreeDL", "Free-DL", "Free_DL",
        "Free  DL", "free d/l", "Free Download", "FreeDownload", "Free-Download",
        "Free Downloads",
    ];
    const notFree = [
        "Free", "Download", "Download (free)", "Buy on Beatport",
        "free dlc", "carefree dl",
    ];
    for (const label of free) {
        assert.ok(isFreeDownload({title: "x", purchase_title: label}), `purchase_title "${label}" reads as a free download`);
        assert.ok(isFreeDownload({title: `Artist - Track (${label})`}), `title "${label}" reads as a free download`);
    }
    for (const label of notFree) {
        assert.ok(!isFreeDownload({title: "x", purchase_title: label}), `purchase_title "${label}" does not read as a free download`);
        assert.ok(!isFreeDownload({title: `Artist - Track (${label})`}), `title "${label}" does not read as a free download`);
    }
}

async function seenOnHidesQueriedIds() {
    const bits = loadFilter({config: seenConfig("on"), seenResponder: () => [2]});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1), playlistRepost(1)]});
    assert.deepStrictEqual(ids(out), [1, "playlist"], "track 2 reported as seen is removed");
    const queries = eventDetails(bits, "scf:seen-query");
    assert.strictEqual(queries.length, 1, "one query per response");
    assert.strictEqual(queries[0].tabId, "t1");
    assert.strictEqual(queries[0].source, "tab");
    assert.deepStrictEqual(
        [...queries[0].ids].sort((a, b) => a - b),
        [1, 2, 901, 902],
        "query carries every track id, including tracks inside playlists"
    );
}

async function seenOnHidesDuplicateInSamePage() {
    const bits = loadFilter({config: seenConfig("on"), seenResponder: () => []});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1), track(1, 2)]});
    assert.deepStrictEqual(ids(out), [1, 2], "second occurrence of track 1 in the same page is removed");
}

async function seenOnReportsShownIds() {
    const bits = loadFilter({config: seenConfig("on"), seenResponder: () => [2]});
    await runStream(bits, {collection: [track(1, 1), track(2, 1), track(3, 1)]});
    const reports = eventDetails(bits, "scf:seen");
    assert.deepStrictEqual(reports, [{tabId: "t1", ids: [1, 3]}], "reports exactly the shown track ids");
}

async function seenOffSendsNoQueryOrReport() {
    const bits = loadFilter({config: seenConfig("off"), seenResponder: () => [1]});
    const out = await runStream(bits, {collection: [track(1, 1), track(1, 2)]});
    assert.deepStrictEqual(ids(out), [1, 1], "nothing is hidden as seen when off");
    assert.strictEqual(eventDetails(bits, "scf:seen-query").length, 0, "no query when off");
    assert.strictEqual(eventDetails(bits, "scf:seen").length, 0, "no report when off");
}

async function seenPausedRecordsWithoutHiding() {
    const bits = loadFilter({config: seenConfig("paused"), seenResponder: () => [1, 2]});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1), track(1, 2)]});
    assert.deepStrictEqual(ids(out), [1, 2, 1], "nothing is hidden as seen when paused");
    assert.strictEqual(eventDetails(bits, "scf:seen-query").length, 0, "no query when paused");
    assert.deepStrictEqual(
        eventDetails(bits, "scf:seen"),
        [{tabId: "t1", ids: [1, 2]}],
        "shown ids are still reported when paused"
    );
}

async function seenQueryCarriesSource() {
    const bits = loadFilter({config: seenConfig("on", "all"), seenResponder: () => [1]});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1)]});
    assert.deepStrictEqual(ids(out), [2], "ids answered for the shared list are removed");
    const queries = eventDetails(bits, "scf:seen-query");
    assert.strictEqual(queries.length, 1);
    assert.strictEqual(queries[0].source, "all", "source is passed through in the query");
}

async function seenQueryTimeoutFallsBack() {
    const bits = loadFilter({config: seenConfig("on")}); // no responder: content.js is gone
    bits.sandbox.SEEN_QUERY_TIMEOUT_MS = 30;
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1)]});
    assert.deepStrictEqual(ids(out), [1, 2], "response completes with nothing hidden after the timeout");
    assert.strictEqual(eventDetails(bits, "scf:seen-query").length, 1, "the query was sent");
}

async function statsReportedAfterResponse() {
    const config = {
        id: "t1",
        type: "settings",
        settings: defaultSettings({filterReposts: {enabled: true, type: "allowNone"}}),
        debug: false,
    };
    const bits = loadFilter({config});
    await runStream(bits, {collection: [playlistRepost(1), track(1, 1)]});
    await runStream(bits, {collection: [playlistRepost(1), track(2, 1), track(3, 1)]});
    assert.deepStrictEqual(
        eventDetails(bits, "scf:stats"),
        [
            {tabId: "t1", filtered: 1, scanned: 2},
            {tabId: "t1", filtered: 2, scanned: 5},
        ],
        "each response reports the running filtered / scanned totals"
    );
}

(async () => {
    const tests = [
        stopsPaginationWhenPageReachesAgeCap,
        allowNoneFiltersPlaylistReposts,
        hideAllPlaylistsFiltersPlaylistReposts,
        followingsPaginationStopsWhenNextHrefAbsent,
        freeDownloadMatchesLabelVariants,
        seenOnHidesQueriedIds,
        seenOnHidesDuplicateInSamePage,
        seenOnReportsShownIds,
        seenOffSendsNoQueryOrReport,
        seenPausedRecordsWithoutHiding,
        seenQueryCarriesSource,
        seenQueryTimeoutFallsBack,
        statsReportedAfterResponse,
    ];
    let failed = 0;
    for (const t of tests) {
        try {
            await t();
            console.log(`PASS ${t.name}`);
        } catch (e) {
            failed++;
            console.log(`FAIL ${t.name}`);
            console.log(`  ${e.message}`);
        }
    }
    if (failed > 0) {
        console.log(`${failed}/${tests.length} test(s) failed`);
        process.exit(1);
    }
    console.log(`all ${tests.length} tests passed`);
})();
