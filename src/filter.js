// ── Pure: filter helpers ──────────────────────────────────────────────────────

function daysSince(dateStr) {
    return (Date.now() - new Date(dateStr).getTime()) / 86400000;
}

function isFreeDownload(track) {
    if (track.downloadable === true) return true;
    const freeKeywords = /free dl|free download|freedownload\b/i;
    if (freeKeywords.test(track.title)) return true;
    const freeDomains = [
        "hypeddit.com",
        "pumpyoursound.com",
        "drive.google.com",
        "sharepoint.com",
        "dropbox.com",
        "gaterush.me",
        "vlrz.me",
        "valorizd.app",
        "fangate.eu",
        "premierely.io"
    ];
    const containsFreeDomain = (s) => freeDomains.some((d) => s.includes(d));
    const purchaseUrl = track.purchase_url;
    if (typeof purchaseUrl === "string" && containsFreeDomain(purchaseUrl))
        return true;
    const desc = track.description;
    if (typeof desc === "string" && containsFreeDomain(desc)) return true;
    return false;
}

function getItemTags(obj) {
    const tags = [];
    if (typeof obj.genre === "string" && obj.genre.length > 0) {
        tags.push(obj.genre.toLowerCase());
    }
    if (typeof obj.tag_list === "string" && obj.tag_list.length > 0) {
        const raw = obj.tag_list;
        let i = 0;
        while (i < raw.length) {
            while (i < raw.length && raw[i] === " ") i++;
            if (i >= raw.length) break;
            let token;
            if (raw[i] === '"') {
                const end = raw.indexOf('"', i + 1);
                token = raw.slice(i + 1, end === -1 ? raw.length : end).trim();
                i = end === -1 ? raw.length : end + 1;
            } else {
                const end = raw.indexOf(" ", i);
                token = raw.slice(i, end === -1 ? raw.length : end);
                i = end === -1 ? raw.length : end;
            }
            if (token.length > 0) tags.push(token.toLowerCase());
        }
    }
    const seen = new Set();
    return tags.filter((t) => {
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
    });
}

function applyActivityTypeFilter(url, config) {
    if (!config.settings) return url;
    const hideAllPlaylists = config.settings.playlistFilter.enabled &&
        config.settings.playlistFilter.mode === "hideAll";
    const hideAllReposts = config.settings.filterReposts.enabled &&
        config.settings.filterReposts.type === "allowNone";
    if (!hideAllPlaylists && !hideAllReposts) return url;

    const parsed = new URL(url);
    const existing = parsed.searchParams.get("activityTypes");
    // Fall back to the known default set when the param is absent.
    // SoundCloud's stream API currently recognises three types: TrackPost, TrackRepost, PlaylistPost.
    // If SoundCloud adds new types in future, this fallback would over-constrain the request,
    // but that is acceptable because these are explicit "suppress all" intents.
    let types = existing
        ? existing.split(",")
        : ["TrackPost", "TrackRepost", "PlaylistPost"];
    if (hideAllPlaylists) types = types.filter((t) => t !== "PlaylistPost");
    if (hideAllReposts) types = types.filter((t) => t !== "TrackRepost");
    if (types.length === 0) return url; // defensive: never send activityTypes= to server
    parsed.searchParams.set("activityTypes", types.join(","));
    return parsed.toString();
}

// Returns true if the track should be removed.
// Pure: never mutates seenIds. Caller adds id to seenIds when item passes.
// debug: optional object; if provided, debug.checks is appended with each evaluated check result.
function shouldFilterTrack(track, settings, seenIds, debug) {
    if (settings.alreadySeen.enabled) {
        if (seenIds.has(track.id)) {
            if (debug) debug.checks.push("alreadySeen ✗ filtered");
            return true;
        }
        if (debug) debug.checks.push("alreadySeen ✓");
    }
    if (settings.trackLengthInMin.enabled) {
        const minutes = Math.min(track.duration / 60000, 120);
        if (minutes < settings.trackLengthInMin.min || minutes > settings.trackLengthInMin.max) {
            if (debug) debug.checks.push(`trackLength ✗ ${minutes.toFixed(1)}min outside [${settings.trackLengthInMin.min}, ${settings.trackLengthInMin.max}]`);
            return true;
        }
        if (debug) debug.checks.push(`trackLength ✓ ${minutes.toFixed(1)}min in [${settings.trackLengthInMin.min}, ${settings.trackLengthInMin.max}]`);
    }
    if (settings.freeDownloadsOnly.enabled) {
        if (!isFreeDownload(track)) {
            if (debug) debug.checks.push("freeDownload ✗ not a free download");
            return true;
        }
        if (debug) debug.checks.push("freeDownload ✓");
    }
    if (settings.contentAgeInDays.enabled && settings.contentAgeInDays.max !== null) {
        const age = daysSince(track.created_at);
        if (age > settings.contentAgeInDays.max) {
            if (debug) debug.checks.push(`contentAge.max ✗ ${age.toFixed(1)}d > max ${settings.contentAgeInDays.max}d`);
            return true;
        }
        if (debug) debug.checks.push(`contentAge.max ✓ ${age.toFixed(1)}d ≤ ${settings.contentAgeInDays.max}d`);
    }
    return false;
}

// Returns true if the playlist should be removed.
// debug: optional object; if provided, debug.checks is appended with each evaluated check result.
function shouldFilterPlaylist(playlist, settings, seenIds, debug) {
    // hideAll is enforced server-side via the activityTypes rewrite, but
    // playlist reposts can still arrive (the rewrite only strips PlaylistPost)
    // — remove any playlist that reaches here.
    if (settings.playlistFilter.enabled && settings.playlistFilter.mode === "hideAll") {
        if (debug) debug.checks.push("playlistFilter ✗ hideAll");
        return true;
    }
    const tracks = playlist.tracks;
    if (!tracks || tracks.length === 0) return false;
    if (settings.contentAgeInDays.enabled && settings.contentAgeInDays.max !== null) {
        const age = daysSince(playlist.created_at);
        if (age > settings.contentAgeInDays.max) {
            if (debug) debug.checks.push(`contentAge.max ✗ playlist ${age.toFixed(1)}d > max ${settings.contentAgeInDays.max}d`);
            return true;
        }
        if (debug) debug.checks.push(`contentAge.max ✓ playlist ${age.toFixed(1)}d ≤ ${settings.contentAgeInDays.max}d`);
    }

    const playlistFilter = settings.playlistFilter;
    const loadedTracks = tracks.filter((t) => t.duration != null);
    const isHideLargeEnabled = playlistFilter.enabled && playlistFilter.mode === "hideLarge";

    // hideLarge: remove playlists whose full track list exceeds what the API returned.
    if (isHideLargeEnabled) {
        if (playlist.track_count > loadedTracks.length) {
            if (debug) debug.checks.push(`playlistFilter ✗ large (${loadedTracks.length}/${playlist.track_count} loaded)`);
            return true;
        }
        if (debug) debug.checks.push(`playlistFilter ✓ not large (${loadedTracks.length}/${playlist.track_count})`);
    }

    const passingTracks = loadedTracks.filter((t) => {
        const trackDebug = debug ? {checks: []} : null;
        const filtered = shouldFilterTrack(t, settings, seenIds, trackDebug);
        if (debug) console.log(`[SCF]   track-in-playlist ${filtered ? "FILTERED" : "SHOWN"} "${t.title}" — ${trackDebug.checks.join(" | ")}`);
        return !filtered;
    });
    if (passingTracks.length === 0) {
        if (debug) debug.checks.push("tracks ✗ all tracks in playlist filtered out");
        return true;
    }
    if (debug) debug.checks.push(`tracks ✓ ${passingTracks.length}/${loadedTracks.length} pass`);

    // nameInTitles: only active with hideLarge — require reposter username in at least one passing track title.
    if (isHideLargeEnabled && playlistFilter.nameInTitles) {
        const lowerUsername = playlist.user.username.toLowerCase();
        if (!passingTracks.some((t) => t.title.toLowerCase().includes(lowerUsername))) {
            if (debug) debug.checks.push(`nameInTitles ✗ "${playlist.user.username}" not in any track title`);
            return true;
        }
        if (debug) debug.checks.push(`nameInTitles ✓`);
    }

    // Single-track playlists mark the track as seen (used to bump feed position).
    if (tracks.length === 1) seenIds.add(tracks[0].id);
    return false;
}

// Returns true if item should be removed from the feed.
// seenIds is mutated in two places: here (caller adds id when track passes) and inside
// shouldFilterPlaylist (single-track playlists mark the track seen directly).
// debug: optional object; if provided, debug.checks is appended with each evaluated check result.
function shouldFilterItem(item, settings, followingData, seenIds, debug) {
    // Feed age filter (all types)
    if (settings.contentAgeInDays.enabled && settings.contentAgeInDays.min !== null) {
        const age = daysSince(item.created_at);
        if (age < settings.contentAgeInDays.min) {
            if (debug) debug.checks.push(`contentAge.min ✗ ${age.toFixed(1)}d < min ${settings.contentAgeInDays.min}d`);
            return true;
        }
        if (debug) debug.checks.push(`contentAge.min ✓ ${age.toFixed(1)}d ≥ ${settings.contentAgeInDays.min}d`);
    }

    // Tag filter (track and playlist types)
    if (settings.tagFilter.enabled) {
        const tagObj = item.track ?? item.playlist ?? null;
        if (tagObj != null) {
            const itemTags = getItemTags(tagObj);
            if (settings.tagFilter.mode === "include") {
                if (itemTags.length === 0 || !itemTags.some((t) => settings.tagFilter.tags.includes(t))) {
                    if (debug) debug.checks.push(`tagFilter ✗ no matching include tags (item: [${itemTags.join(", ")}])`);
                    return true;
                }
                if (debug) debug.checks.push(`tagFilter ✓ matched include tag (item: [${itemTags.join(", ")}])`);
            } else {
                const blocked = itemTags.find((t) => settings.tagFilter.tags.includes(t));
                if (blocked) {
                    if (debug) debug.checks.push(`tagFilter ✗ blocked tag "${blocked}"`);
                    return true;
                }
                if (debug) debug.checks.push(`tagFilter ✓ no blocked tags (item: [${itemTags.join(", ")}])`);
            }
        }
    }

    // filterReposts filter
    if (settings.filterReposts.enabled && item.type.includes("repost")) {
        const content = item.track ?? item.playlist;
        const userId = content?.user_id;

        // allowNone: track reposts are excluded server-side via activityTypes,
        // but playlist reposts can still arrive (the rewrite only strips
        // TrackRepost) — remove any repost that reaches here.
        if (settings.filterReposts.type === "allowNone") {
            if (debug) debug.checks.push("filterReposts ✗ allowNone");
            return true;
        }

        if (settings.filterReposts.type === "allowRepostedTracksOfFollowers") {
            if (item.type === "track-repost") {
                // userId is the original uploader's ID, not the reposter's.
                // Username substring fallback handles the case where you follow the
                // reposter but not the original artist.
                const title = item.track?.title ?? "";
                const artist = item.track?.publisher_metadata?.artist;
                const passes = followingData.ids.has(userId) ||
                    followingData.usernames.some(u => title.includes(u) || artist?.includes(u));
                if (!passes) {
                    if (debug) debug.checks.push("filterReposts ✗ original artist not followed");
                    return true;
                }
                if (debug) debug.checks.push("filterReposts ✓ original artist followed");
            } else {
                // playlist-repost: ID check only, no username substring check
                if (!followingData.ids.has(userId)) {
                    if (debug) debug.checks.push("filterReposts ✗ playlist repost artist not followed");
                    return true;
                }
                if (debug) debug.checks.push("filterReposts ✓ playlist repost artist followed");
            }
        }

        if (settings.filterReposts.type === "allowOnlyFromNotFollowing") {
            if (followingData.ids.has(userId)) {
                if (debug) debug.checks.push("filterReposts ✗ repost from followed user");
                return true;
            }
            if (debug) debug.checks.push("filterReposts ✓ repost from non-followed user");
        }
    }

    // allowOnlyFromNotFollowing also hides direct posts from followed users
    if (
        settings.filterReposts.enabled &&
        settings.filterReposts.type === "allowOnlyFromNotFollowing" &&
        (item.type === "track" || item.type === "playlist")
    ) {
        const content = item.track ?? item.playlist;
        const userId = content?.user_id;
        if (followingData.ids.has(userId)) {
            if (debug) debug.checks.push("filterReposts ✗ direct post from followed user");
            return true;
        }
        if (debug) debug.checks.push("filterReposts ✓ direct post from non-followed user");
    }

    // Per-type content filters
    if (item.type === "track" || item.type === "track-repost") {
        const filtered = shouldFilterTrack(item.track, settings, seenIds, debug);
        if (!filtered) seenIds.add(item.track.id);
        return filtered;
    }

    if (item.type === "playlist" || item.type === "playlist-repost") {
        return shouldFilterPlaylist(item.playlist, settings, seenIds, debug);
    }

    return false;
}

// Hardcoded deep-cuts filter — shows underground/emerging content.
function applyDeepCutsFilter(item) {
    const content = item.track ?? item.playlist;
    if (!content) return false;
    const userIsNotPopular = content.user.followers_count < 150;
    const daysOld = daysSince(content.created_at);
    const fewPlays =
        content.playback_count &&
        daysOld > 5 &&
        content.playback_count <
        5000 / (1 + Math.exp(-(daysOld + 50) / 1500)) - 2500;
    return userIsNotPopular || fewPlays;
}

// ── XHR intercept ─────────────────────────────────────────────────────────────

// Takes a base URL and an object containing query params and
// generates a URL with the query params appended.
function withQuery(baseUrl, params) {
    let url = new URL(baseUrl);
    Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
    return url.toString();
}

// Wrapper for fetch() that takes a query parameter and adds
// it to the URL, and returns the result as JSON.
async function fetchJson(url, init) {
    if (init?.query) {
        url = withQuery(url, init.query);
        delete init.query;
    }
    const resp = await fetch(url, init);
    if (!resp.ok) {
        throw new Error(`Request to ${url} failed with result ${resp.status}`);
    }
    return resp.json();
}

// Wrapper for fetchJson() that adds the authToken parameter.
async function fetchAuthorized(url, authToken) {
    const headers = authToken ? {Authorization: "OAuth " + authToken} : {};
    return fetchJson(url, {headers}); // `await` dropped — no-op on tail return in async fn
}

// Returns the value of the specified cookie, or null if the
// cookie is not set.
function getCookie(key) {
    let match = document.cookie.match(new RegExp("(^|;) *" + key + "=([^;]+)"));
    if (match !== null) {
        return match[2];
    }
    return null;
}


// Gets the list of users that the current user is following.
// This is necessary in the scenario that the user follows both
// users A and B. If A posts a track and B reposts it, the track
// will only show up in the stream once as a repost. If we don't
// do this, we will end up removing the track altogether from
// the stream, even though it's probably something the user
// wanted to see.
async function getFollowingUsers() {
    let authToken = getCookie("oauth_token");
    if (authToken === null) {
        console.log("Did not find OAuth token for current user");
        return [];
    }

    try {
        let me = await fetchAuthorized(
            "https://api-v2.soundcloud.com/me",
            authToken
        );

        // This appears to be limited to 200 server-side, so no point
        // asking for more than that
        let followings = [];
        let url = `https://api-v2.soundcloud.com/users/${me.id}/followings?limit=200`;
        do {
            let resp = await fetchAuthorized(url, authToken);
            followings = followings.concat(resp.collection);
            url = resp.next_href;
        } while (url); // next_href may be null or absent on the last page

        console.log(`Fetched ${followings.length} followings for current user`);
        return followings;
    } catch (e) {
        alert("SoundCloud repost blocker: failed to get following list: " + e);
        return [];
    }
}

// Returns the ids and usernames of the users that we're following
// in the format {ids: Set<integer>, usernames: Array<string>}
async function getFollowingIdsAndUsernames() {
    let users = await getFollowingUsers();
    return {
        ids: new Set(users.map(u => u.id)),
        usernames: users.map(u => u.username),
    };
}

function shouldStopLoadingFeed(settings, responseCollection) {
    const maxContentAgeInDays = settings.contentAgeInDays?.max;
    const isContentAgeLimitEnabled = settings.contentAgeInDays?.enabled;

    if (!(isContentAgeLimitEnabled && maxContentAgeInDays !== null)) {
        return false;
    }
    const isDirectContentPost = (item) =>
        item.type === "track" || item.type === "playlist";

    const directContentPosts = responseCollection.filter(isDirectContentPost);
    const lastDirectContentPost = directContentPosts[directContentPosts.length - 1];
    const lastContent = lastDirectContentPost?.track ?? lastDirectContentPost?.playlist;

    return lastContent && daysSince(lastContent.created_at) > maxContentAgeInDays;
}

// ── Impure: SoundCloud internals bridge ──────────────────────────────────────
// Everything in this section touches undocumented SoundCloud internals and is
// expected to break eventually. All internals access is quarantined here; the
// only entry point is softResetFeed(), and every failure mode is a thrown
// Error (or rejected promise) that the caller turns into a full page reload
// (the pre-soft-reset behavior). Discovery is by shape and stable string
// names, never by webpack module ID: IDs are sequential integers that change
// on every SoundCloud deploy, but method/property names (currentLayout,
// getSourceInfo, empty, fetch, ...) survive minification. Verified 2026-07-04
// against app_version 1782999645.
//
// The reset mechanism refreshes the live stream collection IN PLACE:
// collection.empty() clears its models + pagination (next_href/offset), then
// collection.fetch({reset: true}) refetches from offset 0 and re-renders the
// list. Because activityTypes is never changed, this never touches
// SoundCloud's order-sensitive collection pool — the collection object is
// reused and every call is a genuine fresh fetch, with no stale-cache
// restoration across repeated switches (verified across 3 back-to-back runs).
// The XHR open() patch rewrites the fetch's activityTypes to match the active
// tab. Two mechanisms were tried and rejected: (1) view._initCollection() +
// rerender() — a SILENT NO-OP when activityTypes is unchanged (the pool
// returns the same cached instance); (2) alternating activityTypes orderings —
// ping-pongs between two stale cached collections after the first two switches
// (the pool is order-sensitive and caches each ordering).

const scfInternals = {wpr: null, registry: null};
let scfResetGeneration = 0; // bumped per softResetFeed; a superseded reset skips its wedge check
let scfStreamSendCount = 0; // total stream XHRs sent; lets softResetFeed verify its fetch went out
const scfInflightStreamXhrs = new Set(); // in-flight stream XHRs, tracked so softResetFeed can abort them

// Extracts webpack's internal require function via the legacy webpackJsonp
// chunk-push trick (SoundCloud uses the pre-webpack-5 array-push runtime).
function getWebpackRequire() {
    if (scfInternals.wpr) return scfInternals.wpr;
    const jsonp = window.webpackJsonp;
    if (!Array.isArray(jsonp)) throw new Error("webpackJsonp not found");
    let captured = null;
    const probeId = "scf-probe-" + Math.random().toString(36).slice(2);
    jsonp.push([[], {[probeId]: (module, exports, req) => { captured = req; }}, [[probeId]]]);
    if (typeof captured !== "function" || !captured.c) {
        throw new Error("webpack require capture failed");
    }
    scfInternals.wpr = captured;
    return captured;
}

// Locates SoundCloud's named-object registry by shape: a cached module whose
// exports expose .get(name) where .get("router") returns the live router (an
// object with a currentLayout). Probing arbitrary modules can throw; each
// candidate is isolated in its own try/catch.
function findRouterRegistry(wpr) {
    if (scfInternals.registry) return scfInternals.registry;
    for (const id of Object.keys(wpr.c)) {
        try {
            const exp = wpr.c[id] && wpr.c[id].exports;
            if (!exp || typeof exp.get !== "function") continue;
            const router = exp.get("router");
            if (router && typeof router === "object" && "currentLayout" in router) {
                scfInternals.registry = exp;
                return exp;
            }
        } catch (_e) {
            // not the registry — keep scanning
        }
    }
    throw new Error("router registry module not found");
}

// Resolves the live feed list view. Never cached: the layout and its views
// are replaced on SPA navigation, so a cached view would go stale.
function findStreamListView() {
    const registry = findRouterRegistry(getWebpackRequire());
    const layout = registry.get("router")?.currentLayout;
    const contentView = layout?._currentViews?.["l-content"];
    if (!contentView || !Array.isArray(contentView.subviews)) {
        throw new Error("stream page view not found");
    }
    const matches = contentView.subviews.filter((sv) =>
        sv &&
        sv.collection &&
        typeof sv.collection.empty === "function" &&
        typeof sv.collection.fetch === "function" &&
        sv.collection.getSourceInfo?.()?.type === "stream"
    );
    if (matches.length !== 1) {
        throw new Error(`expected exactly 1 stream list view, found ${matches.length}`);
    }
    return matches[0];
}

// Refreshes the live stream feed in place. empty() clears the current
// collection's models and pagination state; fetch({reset: true}) refetches
// from offset 0. The collection object is reused (activityTypes untouched → the
// order-sensitive pool is never involved), so this is a genuine fresh fetch
// every call. The XHR open() patch rewrites the request's activityTypes to
// match the active tab.
//
// In-flight stream requests are aborted FIRST. SoundCloud won't start a new
// fetch while one is already in flight (so the reset would be silently skipped),
// and a late in-flight page can append stale items to the just-reset feed.
//
// view.rerender() right after empty() is THE load-bearing line. Fetching while
// the lazy list still holds many stale item views (~35+, i.e. after scrolling;
// never at one page's worth) makes SoundCloud's reset handler throw
// (getListItemView hits a pooled view whose model is gone:
// "undefined.getEquivalencyKey", onCollectionReset → syncItems). That exception
// fires inside jQuery's done-queue for the reset request and silently kills
// every callback behind it: the cleanup that removes the request from the
// collection's URL-keyed _requests map never runs, and since fetch() returns
// any existing _requests entry instead of fetching, every later reset (always
// the same offset=0 URL) is silently skipped — feed dead on ALL tabs until a
// hard reload, with no error surfacing anywhere. Rerendering first empties the
// view pool, so the reset response syncs against clean state and the exception
// never fires. (This same exception also caused the stale-rows-after-switch
// symptom that the former post-reset re-sync loop worked around.)
//
// Rejects (→ caller reloads) when the SoundCloud internals can't be found, or
// when the wedge check sees that fetch() issued no stream request — either way
// the reset demonstrably did not happen and a reload is warranted.
async function softResetFeed() {
    const view = findStreamListView();
    const coll = view.collection;
    const gen = ++scfResetGeneration;
    for (const xhr of scfInflightStreamXhrs) {
        try { xhr.abort(); } catch (_e) { /* already settled */ }
    }
    scfInflightStreamXhrs.clear();
    const sendsBefore = scfStreamSendCount;
    coll.empty();
    view.rerender();
    window.scrollTo(0, 0);
    coll.fetch({reset: true});
    // Wedge check: a skipped fetch (stale _requests entry, changed internals, …)
    // fails silently, so verify a stream request actually went out. Checks the
    // REQUEST, never the response: heavy-filter tabs auto-paginate for many
    // seconds hunting for matches, and a slow response must not cause a reload.
    await new Promise((r) => setTimeout(r, 1500));
    if (scfResetGeneration !== gen) return; // superseded by a newer switch
    if (scfStreamSendCount === sendsBefore) {
        throw new Error("reset fetch issued no stream request — feed is wedged");
    }
}

(function () {
    const seenIds = new Set();
    // Skip counters for the loading-spinner info text; reset on every feed reset.
    let scfSkipped = 0; // items hidden by the active filter in this feed view
    let scfScanned = 0; // total items seen in this feed view
    // Start fetching followings immediately — no await here is intentional.
    const followings = getFollowingIdsAndUsernames();
    // Mutable: re-read from the dataset on every scf:apply-config event.
    let config = JSON.parse(document.documentElement.dataset.scfConfig || "null");

    // Shows "Skipped X items out of Y" inside SoundCloud's infinite-scroll
    // spinner (div.loading) while it is visible, so a longer load reads as the
    // filter working rather than the page hanging. Called from the response
    // handler (below) as each page loads — the spinner is still on screen then.
    // NOTE: do NOT drive this from a MutationObserver on the feed subtree — the
    // textContent write below is itself a subtree mutation and would re-trigger
    // the observer in an infinite loop, hanging the page. The value-guard keeps
    // the write idempotent regardless.
    function scfUpdateSkipInfo() {
        const text = scfScanned > 0 ? `Skipped ${scfSkipped} items out of ${scfScanned}` : "";
        for (const spinner of document.querySelectorAll(".stream__list .loading")) {
            let info = spinner.querySelector(".scf-skip-info");
            if (!info) {
                // SoundCloud's .loading is a flex row; let it wrap so the info
                // sits on its own line below the spinner (flex:0 0 100%).
                spinner.style.flexWrap = "wrap";
                info = document.createElement("div");
                info.className = "scf-skip-info";
                info.style.cssText = "flex:0 0 100%;padding-top:14px;font-size:14px;line-height:1.4;text-align:center;color:#999;";
                spinner.appendChild(info);
            }
            if (info.textContent !== text) info.textContent = text;
        }
    }

    // Capture the request URL in open() so it is available in send().
    // open() always precedes send() in the XHR lifecycle.
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        if (url.startsWith("https://api-v2.soundcloud.com/stream?") && config) {
            url = applyActivityTypeFilter(url, config);
        }
        this._scf_url = url;
        return open.call(this, method, url, ...args);
    };

    const send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.send = function (data) {
        const xhr = this;
        const onload = xhr.onload;
        // Only intercept stream requests that have an onload handler.
        if (onload && xhr._scf_url && xhr._scf_url.startsWith("https://api-v2.soundcloud.com/stream?")) {
            // Track in-flight so softResetFeed can abort it; loadend fires for
            // success, error, AND abort, so the entry is always cleaned up.
            scfStreamSendCount++;
            scfInflightStreamXhrs.add(xhr);
            xhr.addEventListener("loadend", () => scfInflightStreamXhrs.delete(xhr));
            xhr.onload = function (event) {
                // Always hand control back to SoundCloud's original onload, even if
                // our filtering fails — otherwise SC's fetch never completes and the
                // request hangs. finish() runs on the happy path, on any parse/filter
                // error (response passed through untouched), and even if the followings
                // lookup rejects.
                const finish = () => onload.call(xhr, event);
                followings.then((followingData) => {
                    try {
                        if (config) {
                            const responseData = JSON.parse(xhr.responseText);
                            // The stop check must see the raw page: items that survive
                            // filtering always satisfy the age cap, so the filtered
                            // collection could never trip it.
                            const rawCollection = responseData.collection;
                            responseData.collection = rawCollection.filter((item) => {
                                const label = item.track?.title ?? item.playlist?.title ?? item.type;
                                if (config.type === "deepCuts") {
                                    const passes = applyDeepCutsFilter(item);
                                    if (config?.debug) console.log(`[SCF] ${passes ? "SHOWN" : "FILTERED: deep cuts"} [${item.type}] "${label}"`);
                                    return passes;
                                }
                                const debug = config?.debug ? {checks: []} : null;
                                const remove = shouldFilterItem(item, config.settings, followingData, seenIds, debug);
                                if (config?.debug) console.log(`[SCF] ${remove ? "FILTERED" : "SHOWN"} [${item.type}] "${label}" — ${debug.checks.join(" | ")}`);
                                return !remove;
                            });

                            // Update the spinner's "Skipped X out of Y" counters.
                            scfScanned += rawCollection.length;
                            scfSkipped += rawCollection.length - responseData.collection.length;
                            scfUpdateSkipInfo();

                            if (config?.settings && shouldStopLoadingFeed(config.settings, rawCollection)) {
                                responseData.next_href = null;
                            }
                            Object.defineProperty(xhr, "responseText", {value: JSON.stringify(responseData), configurable: true});
                        }
                    } catch (e) {
                        // Non-JSON / rate-limited / unexpected-shape response. Never
                        // let filtering break SoundCloud — leave responseText untouched.
                        if (config?.debug) console.warn("[SCF] response passed through unfiltered:", e);
                    }
                    finish();
                }, finish);
            };
        }
        send.call(this, data);
    };

    // Config updates from content.js. "update-only" swaps the config used for
    // future requests; "reset-feed" additionally clears session state and
    // rebuilds the feed in place, falling back to a full reload on failure.
    // State was persisted by content.js before dispatching, so a fallback
    // reload boots into the correct tab.
    document.addEventListener("scf:apply-config", (event) => {
        config = JSON.parse(document.documentElement.dataset.scfConfig || "null");
        if (event.detail !== "reset-feed") return;
        seenIds.clear();
        scfSkipped = 0;
        scfScanned = 0;
        scfUpdateSkipInfo();
        // softResetFeed rejects when the SoundCloud internals can't be found or
        // when its wedge check saw no stream request go out — either way the
        // reset demonstrably didn't happen, so fall back to a full reload. State
        // was already persisted by content.js, so the reload boots into the
        // correct tab.
        softResetFeed().catch((err) => {
            console.error("[SCF] soft feed reset failed — falling back to reload:", err);
            window.location.reload();
        });
    });
})();
