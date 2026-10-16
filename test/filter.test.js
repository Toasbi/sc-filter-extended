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
        alreadySeen: {mode: "off", paused: false, source: "tab"},
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
//
// The feed is fake too: render(href) adds a link the way SoundCloud renders an
// item (seen by the MutationObserver), show(href) scrolls it on screen (fires
// the IntersectionObserver). Like the real one, it batches entries per tick.
//
// `player` ({href, position, duration, playing}, mutable) fakes SoundCloud's player bar;
// without it the player selectors find nothing. setInterval and Date.now are fake:
// runIntervals(seconds) moves the clock on and fires every pending interval once.
function loadFilter({config = null, cookie = "", fetch, seenResponder, player = null} = {}) {
    const sent = []; // {method, url, data} of every request that reached the network
    class FakeXHR {}
    FakeXHR.prototype.open = function (method, url) { this._fake = {method, url}; };
    FakeXHR.prototype.send = function (data) { sent.push({...this._fake, data}); };
    FakeXHR.prototype.addEventListener = function () {};

    const intervals = new Map();
    let nextInterval = 1;
    let clock = Date.now();
    class FakeDate extends Date {
        static now() { return clock; }
    }
    const playerEls = player && {
        ".playbackSoundBadge__titleLink": {getAttribute: () => player.href},
        ".playbackTimeline__progressWrapper": {
            getAttribute: (name) => String(name === "aria-valuemax" ? player.duration ?? 300 : player.position),
        },
        ".playControl": {classList: {contains: (c) => c === "playing" && player.playing}},
    };

    const warnings = [];
    const events = [];
    const links = [];
    const feedList = {
        nodeType: 1,
        closest: (selector) => (selector === ".stream__list" ? feedList : null),
        matches: () => false,
        querySelectorAll: (selector) => (selector === "a[href]" ? links.filter((l) => l.inFeed) : []),
    };
    const watched = new Set();
    let intersect = null;
    let mutate = null;
    let feedWatched = false;
    let queued = [];
    function queueIntersection(link) {
        if (queued.length === 0) {
            Promise.resolve().then(() => {
                const entries = queued.map((target) => ({target, isIntersecting: true}));
                queued = [];
                intersect(entries);
            });
        }
        queued.push(link);
    }
    class FakeIntersectionObserver {
        constructor(callback) { intersect = callback; }
        observe(link) {
            if (watched.has(link)) return;
            watched.add(link);
            if (link.visible) queueIntersection(link);
        }
        unobserve(link) { watched.delete(link); }
        disconnect() { watched.clear(); }
    }
    class FakeMutationObserver {
        constructor(callback) { mutate = callback; }
        observe() { feedWatched = true; }
        disconnect() { feedWatched = false; }
    }
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
        querySelector: (selector) => {
            if (selector === ".stream__list") return feedList;
            return playerEls?.[selector] ?? null;
        },
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
        Date: FakeDate,
        setTimeout,
        clearTimeout,
        setInterval: (fn) => {
            intervals.set(nextInterval, fn);
            return nextInterval++;
        },
        clearInterval: (id) => intervals.delete(id),
        window: {},
        IntersectionObserver: FakeIntersectionObserver,
        MutationObserver: FakeMutationObserver,
        document,
        CustomEvent: FakeCustomEvent,
        XMLHttpRequest: FakeXHR,
    };
    if (fetch) sandbox.fetch = fetch;
    vm.createContext(sandbox);
    vm.runInContext(filterSource, sandbox);
    const tick = () => new Promise((r) => setTimeout(r, 0));
    // inFeed: false is a link elsewhere on the page, e.g. the player bar.
    async function render(href, {visible = false, inFeed = true} = {}) {
        const link = {
            nodeType: 1,
            href,
            pathname: new URL(href, "https://soundcloud.com").pathname,
            visible,
            inFeed,
            closest: (selector) => (selector === ".stream__list" && inFeed ? feedList : null),
            matches: (selector) => selector === "a[href]",
            querySelectorAll: () => [],
        };
        links.push(link);
        if (feedWatched) mutate([{addedNodes: [link]}]);
        await tick();
    }
    async function show(href) {
        for (const link of links.filter((l) => l.href === href)) {
            link.visible = true;
            if (watched.has(link)) queueIntersection(link);
        }
        await tick();
    }
    // Pushes a config the way content.js does once it has read storage.
    function applyConfig(cfg) {
        document.documentElement.dataset.scfConfig = JSON.stringify(cfg);
        document.dispatchEvent(new FakeCustomEvent("scf:apply-config", {detail: "update-only"}));
    }
    function runIntervals(seconds = 1) {
        clock += seconds * 1000;
        for (const fn of [...intervals.values()]) fn();
    }
    return {sandbox, warnings, events, sent, render, show, tick, applyConfig, runIntervals, intervals, XHR: FakeXHR};
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

function seenConfig(mode, {source = "tab", paused = false, ...extra} = {}) {
    return {
        id: "t1",
        type: "settings",
        settings: defaultSettings({alreadySeen: {mode, paused, source}}),
        debug: false,
        playedThreshold: 0,
        playlistPlayedRule: "any",
        ...extra,
    };
}

const ids = (out) => out.collection.map((item) => item.track?.id ?? "playlist");

const trackUrl = (id) => `https://soundcloud.com/artist${id}/track-${id}`;

function track(id, ageDays, extra = {}) {
    return {
        type: "track",
        created_at: daysAgo(ageDays),
        track: {id, title: `track ${id}`, duration: 180000, created_at: daysAgo(ageDays), user_id: 100 + id, permalink_url: trackUrl(id), ...extra},
    };
}

function playlistRepost(ageDays) {
    return {
        type: "playlist-repost",
        created_at: daysAgo(ageDays),
        playlist: {
            id: 700,
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

async function seenHidesQueriedIds() {
    const bits = loadFilter({config: seenConfig("seen"), seenResponder: () => [2]});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1), playlistRepost(1)]});
    assert.deepStrictEqual(ids(out), [1, "playlist"], "track 2 reported as seen is removed");
    const queries = eventDetails(bits, "scf:seen-query");
    assert.strictEqual(queries.length, 1, "one query per response");
    assert.strictEqual(queries[0].tabId, "t1");
    assert.strictEqual(queries[0].list, "seen");
    assert.strictEqual(queries[0].source, "tab");
    assert.deepStrictEqual(
        [...queries[0].ids].sort((a, b) => a - b),
        [-700, 1, 2, 901, 902],
        "query carries every track id, including tracks inside playlists, and the playlist's negated id"
    );
}

async function seenHidesDuplicateInSamePage() {
    const bits = loadFilter({config: seenConfig("seen"), seenResponder: () => []});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1), track(1, 2)]});
    assert.deepStrictEqual(ids(out), [1, 2], "second occurrence of track 1 in the same page is removed");
}

async function seenRecordedOnlyOnceOnScreen() {
    const bits = loadFilter({config: seenConfig("seen"), seenResponder: () => [2]});
    await runStream(bits, {collection: [track(1, 1), track(2, 1), track(3, 1)]});
    assert.strictEqual(eventDetails(bits, "scf:seen").length, 0, "loading a page records nothing");

    await bits.render("/artist1/track-1", {visible: true});
    await bits.render("/artist3/track-3");
    assert.deepStrictEqual(eventDetails(bits, "scf:seen"), [{tabId: "t1", ids: [1]}], "only the on-screen track is recorded");

    await bits.show("/artist3/track-3");
    await bits.show("/artist3/track-3");
    assert.deepStrictEqual(
        eventDetails(bits, "scf:seen"),
        [{tabId: "t1", ids: [1]}, {tabId: "t1", ids: [3]}],
        "each track is recorded once, when it scrolls on screen"
    );
}

async function seenPicksUpLinksRenderedBeforeResponse() {
    const bits = loadFilter({config: seenConfig("seen"), seenResponder: () => []});
    await bits.render("/artist1/track-1", {visible: true});
    await runStream(bits, {collection: [track(1, 1)]});
    await bits.tick();
    assert.deepStrictEqual(eventDetails(bits, "scf:seen"), [{tabId: "t1", ids: [1]}]);
}

async function seenIgnoresLinksOutsideTheFeed() {
    const bits = loadFilter({config: seenConfig("seen"), seenResponder: () => []});
    await runStream(bits, {collection: [track(1, 1)]});
    await bits.render("/artist1/track-1", {visible: true, inFeed: false});
    assert.strictEqual(eventDetails(bits, "scf:seen").length, 0, "nothing is recorded away from the feed");
}

async function seenSingleTrackPlaylistUsesPlaylistLink() {
    const single = playlistRepost(1);
    single.playlist.track_count = 1;
    single.playlist.tracks = [single.playlist.tracks[0]];
    single.playlist.permalink_url = "https://soundcloud.com/someone/sets/single";
    const bits = loadFilter({config: seenConfig("seen", {paused: true})});
    await runStream(bits, {collection: [single]});
    await bits.render("https://soundcloud.com/someone/sets/single?in=x", {visible: true});
    assert.deepStrictEqual(eventDetails(bits, "scf:seen"), [{tabId: "t1", ids: [-700, 901]}], "records the playlist and its one track");
}

async function seenPlaylistRecordsThePlaylistNotItsTracks() {
    const ep = playlistRepost(1);
    ep.playlist.permalink_url = "https://soundcloud.com/someone/sets/ep";
    const bits = loadFilter({config: seenConfig("seen"), seenResponder: () => []});
    const out = await runStream(bits, {collection: [ep, track(901, 1)]});
    assert.deepStrictEqual(ids(out), ["playlist", 901], "a track of a shown playlist still shows on its own");
    await bits.render("/someone/sets/ep", {visible: true});
    assert.deepStrictEqual(eventDetails(bits, "scf:seen"), [{tabId: "t1", ids: [-700]}]);
}

async function seenHidesSeenPlaylist() {
    const bits = loadFilter({config: seenConfig("seen"), seenResponder: () => [-700]});
    const out = await runStream(bits, {collection: [playlistRepost(1), track(1, 1)]});
    assert.deepStrictEqual(ids(out), [1], "a playlist recorded as seen is removed");
}

async function seenHidesRepeatOfTrackNotYetOnScreen() {
    const bits = loadFilter({config: seenConfig("seen"), seenResponder: () => []});
    await runStream(bits, {collection: [track(1, 1)]});
    const out = await runStream(bits, {collection: [track(1, 2), track(2, 2)]});
    assert.deepStrictEqual(ids(out), [2], "a track already shown in this feed is not shown again");
}

async function seenOffSendsNoQueryOrReport() {
    const bits = loadFilter({config: seenConfig("off"), seenResponder: () => [1]});
    const out = await runStream(bits, {collection: [track(1, 1), track(1, 2)]});
    assert.deepStrictEqual(ids(out), [1, 1], "nothing is hidden as seen when off");
    assert.strictEqual(eventDetails(bits, "scf:seen-query").length, 0, "no query when off");
    await bits.render("/artist1/track-1", {visible: true});
    assert.strictEqual(eventDetails(bits, "scf:seen").length, 0, "no report when off");
}

async function seenPausedRecordsWithoutHiding() {
    const bits = loadFilter({config: seenConfig("seen", {paused: true}), seenResponder: () => [1, 2]});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1), track(1, 2)]});
    assert.deepStrictEqual(ids(out), [1, 2, 1], "nothing is hidden as seen when paused");
    assert.strictEqual(eventDetails(bits, "scf:seen-query").length, 0, "no query when paused");
    await bits.render("/artist1/track-1");
    await bits.render("/artist2/track-2");
    await bits.show("/artist1/track-1");
    await bits.show("/artist2/track-2");
    assert.deepStrictEqual(
        eventDetails(bits, "scf:seen"),
        [{tabId: "t1", ids: [1]}, {tabId: "t1", ids: [2]}],
        "on-screen ids are still reported when paused"
    );
}

async function seenQueryCarriesSource() {
    const bits = loadFilter({config: seenConfig("seen", {source: "all"}), seenResponder: () => [1]});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1)]});
    assert.deepStrictEqual(ids(out), [2], "ids answered for the shared list are removed");
    const queries = eventDetails(bits, "scf:seen-query");
    assert.strictEqual(queries.length, 1);
    assert.strictEqual(queries[0].list, "seen");
    assert.strictEqual(queries[0].source, "all", "source is passed through in the query");
}

async function seenQueryTimeoutFallsBack() {
    const bits = loadFilter({config: seenConfig("seen")}); // no responder: content.js is gone
    bits.sandbox.SEEN_QUERY_TIMEOUT_MS = 30;
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1)]});
    assert.deepStrictEqual(ids(out), [1, 2], "response completes with nothing hidden after the timeout");
    assert.strictEqual(eventDetails(bits, "scf:seen-query").length, 1, "the query was sent");
}

async function responseWaitsForLateConfig() {
    const bits = loadFilter({seenResponder: () => [2]});
    const pending = runStream(bits, {collection: [track(1, 1), track(2, 1)]});
    await bits.tick();
    bits.applyConfig(seenConfig("seen"));
    const out = await pending;
    assert.deepStrictEqual(ids(out), [1], "a response that beats the config is filtered once it lands");
}

async function responsePassesThroughWithoutConfig() {
    const bits = loadFilter(); // content.js never sends a config
    bits.sandbox.CONFIG_WAIT_MS = 30;
    const out = await runStream(bits, {collection: [track(1, 1)]});
    assert.deepStrictEqual(ids(out), [1], "response completes unfiltered after the timeout");
    bits.sandbox.CONFIG_WAIT_MS = 60000;
    const next = await runStream(bits, {collection: [track(2, 1)]});
    assert.deepStrictEqual(ids(next), [2], "later responses don't wait again");
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

async function trackLengthMaxAtSliderEndHasNoUpperLimit() {
    const config = {
        type: "settings",
        settings: defaultSettings({trackLengthInMin: {enabled: true, min: 45, max: 120}}),
        debug: false,
    };
    const bits = loadFilter({config});
    const minutes = (n) => ({duration: n * 60000});
    const out = await runStream(bits, {collection: [track(1, 1, minutes(30)), track(2, 1, minutes(90)), track(3, 1, minutes(240))]});
    assert.deepStrictEqual(ids(out), [2, 3], "a 120 max shown as \"120+ min\" keeps tracks longer than 120 min");
}

const PLAY_HISTORY_URL = "https://api-v2.soundcloud.com/me/play-history?client_id=abc";
const playBody = (trackId, playlistId) => JSON.stringify(playlistId == null
    ? {track_urn: `soundcloud:tracks:${trackId}`}
    : {context_urn: `soundcloud:playlists:${playlistId}`, track_urn: `soundcloud:tracks:${trackId}`});

function sendRequest({XHR}, method, url, body) {
    const xhr = new XHR();
    xhr.open(method, url);
    xhr.send(body);
}

function parsePlayHistoryBodyReadsUrns() {
    const {parsePlayHistoryBody} = loadFilter().sandbox;
    const plain = (v) => JSON.parse(JSON.stringify(v));
    assert.deepStrictEqual(plain(parsePlayHistoryBody(playBody(2409837882))), {trackId: 2409837882, playlistId: null});
    assert.deepStrictEqual(plain(parsePlayHistoryBody(playBody(2349367277, 2313391602))), {trackId: 2349367277, playlistId: 2313391602});
    assert.deepStrictEqual(
        plain(parsePlayHistoryBody(JSON.stringify({context_urn: "soundcloud:users:5", track_urn: "soundcloud:tracks:7"}))),
        {trackId: 7, playlistId: null},
        "a non-playlist context is ignored"
    );
    for (const body of ["not json", "null", "{}", JSON.stringify({track_urn: "soundcloud:playlists:7"}),
        JSON.stringify({track_urn: "soundcloud:tracks:abc"}), JSON.stringify({track_urn: 7}), undefined, null]) {
        assert.strictEqual(parsePlayHistoryBody(body), null, `rejects ${body}`);
    }
}

async function playHistoryPostRecordsPlayImmediately() {
    const bits = loadFilter({config: seenConfig("seen")});
    const body = playBody(2349367277, 2313391602);
    sendRequest(bits, "POST", PLAY_HISTORY_URL, body);
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: "t1", ids: [2349367277, -2313391602]}]);
    assert.strictEqual(eventDetails(bits, "scf:seen").length, 0, "content.js records plays as seen itself");
    assert.deepStrictEqual(bits.sent, [{method: "POST", url: PLAY_HISTORY_URL, data: body}], "the request goes out unchanged");
}

async function playCarriesTabIdWhenOff() {
    const bits = loadFilter({config: seenConfig("off")});
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(5));
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: "t1", ids: [5]}], "plays are recorded in every mode");
    assert.strictEqual(eventDetails(bits, "scf:seen").length, 0);
}

async function deepCutsPlayCarriesNoTabId() {
    const bits = loadFilter({config: {id: "dc", type: "deepCuts", playedThreshold: 0}});
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(5));
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: null, ids: [5]}]);
}

async function playRecordedBeforeAnyConfig() {
    const bits = loadFilter();
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(5));
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: null, ids: [5]}], "no tab id before the first config");
}

async function otherRequestsRecordNoPlay() {
    const bits = loadFilter({config: seenConfig("seen")});
    sendRequest(bits, "GET", PLAY_HISTORY_URL, null);
    sendRequest(bits, "POST", "https://api-v2.soundcloud.com/me/play-history/tracks?client_id=abc", playBody(5));
    sendRequest(bits, "POST", "https://example.com/me/play-history", playBody(5));
    sendRequest(bits, "POST", PLAY_HISTORY_URL, "garbage");
    assert.strictEqual(eventDetails(bits, "scf:played").length, 0);
    assert.strictEqual(bits.sent.length, 4, "every request still goes out");
}

function listenStepCountsSteadyPlaybackOnly() {
    const {startListen, listenStep} = loadFilter().sandbox;
    let now = 0;
    let state = startListen({path: "/a/t", position: 10, now}, 5);
    assert.strictEqual(state.listened, 1, "SoundCloud's own second counts");
    const step = (position, {after = 1, playing = true, path = "/a/t", duration = 300} = {}) => {
        now += after * 1000;
        state = listenStep(state, {path, position, duration, playing, now});
    };
    step(11);
    assert.strictEqual(state.listened, 2, "a 1 s advance counts");
    step(13);
    assert.strictEqual(state.listened, 4, "a 2 s advance counts");
    step(60);
    assert.strictEqual(state.listened, 4, "a seek forward adds nothing");
    step(20);
    assert.strictEqual(state.listened, 4, "a seek back adds nothing");
    step(21, {playing: false});
    assert.strictEqual(state.listened, 4, "nothing counts while paused");
    step(21);
    assert.strictEqual(state.status, "listening");
    step(22);
    assert.strictEqual(state.status, "done", "reaching the threshold finishes the listen");

    state = startListen({path: "/a/t", position: 10, now}, 30);
    step(11, {path: "/b/other"});
    assert.strictEqual(state.status, "dropped", "a different track drops the listen");
    state = startListen({path: "/a/t", position: 10, now}, 30);
    assert.strictEqual(listenStep(state, null).status, "dropped", "a vanished player bar drops the listen");
}

function listenStepCountsThrottledSamples() {
    const {startListen, listenStep} = loadFilter().sandbox;
    const sample = (position, now) => ({path: "/a/t", position, duration: 300, playing: true, now});
    let state = startListen({path: "/a/t", position: 1, now: 0}, 60);
    state = listenStep(state, sample(61, 60000));
    assert.strictEqual(state.listened, 61, "a 60 s advance over a 60 s gap counts");
    assert.strictEqual(state.status, "done");

    state = startListen({path: "/a/t", position: 1, now: 0}, 60);
    state = listenStep(state, sample(301, 5000));
    assert.strictEqual(state.listened, 1, "a 300 s jump within 5 s is a seek");
    assert.strictEqual(state.status, "listening");
}

function listenStepFinishesTracksShorterThanThreshold() {
    const {startListen, listenStep} = loadFilter().sandbox;
    let state = startListen({path: "/a/t", position: 1, now: 0}, 60);
    for (let second = 2; second <= 44; second++) {
        state = listenStep(state, {path: "/a/t", position: second, duration: 45, playing: true, now: (second - 1) * 1000});
        assert.strictEqual(state.status, second < 44 ? "listening" : "done", `at ${second} s of a 45 s track`);
    }
}

async function playThresholdWaitsForListening() {
    const player = {href: "/artist/song", position: 1, playing: true};
    const bits = loadFilter({config: seenConfig("seen", {playedThreshold: 10}), player});
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(5));
    assert.strictEqual(eventDetails(bits, "scf:played").length, 0, "nothing is recorded at 1 s");
    for (let second = 2; second <= 9; second++) {
        player.position = second;
        bits.runIntervals();
    }
    assert.strictEqual(eventDetails(bits, "scf:played").length, 0, "9 s are not enough");
    player.position = 10;
    bits.runIntervals();
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: "t1", ids: [5]}]);
    assert.strictEqual(bits.intervals.size, 0, "polling stops once recorded");
}

async function shortTrackCountsOncePlayedThrough() {
    const player = {href: "/artist/preview", position: 1, duration: 30, playing: true};
    const bits = loadFilter({config: seenConfig("seen", {playedThreshold: 60}), player});
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(5));
    for (let second = 2; second <= 29; second++) {
        player.position = second;
        bits.runIntervals();
    }
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: "t1", ids: [5]}]);
    assert.strictEqual(bits.intervals.size, 0, "polling stops once recorded");
}

async function throttledPollingStillCounts() {
    const player = {href: "/artist/song", position: 1, playing: true};
    const bits = loadFilter({config: seenConfig("seen", {playedThreshold: 60}), player});
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(5));
    player.position = 61;
    bits.runIntervals(60);
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: "t1", ids: [5]}]);
}

async function newPlayReplacesPendingListen() {
    const player = {href: "/artist/first", position: 1, playing: true};
    const bits = loadFilter({config: seenConfig("seen", {playedThreshold: 3}), player});
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(1));
    player.href = "/artist/second";
    player.position = 1;
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(2));
    assert.strictEqual(bits.intervals.size, 1, "only one listen is pending");
    player.position = 3;
    bits.runIntervals();
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: "t1", ids: [2]}]);
}

async function skippedTrackIsNotRecorded() {
    const player = {href: "/artist/first", position: 1, playing: true};
    const bits = loadFilter({config: seenConfig("seen", {playedThreshold: 30}), player});
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(1));
    player.href = "/artist/next";
    bits.runIntervals();
    assert.strictEqual(eventDetails(bits, "scf:played").length, 0);
    assert.strictEqual(bits.intervals.size, 0, "polling stops once dropped");
}

async function missingPlayerBarRecordsImmediately() {
    const bits = loadFilter({config: seenConfig("seen", {playedThreshold: 30})});
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(5));
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: "t1", ids: [5]}]);
    assert.strictEqual(bits.intervals.size, 0);
}

async function playedHidesPlayedTracks() {
    const bits = loadFilter({config: seenConfig("played"), seenResponder: () => [2]});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1), track(1, 2)]});
    assert.deepStrictEqual(ids(out), [1, 1], "the played track is removed, repeats of unplayed ones stay");
    const queries = eventDetails(bits, "scf:seen-query");
    assert.strictEqual(queries.length, 1);
    assert.strictEqual(queries[0].list, "played", "played mode asks about a played list");
    assert.strictEqual(queries[0].source, "tab", "the tab's own played list");
    await bits.render("/artist1/track-1", {visible: true});
    assert.deepStrictEqual(eventDetails(bits, "scf:seen"), [{tabId: "t1", ids: [1]}], "shown tracks are still recorded as seen");
}

async function playedAnyTabQueriesGlobalPlayedList() {
    const bits = loadFilter({config: seenConfig("played", {source: "all"}), seenResponder: () => [1]});
    const out = await runStream(bits, {collection: [track(1, 1), track(2, 1)]});
    assert.deepStrictEqual(ids(out), [2]);
    const [query] = eventDetails(bits, "scf:seen-query");
    assert.strictEqual(query.list, "played");
    assert.strictEqual(query.source, "all", "plays from every tab");
}

async function playCarriesActiveTabAfterSwitch() {
    const bits = loadFilter({config: seenConfig("played")});
    bits.applyConfig({...seenConfig("played"), id: "t2"});
    sendRequest(bits, "POST", PLAY_HISTORY_URL, playBody(5));
    assert.deepStrictEqual(eventDetails(bits, "scf:played"), [{tabId: "t2", ids: [5]}]);
}

async function playedDoesNotHideRepeatsAcrossPages() {
    const bits = loadFilter({config: seenConfig("played"), seenResponder: () => []});
    await runStream(bits, {collection: [track(1, 1)]});
    const out = await runStream(bits, {collection: [track(1, 2)]});
    assert.deepStrictEqual(ids(out), [1]);
}

async function playedPlaylistRule() {
    const withStub = () => {
        const item = playlistRepost(1);
        item.playlist.track_count = 3;
        item.playlist.tracks.push({id: 903}); // not loaded: no duration
        return item;
    };
    const cases = [
        {rule: "any", played: [901], hidden: true},
        {rule: "any", played: [903], hidden: true},
        {rule: "any", played: [-700], hidden: true},
        {rule: "any", played: [5], hidden: false},
        {rule: "all", played: [901], hidden: false},
        {rule: "all", played: [-700], hidden: false},
        {rule: "all", played: [901, 902], hidden: false},
        {rule: "all", played: [901, 902, 903], hidden: true},
    ];
    for (const {rule, played, hidden} of cases) {
        const bits = loadFilter({config: seenConfig("played", {playlistPlayedRule: rule}), seenResponder: () => played});
        const out = await runStream(bits, {collection: [withStub(), track(1, 1)]});
        assert.deepStrictEqual(ids(out), hidden ? [1] : ["playlist", 1], `rule ${rule} with [${played}] played`);
    }
}

async function pausedPlayedSendsNoQuery() {
    const bits = loadFilter({config: seenConfig("played", {paused: true}), seenResponder: () => [1]});
    const out = await runStream(bits, {collection: [track(1, 1)]});
    assert.deepStrictEqual(ids(out), [1]);
    assert.strictEqual(eventDetails(bits, "scf:seen-query").length, 0);
}

(async () => {
    const tests = [
        stopsPaginationWhenPageReachesAgeCap,
        allowNoneFiltersPlaylistReposts,
        hideAllPlaylistsFiltersPlaylistReposts,
        followingsPaginationStopsWhenNextHrefAbsent,
        freeDownloadMatchesLabelVariants,
        seenHidesQueriedIds,
        seenHidesDuplicateInSamePage,
        seenRecordedOnlyOnceOnScreen,
        seenPicksUpLinksRenderedBeforeResponse,
        seenIgnoresLinksOutsideTheFeed,
        seenSingleTrackPlaylistUsesPlaylistLink,
        seenPlaylistRecordsThePlaylistNotItsTracks,
        seenHidesSeenPlaylist,
        seenHidesRepeatOfTrackNotYetOnScreen,
        seenOffSendsNoQueryOrReport,
        seenPausedRecordsWithoutHiding,
        seenQueryCarriesSource,
        seenQueryTimeoutFallsBack,
        responseWaitsForLateConfig,
        responsePassesThroughWithoutConfig,
        statsReportedAfterResponse,
        trackLengthMaxAtSliderEndHasNoUpperLimit,
        parsePlayHistoryBodyReadsUrns,
        playHistoryPostRecordsPlayImmediately,
        playCarriesTabIdWhenOff,
        deepCutsPlayCarriesNoTabId,
        playRecordedBeforeAnyConfig,
        otherRequestsRecordNoPlay,
        listenStepCountsSteadyPlaybackOnly,
        listenStepCountsThrottledSamples,
        listenStepFinishesTracksShorterThanThreshold,
        playThresholdWaitsForListening,
        shortTrackCountsOncePlayedThrough,
        throttledPollingStillCounts,
        newPlayReplacesPendingListen,
        skippedTrackIsNotRecorded,
        missingPlayerBarRecordsImmediately,
        playedHidesPlayedTracks,
        playedAnyTabQueriesGlobalPlayedList,
        playCarriesActiveTabAfterSwitch,
        playedDoesNotHideRepeatsAcrossPages,
        playedPlaylistRule,
        pausedPlayedSendsNoQuery,
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
