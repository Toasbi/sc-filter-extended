// Dependency-free tests for src/content.js. Run: node test/content.test.js
//
// content.js is loaded into a fresh vm context per test with fake storage
// areas, fake timers and a fixed Date. Top-level function declarations and
// vars become sandbox properties; const/let are read through bits.peek().

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const contentSource = fs.readFileSync(path.join(__dirname, "../src/content.js"), "utf8");

// Sandbox objects have foreign prototypes, so compare them through plain().
const plain = (x) => JSON.parse(JSON.stringify(x));

// Real Node setImmediate, not the sandbox timers.
async function settle(rounds = 20) {
    for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

function makeArea(initial = {}) {
    const area = {
        data: JSON.parse(JSON.stringify(initial)),
        calls: [],
        failNextSet: false,
        get(keys) {
            const list = keys == null ? Object.keys(area.data) : [].concat(keys);
            area.calls.push({op: "get", keys: list});
            const out = {};
            for (const k of list) {
                if (k in area.data) out[k] = JSON.parse(JSON.stringify(area.data[k]));
            }
            return Promise.resolve(out);
        },
        set(obj) {
            area.calls.push({op: "set", keys: Object.keys(obj)});
            if (area.failNextSet) {
                area.failNextSet = false;
                return Promise.reject(new Error("quota"));
            }
            for (const [k, v] of Object.entries(obj)) area.data[k] = JSON.parse(JSON.stringify(v));
            return Promise.resolve();
        },
        remove(keys) {
            const list = [].concat(keys);
            area.calls.push({op: "remove", keys: list});
            for (const k of list) delete area.data[k];
            return Promise.resolve();
        },
    };
    return area;
}

// cards.js is not loaded, so its globals are stubbed. The non-feed URL makes
// initFilters return right after loadCardState.
function loadContent({sync = {}, local = {}, now = new Date(2026, 9, 18, 12).getTime()} = {}) {
    let clock = now;
    class FakeDate extends Date {
        constructor(...a) {
            if (a.length === 0) super(clock);
            else super(...a);
        }
        static now() {
            return clock;
        }
    }

    const timers = new Map();
    let nextTimer = 1;
    const setTimeout = (fn, ms) => {
        const id = nextTimer++;
        timers.set(id, {fn, ms});
        return id;
    };
    const clearTimeout = (id) => {
        timers.delete(id);
    };
    const runTimers = () => {
        const entries = [...timers.values()];
        timers.clear();
        for (const t of entries) t.fn();
        return entries.length;
    };
    const timerDelays = () => [...timers.values()].map((t) => t.ms);

    const errors = [];
    const events = [];
    const docListeners = new Map();
    const winListeners = new Map();
    const listen = (map) => (type, fn) => {
        if (!map.has(type)) map.set(type, []);
        map.get(type).push(fn);
    };
    const fireOn = (map) => (type, detail) => {
        for (const fn of map.get(type) ?? []) fn({type, detail});
    };

    const document = {
        documentElement: {dataset: {}},
        visibilityState: "visible",
        addEventListener: listen(docListeners),
        dispatchEvent(e) {
            events.push(e);
            for (const fn of docListeners.get(e.type) ?? []) fn(e);
            return true;
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementById: () => null,
    };

    class FakeCustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    }
    class FakeMutationObserver {
        observe() {}
        disconnect() {}
    }

    const browser = {
        storage: {sync: makeArea(sync), local: makeArea(local)},
        runtime: {getURL: (p) => "moz-extension://x/" + p},
    };
    const window = {
        browser,
        location: {href: "https://soundcloud.com/discover"},
        addEventListener: listen(winListeners),
    };
    const history = {state: null, replaceState() {}, scrollRestoration: "auto"};

    const sandbox = {
        console: {log() {}, warn() {}, error: (...a) => errors.push(a.map(String).join(" "))},
        URL,
        Date: FakeDate,
        setTimeout,
        clearTimeout,
        window,
        browser,
        history,
        document,
        CustomEvent: FakeCustomEvent,
        MutationObserver: FakeMutationObserver,
        loadCardState: () => Promise.resolve(),
        renderCard() {},
        renderCardAtLoad() {},
    };
    vm.createContext(sandbox);
    vm.runInContext(contentSource, sandbox);

    return {
        sandbox,
        local: browser.storage.local,
        sync: browser.storage.sync,
        errors,
        events,
        timerDelays,
        runTimers,
        setNow: (ms) => {
            clock = ms;
        },
        peek: (expr) => vm.runInContext(expr, sandbox),
        fire: fireOn(docListeners),
        fireWindow: fireOn(winListeners),
    };
}

async function loadsWithoutErrors() {
    const bits = loadContent();
    await settle();
    assert.deepStrictEqual(bits.errors, []);
    assert.strictEqual(bits.sandbox.historyListId("t1", "played", "tab"), "played:tab:t1");
    assert.strictEqual(bits.peek("SEEN_INDEX_KEY"), "scfSeenIndex");
    assert.strictEqual(typeof bits.sandbox.recordSeen, "function");
}

async function withContent() {
    const bits = loadContent();
    await settle();
    return bits.sandbox;
}

async function seenDayFormatsLocalDate() {
    const s = await withContent();
    assert.strictEqual(s.seenDay(new Date(2026, 9, 5)), "2026-10-05");
}

async function seenCutoffDayGoesBackMonths() {
    const s = await withContent();
    assert.strictEqual(s.seenCutoffDay(new Date(2026, 9, 18), 12), "2025-10-18");
    assert.strictEqual(s.seenCutoffDay(new Date(2026, 2, 31), 1), "2026-02-28");
    assert.strictEqual(s.seenCutoffDay(new Date(2024, 2, 31), 1), "2024-02-29");
    assert.strictEqual(s.seenCutoffDay(new Date(2026, 0, 15), 1), "2025-12-15");
}

async function seenPeriodExpiredForDaysAndLegacyMonths() {
    const s = await withContent();
    assert.strictEqual(s.seenPeriodExpired("2025-10-17", "2025-10-18"), true);
    assert.strictEqual(s.seenPeriodExpired("2025-10-18", "2025-10-18"), false);
    assert.strictEqual(s.seenPeriodExpired("2025-10", "2025-10-18"), false);
    assert.strictEqual(s.seenPeriodExpired("2025-09", "2025-10-18"), true);
}

async function sanitizeSeenIndexKeepsDaysAndMonths() {
    const s = await withContent();
    assert.deepStrictEqual(
        plain(
            s.sanitizeSeenIndex({
                all: { "2025-10": 3, "2026-10-18": 4, "2026-1-1": 2, x: 1, "2026-10-19": -1, "2026-10-20": 1.5 },
                bad: [1],
                nil: null,
            }),
        ),
        { all: { "2025-10": 3, "2026-10-18": 4 } },
    );
    assert.deepStrictEqual(plain(s.sanitizeSeenIndex(null)), {});
}

async function seenBucketKeyUsesPeriod() {
    const s = await withContent();
    assert.strictEqual(s.seenBucketKey("tab:t1", "2026-10-18"), "scfSeen:tab:t1:2026-10-18");
}

async function seenListCountSumsPeriods() {
    const s = await withContent();
    assert.strictEqual(s.seenListCount({ all: { "2025-10": 3, "2026-10-18": 4 } }, "all"), 7);
    assert.strictEqual(s.seenListCount({}, "all"), 0);
}

async function seenPendingTotalSumsSets() {
    const s = await withContent();
    assert.strictEqual(s.seenPendingTotal(new Map([["a", new Set([1, 2])], ["b", new Set([3])]])), 3);
}

async function planSeenPruneDropsExpired() {
    const s = await withContent();
    const index = { all: { "2025-09": 5, "2025-10": 3, "2025-10-17": 2, "2026-10-18": 4 } };
    assert.deepStrictEqual(plain(s.planSeenPrune(index, "2025-10-18", 1e9, 11)), [
        { listId: "all", period: "2025-09" },
        { listId: "all", period: "2025-10-17" },
    ]);
}

async function planSeenPruneEnforcesBudgetOldestFirst() {
    const s = await withContent();
    const index = { a: { "2026-10-01": 10 }, b: { "2026-10-02": 10 } };
    assert.deepStrictEqual(plain(s.planSeenPrune(index, "2025-10-18", 165, 11)), [
        { listId: "a", period: "2026-10-01" },
    ]);
}

async function planSeenPruneNothingToDrop() {
    const s = await withContent();
    assert.deepStrictEqual(plain(s.planSeenPrune({ a: { "2026-10-01": 1 } }, "2025-10-18", 1e9, 11)), []);
}

const sortedKeys = (call) => [...call.keys].sort();
const setCalls = (bits) => bits.local.calls.filter((c) => c.op === "set");

async function flushWritesOnlyTodaysDayBucket() {
    const bits = loadContent({
        local: {
            scfSeenIndex: {all: {"2026-09": 2}, "tab:t1": {"2026-09": 1}},
            "scfSeen:all:2026-09": [1, 2],
            "scfSeen:tab:t1:2026-09": [1],
        },
    });
    await settle();
    bits.local.calls.length = 0;
    const s = bits.sandbox;
    s.recordSeen("t1", [2, 3]);
    await settle();
    assert.strictEqual(setCalls(bits).length, 0);
    assert.ok(bits.timerDelays().includes(5000));
    bits.runTimers();
    await settle();
    const sets = setCalls(bits);
    assert.strictEqual(sets.length, 1);
    const expected = ["scfSeen:all:2026-10-18", "scfSeen:tab:t1:2026-10-18", "scfSeenIndex"];
    assert.deepStrictEqual(sortedKeys(sets[0]), expected);
    const gets = bits.local.calls.filter((c) => c.op === "get");
    assert.deepStrictEqual(sortedKeys(gets[gets.length - 1]), expected);
    const data = bits.local.data;
    assert.deepStrictEqual(data["scfSeen:all:2026-10-18"], [3]);
    assert.deepStrictEqual(data["scfSeen:tab:t1:2026-10-18"], [2, 3]);
    assert.deepStrictEqual(data.scfSeenIndex, {
        all: {"2026-09": 2, "2026-10-18": 1},
        "tab:t1": {"2026-09": 1, "2026-10-18": 2},
    });
    assert.deepStrictEqual(data["scfSeen:all:2026-09"], [1, 2]);
}

async function flushesImmediatelyAt200Pending() {
    const bits = loadContent();
    await settle();
    bits.local.calls.length = 0;
    const s = bits.sandbox;
    s.recordSeen("t1", Array.from({length: 99}, (_, i) => i + 1));
    await settle();
    assert.strictEqual(setCalls(bits).length, 0);
    s.recordSeen("t1", [100]);
    await settle();
    assert.strictEqual(setCalls(bits).length, 1);
    assert.strictEqual(bits.local.data["scfSeen:all:2026-10-18"].length, 100);
    assert.strictEqual(bits.timerDelays().includes(5000), false);
}

async function flushesWhenPageIsHidden() {
    const bits = loadContent();
    await settle();
    bits.local.calls.length = 0;
    bits.sandbox.recordSeen("t1", [5]);
    await settle();
    bits.sandbox.document.visibilityState = "hidden";
    bits.fire("visibilitychange");
    await settle();
    assert.strictEqual(setCalls(bits).length, 1);
    assert.deepStrictEqual(bits.local.data["scfSeen:all:2026-10-18"], [5]);

    const bits2 = loadContent();
    await settle();
    bits2.sandbox.recordSeen("t1", [6]);
    await settle();
    bits2.fireWindow("pagehide");
    await settle();
    assert.deepStrictEqual(bits2.local.data["scfSeen:all:2026-10-18"], [6]);
}

async function playsFlushImmediately() {
    const bits = loadContent();
    await settle();
    bits.local.calls.length = 0;
    bits.fire("scf:played", JSON.stringify({tabId: "t1", ids: [7]}));
    await settle();
    assert.strictEqual(setCalls(bits).length, 1);
    assert.deepStrictEqual(bits.local.data["scfSeen:played:2026-10-18"], [7]);
    assert.deepStrictEqual(bits.local.data["scfSeen:played:tab:t1:2026-10-18"], [7]);
}

async function countsComeFromMemoryWhileScrolling() {
    const bits = loadContent({
        local: {
            scfSeenIndex: {all: {"2026-09": 2}, played: {"2026-10-01": 1}},
            "scfSeen:all:2026-09": [1, 2],
            "scfSeen:played:2026-10-01": [1],
        },
    });
    await settle();
    const s = bits.sandbox;
    await s.getSeenSet("tab:t1");
    await s.getSeenSet("all");
    assert.deepStrictEqual(plain(await s.historyCounts("t1")), {tabSeen: 0, tabPlayed: 0, allSeen: 2, allPlayed: 1});
    bits.local.calls.length = 0;
    s.recordSeen("t1", [7, 8]);
    const after = {tabSeen: 2, tabPlayed: 0, allSeen: 4, allPlayed: 1};
    assert.deepStrictEqual(plain(await s.historyCounts("t1")), after);
    assert.strictEqual(bits.local.calls.filter((c) => c.op === "get").length, 0);
    bits.runTimers();
    await settle();
    assert.deepStrictEqual(plain(await s.historyCounts("t1")), after);
    assert.deepStrictEqual(bits.local.calls.map((c) => c.op), ["get", "set"]);
}

async function failedFlushKeepsAndRetriesIds() {
    const bits = loadContent();
    await settle();
    bits.local.failNextSet = true;
    bits.sandbox.recordSeen("t1", [9]);
    bits.runTimers();
    await settle();
    assert.strictEqual(bits.local.data["scfSeen:all:2026-10-18"], undefined);
    assert.strictEqual((await bits.sandbox.historyCounts("t1")).allSeen, 1);
    assert.ok(bits.timerDelays().includes(5000));
    bits.runTimers();
    await settle();
    assert.deepStrictEqual(bits.local.data["scfSeen:all:2026-10-18"], [9]);
}

async function legacyMonthBucketsStillHide() {
    const bits = loadContent({
        local: {
            scfSeenIndex: {all: {"2026-09": 2, "2026-10-01": 1}},
            "scfSeen:all:2026-09": [1, 2],
            "scfSeen:all:2026-10-01": [5],
        },
    });
    await settle();
    const set = await bits.sandbox.getSeenSet("all");
    assert.deepStrictEqual([...set].sort((a, b) => a - b), [1, 2, 5]);
}

async function flushMergesOtherWindowsWrites() {
    const bits = loadContent({
        local: {scfSeenIndex: {all: {"2026-10-18": 1}}, "scfSeen:all:2026-10-18": [1]},
    });
    await settle();
    const s = bits.sandbox;
    await s.getSeenSet("all");
    s.recordSeen("t1", [2]);
    bits.local.data["scfSeen:all:2026-10-18"] = [1, 3];
    bits.local.data.scfSeenIndex = {all: {"2026-10-18": 2}};
    bits.runTimers();
    await settle();
    assert.deepStrictEqual(bits.local.data["scfSeen:all:2026-10-18"], [1, 3, 2]);
    assert.strictEqual(bits.local.data.scfSeenIndex.all["2026-10-18"], 3);
    assert.strictEqual((await s.historyCounts("t1")).allSeen, 3);
}

async function pruneDropsExpiredDayAndLegacyMonthBuckets() {
    const bits = loadContent({
        local: {
            scfSeenIndex: {all: {"2025-09": 2, "2025-10": 1, "2025-10-17": 1, "2025-10-18": 1}},
            "scfSeen:all:2025-09": [1, 2],
            "scfSeen:all:2025-10": [3],
            "scfSeen:all:2025-10-17": [4],
            "scfSeen:all:2025-10-18": [5],
        },
    });
    await settle();
    const s = bits.sandbox;
    await s.pruneSeen(12);
    assert.deepStrictEqual(Object.keys(bits.local.data).sort(), ["scfSeen:all:2025-10", "scfSeenIndex"]);
    assert.deepStrictEqual(plain(bits.local.data.scfSeenIndex), {all: {"2025-10": 2}});
    bits.local.calls.length = 0;
    assert.strictEqual((await s.historyCounts("t1")).allSeen, 2);
    assert.strictEqual(bits.local.calls.filter((c) => c.op === "get").length, 0);
    assert.deepStrictEqual([...(await s.getSeenSet("all"))].sort((a, b) => a - b), [3, 5]);
}

async function pruneWithinRetentionAndBudgetRemovesNothing() {
    const bits = loadContent({
        local: {
            scfSeenIndex: {a: {"2026-10-01": 2}, b: {"2026-10-02": 2}},
            "scfSeen:a:2026-10-01": [1, 2],
            "scfSeen:b:2026-10-02": [1, 2],
        },
    });
    await settle();
    bits.local.calls.length = 0;
    await bits.sandbox.pruneSeen(12);
    assert.strictEqual(bits.local.calls.filter((c) => c.op === "remove").length, 0);
    assert.strictEqual(bits.local.calls.filter((c) => c.op === "set").length, 0);
    assert.deepStrictEqual(plain(bits.peek("seenIndexCache")), {a: {"2026-10-01": 2}, b: {"2026-10-02": 2}});
}

async function flushSkipsListsWhosePendingIdsAreAllStored() {
    const bits = loadContent({
        local: {scfSeenIndex: {all: {"2026-09": 1}}, "scfSeen:all:2026-09": [7]},
    });
    await settle();
    bits.sandbox.recordIds(["all"], [7]);
    bits.fireWindow("pagehide");
    await settle();
    assert.strictEqual("scfSeen:all:2026-10-18" in bits.local.data, false);
    assert.deepStrictEqual(plain(bits.local.data.scfSeenIndex), {all: {"2026-09": 1}});
}

async function clearSeenUpdatesCountsWithoutReading() {
    const bits = loadContent({
        local: {
            scfSeenIndex: {all: {"2026-10-18": 2}, "tab:t1": {"2026-10-18": 1}},
            "scfSeen:all:2026-10-18": [1, 2],
            "scfSeen:tab:t1:2026-10-18": [1],
        },
    });
    await settle();
    const s = bits.sandbox;
    await s.clearSeen(["tab:t1"]);
    bits.local.calls.length = 0;
    assert.deepStrictEqual(plain(await s.historyCounts("t1")), {tabSeen: 0, tabPlayed: 0, allSeen: 2, allPlayed: 0});
    assert.strictEqual(bits.local.calls.filter((c) => c.op === "get").length, 0);
    assert.strictEqual("scfSeen:tab:t1:2026-10-18" in bits.local.data, false);
    await s.clearSeen(null);
    assert.deepStrictEqual(plain(await s.historyCounts("t1")), {tabSeen: 0, tabPlayed: 0, allSeen: 0, allPlayed: 0});
    assert.strictEqual("scfSeenIndex" in bits.local.data, false);
}

async function seenBytesFromMemory() {
    const bits = loadContent({
        local: {scfSeenIndex: {all: {"2026-10-18": 3}}, "scfSeen:all:2026-10-18": [1, 2, 3]},
    });
    await settle();
    const s = bits.sandbox;
    await s.getSeenSet("all");
    await s.getSeenSet("tab:t1");
    s.recordSeen("t1", [9]);
    assert.strictEqual(await s.seenBytes(), 55);
}

async function planSeenCompactionGroupsPastMonthsPerList() {
    const s = await withContent();
    const index = {
        all: {"2026-08": 4, "2026-09-02": 1, "2026-09-01": 1, "2026-10-01": 2, "2026-07-31": 1},
        "tab:t1": {"2026-09-30": 1, "2026-10-17": 3},
        played: {"2026-10-02": 1},
    };
    const plan = plain(s.planSeenCompaction(index, "2026-10"));
    const byKey = Object.fromEntries(plan.map((p) => [`${p.listId}|${p.month}`, p.days]));
    assert.strictEqual(plan.length, 3);
    assert.deepStrictEqual(byKey["all|2026-09"], ["2026-09-01", "2026-09-02"]);
    assert.deepStrictEqual(byKey["all|2026-07"], ["2026-07-31"]);
    assert.deepStrictEqual(byKey["tab:t1|2026-09"], ["2026-09-30"]);
}

async function planSeenCompactionIgnoresMonthsAndCurrentMonth() {
    const s = await withContent();
    assert.deepStrictEqual(plain(s.planSeenCompaction({all: {"2026-09": 3, "2026-10-01": 1, "2026-10-18": 2}}, "2026-10")), []);
    assert.deepStrictEqual(plain(s.planSeenCompaction({}, "2026-10")), []);
}

const seenFixtureLastMonth = () => ({
    scfSeenIndex: {all: {"2026-09": 2, "2026-09-05": 2, "2026-09-20": 2, "2026-10-03": 1}, "tab:t1": {"2026-09-05": 1}},
    "scfSeen:all:2026-09": [1, 2],
    "scfSeen:all:2026-09-05": [2, 3],
    "scfSeen:all:2026-09-20": [3, 4],
    "scfSeen:all:2026-10-03": [9],
    "scfSeen:tab:t1:2026-09-05": [7],
});

async function pruneCompactsPastMonthsIntoOneBucket() {
    const bits = loadContent({local: seenFixtureLastMonth()});
    await settle();
    const s = bits.sandbox;
    bits.local.calls.length = 0;
    await s.pruneSeen(12);
    const data = bits.local.data;
    assert.deepStrictEqual(Object.keys(data).sort(), [
        "scfSeen:all:2026-09", "scfSeen:all:2026-10-03", "scfSeen:tab:t1:2026-09", "scfSeenIndex",
    ]);
    assert.deepStrictEqual([...data["scfSeen:all:2026-09"]].sort(), [1, 2, 3, 4]);
    assert.deepStrictEqual(data["scfSeen:tab:t1:2026-09"], [7]);
    const expected = {all: {"2026-09": 4, "2026-10-03": 1}, "tab:t1": {"2026-09": 1}};
    assert.deepStrictEqual(plain(data.scfSeenIndex), expected);
    assert.deepStrictEqual(plain(bits.peek("seenIndexCache")), expected);
    bits.local.calls.length = 0;
    assert.strictEqual((await s.historyCounts("t1")).allSeen, 5);
    assert.strictEqual(bits.local.calls.length, 0);
    assert.deepStrictEqual(bits.errors, []);
}

async function compactionSetsBeforeRemoving() {
    const bits = loadContent({local: seenFixtureLastMonth()});
    await settle();
    bits.local.calls.length = 0;
    await bits.sandbox.pruneSeen(12);
    const ops = bits.local.calls.map((c) => c.op);
    assert.deepStrictEqual(ops, ["get", "get", "set", "remove"]);
    const set = bits.local.calls[2];
    assert.deepStrictEqual(sortedKeys(set), ["scfSeen:all:2026-09", "scfSeen:tab:t1:2026-09", "scfSeenIndex"]);
    assert.deepStrictEqual(sortedKeys(bits.local.calls[3]), [
        "scfSeen:all:2026-09-05", "scfSeen:all:2026-09-20", "scfSeen:tab:t1:2026-09-05",
    ]);
}

async function secondPruneAfterCompactionWritesNothing() {
    const bits = loadContent({local: seenFixtureLastMonth()});
    await settle();
    await bits.sandbox.pruneSeen(12);
    bits.local.calls.length = 0;
    await bits.sandbox.pruneSeen(12);
    assert.deepStrictEqual(bits.local.calls.map((c) => c.op), ["get"]);
}

async function compactedIdsStayHidden() {
    const bits = loadContent({local: seenFixtureLastMonth()});
    await settle();
    await bits.sandbox.pruneSeen(12);
    const set = await bits.sandbox.getSeenSet("all");
    assert.deepStrictEqual([...set].sort((a, b) => a - b), [1, 2, 3, 4, 9]);
}

async function compactionHealsIndexEntryWithoutBucket() {
    const bits = loadContent({
        local: {scfSeenIndex: {all: {"2026-09-05": 2, "2026-09-06": 1}}, "scfSeen:all:2026-09-06": [5]},
    });
    await settle();
    await bits.sandbox.pruneSeen(12);
    assert.deepStrictEqual(plain(bits.local.data.scfSeenIndex), {all: {"2026-09": 1}});
    assert.deepStrictEqual(bits.local.data["scfSeen:all:2026-09"], [5]);
}

async function pruneFailureDuringCompactionResetsCache() {
    const bits = loadContent({local: seenFixtureLastMonth()});
    await settle();
    bits.local.failNextSet = true;
    await bits.sandbox.pruneSeen(12);
    assert.strictEqual(bits.peek("seenIndexCache"), null);
    assert.strictEqual(bits.errors.length, 1);
    assert.strictEqual("scfSeen:all:2026-09-05" in bits.local.data, true);
}

async function becomingVisibleRereadsIndexForCounts() {
    const bits = loadContent({local: {scfSeenIndex: {all: {"2026-10-18": 1}}, "scfSeen:all:2026-10-18": [1]}});
    await settle();
    const s = bits.sandbox;
    bits.peek('infoTab = {id: "t1", type: "settings", settings: {alreadySeen: {mode: "seen", paused: false, source: "all"}}}');
    assert.strictEqual((await s.historyCounts("t1")).allSeen, 1);
    bits.local.data.scfSeenIndex = {all: {"2026-10-18": 5}, "tab:t1": {"2026-10-18": 2}};
    bits.local.calls.length = 0;
    s.document.visibilityState = "visible";
    bits.fire("visibilitychange");
    await settle();
    assert.deepStrictEqual(bits.local.calls.map((c) => c.op), ["get"]);
    assert.deepStrictEqual(plain(await s.historyCounts("t1")), {tabSeen: 2, tabPlayed: 0, allSeen: 5, allPlayed: 0});
    assert.strictEqual(bits.peek("infoCounts").allSeen, 5);
    s.document.visibilityState = "hidden";
    bits.local.calls.length = 0;
    bits.fire("visibilitychange");
    await settle();
    assert.strictEqual(bits.local.calls.length, 0);
}

(async () => {
    const tests = [
        loadsWithoutErrors,
        seenDayFormatsLocalDate,
        seenCutoffDayGoesBackMonths,
        seenPeriodExpiredForDaysAndLegacyMonths,
        sanitizeSeenIndexKeepsDaysAndMonths,
        seenBucketKeyUsesPeriod,
        seenListCountSumsPeriods,
        seenPendingTotalSumsSets,
        planSeenPruneDropsExpired,
        planSeenPruneEnforcesBudgetOldestFirst,
        planSeenPruneNothingToDrop,
        flushWritesOnlyTodaysDayBucket,
        flushesImmediatelyAt200Pending,
        flushesWhenPageIsHidden,
    playsFlushImmediately,
        countsComeFromMemoryWhileScrolling,
        failedFlushKeepsAndRetriesIds,
        legacyMonthBucketsStillHide,
        flushMergesOtherWindowsWrites,
        pruneDropsExpiredDayAndLegacyMonthBuckets,
        pruneWithinRetentionAndBudgetRemovesNothing,
        flushSkipsListsWhosePendingIdsAreAllStored,
        clearSeenUpdatesCountsWithoutReading,
        seenBytesFromMemory,
        planSeenCompactionGroupsPastMonthsPerList,
        planSeenCompactionIgnoresMonthsAndCurrentMonth,
        pruneCompactsPastMonthsIntoOneBucket,
        compactionSetsBeforeRemoving,
        secondPruneAfterCompactionWritesNothing,
        compactedIdsStayHidden,
        compactionHealsIndexEntryWithoutBucket,
        pruneFailureDuringCompactionResetsCache,
        becomingVisibleRereadsIndexForCounts,
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
