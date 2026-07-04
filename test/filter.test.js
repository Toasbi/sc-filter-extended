// Dependency-free tests for src/filter.js. Run: node test/filter.test.js
//
// filter.js is a page script with no module exports, so each test loads it
// into a fresh vm context with stubbed browser globals (document, alert,
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
        alreadySeen: {enabled: false},
        playlistFilter: {enabled: false, mode: "hideLarge", nameInTitles: false},
        tagFilter: {enabled: false, mode: "include", tags: []},
        ...overrides,
    };
}

// Loads filter.js into a fresh sandbox. `config` becomes the active tab config
// (written to the dataset exactly like content.js does). With no cookie the
// followings lookup resolves to [] without touching fetch.
function loadFilter({config = null, cookie = "", fetch} = {}) {
    class FakeXHR {}
    FakeXHR.prototype.open = function () {};
    FakeXHR.prototype.send = function () {};
    FakeXHR.prototype.addEventListener = function () {};

    const alerts = [];
    const sandbox = {
        console: {log() {}, warn() {}, error() {}},
        URL,
        setTimeout,
        alert: (msg) => alerts.push(String(msg)),
        window: {},
        document: {
            cookie,
            documentElement: {dataset: {scfConfig: config ? JSON.stringify(config) : ""}},
            addEventListener() {},
            // The response handler updates the skip-info spinner text on every
            // page (scfUpdateSkipInfo); without this stub that throws and the
            // pass-through catch returns the response unfiltered.
            querySelectorAll: () => [],
        },
        XMLHttpRequest: FakeXHR,
    };
    if (fetch) sandbox.fetch = fetch;
    vm.createContext(sandbox);
    vm.runInContext(filterSource, sandbox);
    return {sandbox, alerts, XHR: FakeXHR};
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
    await new Promise((r) => setTimeout(r, 20)); // let the followings .then chain settle
    assert.ok(originalOnloadCalled, "original onload must always be invoked");
    return JSON.parse(xhr.responseText);
}

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
    assert.deepStrictEqual(bits.alerts, [], "no error alert when next_href is absent");
}

(async () => {
    const tests = [
        stopsPaginationWhenPageReachesAgeCap,
        allowNoneFiltersPlaylistReposts,
        hideAllPlaylistsFiltersPlaylistReposts,
        followingsPaginationStopsWhenNextHrefAbsent,
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
