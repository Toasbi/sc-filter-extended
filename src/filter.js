// ── Pure: filter helpers ──────────────────────────────────────────────────────

function daysSince(dateStr) {
    return (Date.now() - new Date(dateStr).getTime()) / 86400000;
}

// one-directional: "download ... free" would fire on any title mentioning both
const scfFreeKeywords = /\bfree[\s._-]*(?:d\/?l|downloads?)\b/i;
const scfFreeDomains = [
    "drive.google.com",
    "drive.proton.me",
    "dropbox.com",
    "droploud.com",
    "fangate.eu",
    "gate.influenceplanner.com",
    "gate.nitestore.xyz",
    "gaterush.me",
    "hypeddit.com",
    "ipln.io",
    "premierely.io",
    "pumpyoursound.com",
    "sharepoint.com",
    "tpstudio.space",
    "valorizd.app",
    "vlrz.me",
];
const scfContainsFreeDomain = (s) =>
    typeof s === "string" && scfFreeDomains.some((d) => s.includes(d));

function isFreeDownload(track) {
    if (track.downloadable === true) return true;
    if (scfFreeKeywords.test(track.title) ||
        scfFreeKeywords.test(track.purchase_title ?? "")) return true;
    return scfContainsFreeDomain(track.purchase_url) ||
        scfContainsFreeDomain(track.description);
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

// Path of a permalink, comparable with linkPath(); null if unparseable.
function permalinkPath(url) {
    if (typeof url !== "string") return null;
    try {
        return new URL(url, "https://soundcloud.com").pathname.replace(/\/+$/, "") || null;
    } catch (_e) {
        return null;
    }
}

// Anchors expose an already-parsed path, so no URL is built per feed link.
function linkPath(link) {
    return link.pathname?.replace(/\/+$/, "") || null;
}

// Playlists share the seen lists with tracks; negating keeps their ids apart.
function playlistSeenId(playlist) {
    return playlist?.id != null ? -playlist.id : null;
}

// Returns every seen-list id in a stream response collection: the track of each
// track / track-repost item, each playlist, and the tracks inside playlists.
// This is what filter.js asks content.js about in scf:seen-query.
function trackIdsIn(collection) {
    if (!Array.isArray(collection)) return [];
    const ids = new Set();
    for (const item of collection) {
        if (item?.track?.id != null) ids.add(item.track.id);
        const playlistId = playlistSeenId(item?.playlist);
        if (playlistId != null) ids.add(playlistId);
        const tracks = item?.playlist?.tracks;
        if (Array.isArray(tracks)) {
            for (const t of tracks) {
                if (t?.id != null) ids.add(t.id);
            }
        }
    }
    return [...ids];
}

// What a response hides from the user's history: {hides, ids, playlistRule}.
// hides is "seen", "played" or null; ids starts as content.js's scf:seen-result
// answer and, under "seen" only, also collects what the response shows.
function noHistory() {
    return {hides: null, ids: new Set(), playlistRule: "any"};
}

function historyCheckName(history) {
    return history.hides === "played" ? "alreadyPlayed" : "alreadySeen";
}

// Under "any" the playlist's own id also counts: it is recorded when a track is played from it.
function isPlaylistPlayed(playlist, playedIds, rule) {
    const trackIds = (Array.isArray(playlist.tracks) ? playlist.tracks : [])
        .map((t) => t?.id)
        .filter((id) => id != null);
    if (rule === "all") return trackIds.length > 0 && trackIds.every((id) => playedIds.has(id));
    return playedIds.has(playlistSeenId(playlist)) || trackIds.some((id) => playedIds.has(id));
}

// Returns true if the track should be removed.
// Pure: never mutates history. Caller adds the id to history.ids when the item passes.
// debug: optional object; if provided, debug.checks is appended with each evaluated check result.
function shouldFilterTrack(track, settings, history, debug) {
    if (history.hides !== null) {
        if (history.ids.has(track.id)) {
            if (debug) debug.checks.push(`${historyCheckName(history)} ✗ filtered`);
            return true;
        }
        if (debug) debug.checks.push(`${historyCheckName(history)} ✓`);
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
// shown: {ids, path, title} entries recorded as seen once on screen; a passing
// playlist pushes its seen-list ids under the playlist's link.
// debug: optional object; if provided, debug.checks is appended with each evaluated check result.
function shouldFilterPlaylist(playlist, settings, history, shown, debug) {
    // hideAll is enforced server-side via the activityTypes rewrite, but
    // playlist reposts can still arrive (the rewrite only strips PlaylistPost)
    // — remove any playlist that reaches here.
    if (settings.playlistFilter.enabled && settings.playlistFilter.mode === "hideAll") {
        if (debug) debug.checks.push("playlistFilter ✗ hideAll");
        return true;
    }
    const playlistId = playlistSeenId(playlist);
    if (history.hides === "seen" && history.ids.has(playlistId)) {
        if (debug) debug.checks.push("alreadySeen ✗ playlist filtered");
        return true;
    }
    if (history.hides === "played") {
        if (isPlaylistPlayed(playlist, history.ids, history.playlistRule)) {
            if (debug) debug.checks.push(`alreadyPlayed ✗ playlist filtered (${history.playlistRule})`);
            return true;
        }
        if (debug) debug.checks.push(`alreadyPlayed ✓ playlist (${history.playlistRule})`);
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

    // Under "played" the playlist rule alone decides; its tracks aren't hidden one by one.
    const trackHistory = history.hides === "played" ? noHistory() : history;
    const passingTracks = loadedTracks.filter((t) => {
        const trackDebug = debug ? {checks: []} : null;
        const filtered = shouldFilterTrack(t, settings, trackHistory, trackDebug);
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

    // A single-track playlist stands for its track; longer ones only for themselves.
    const seenAs = tracks.length === 1 ? [playlistId, tracks[0].id] : [playlistId];
    const ids = seenAs.filter((id) => id != null);
    if (history.hides === "seen") for (const id of ids) history.ids.add(id);
    shown.push({ids, path: permalinkPath(playlist.permalink_url), title: playlist.title});
    return false;
}

// Returns true if item should be removed from the feed.
// history.ids (under "seen") and shown (the entries recorded as seen once on
// screen) are mutated in two places: here (when a track passes) and inside
// shouldFilterPlaylist (a passing playlist marks itself seen directly).
// debug: optional object; if provided, debug.checks is appended with each evaluated check result.
// Keyed by the config's tagFilter object, which is replaced on every config push.
const scfTagSets = new WeakMap();

function tagSetsOf(tagFilter) {
    let sets = scfTagSets.get(tagFilter);
    if (!sets) {
        sets = {include: new Set(tagFilter.include), exclude: new Set(tagFilter.exclude)};
        scfTagSets.set(tagFilter, sets);
    }
    return sets;
}

function shouldFilterItem(item, settings, followingData, history, shown, debug) {
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
            const {include, exclude} = tagSetsOf(settings.tagFilter);
            const itemTags = getItemTags(tagObj);
            const blocked = itemTags.find((t) => exclude.has(t));
            if (blocked) {
                if (debug) debug.checks.push(`tagFilter ✗ excluded tag "${blocked}"`);
                return true;
            }
            if (include.size > 0 && !itemTags.some((t) => include.has(t))) {
                if (debug) debug.checks.push(`tagFilter ✗ no included tag (item: [${itemTags.join(", ")}])`);
                return true;
            }
            if (debug) debug.checks.push(`tagFilter ✓ (item: [${itemTags.join(", ")}])`);
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
        const filtered = shouldFilterTrack(item.track, settings, history, debug);
        if (!filtered) {
            if (history.hides === "seen") history.ids.add(item.track.id);
            shown.push({ids: [item.track.id], path: permalinkPath(item.track.permalink_url), title: item.track.title});
        }
        return filtered;
    }

    if (item.type === "playlist" || item.type === "playlist-repost") {
        return shouldFilterPlaylist(item.playlist, settings, history, shown, debug);
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

// ── Pure: seen & played ───────────────────────────────────────────────────────

function seenModeOf(cfg) {
    if (!cfg || cfg.type === "deepCuts") return "off";
    const mode = cfg.settings?.alreadySeen?.mode;
    return mode === "seen" || mode === "played" ? mode : "off";
}

// The history a tab hides right now ("seen" | "played"), or null when off or paused.
function hiddenHistoryOf(cfg) {
    const mode = seenModeOf(cfg);
    return mode === "off" || cfg.settings.alreadySeen.paused === true ? null : mode;
}

function isPlayHistoryPost(method, url) {
    if (typeof method !== "string" || method.toUpperCase() !== "POST" || typeof url !== "string") return false;
    try {
        const parsed = new URL(url);
        return parsed.hostname === "api-v2.soundcloud.com" &&
            parsed.pathname.replace(/\/+$/, "") === "/me/play-history";
    } catch (_e) {
        return false;
    }
}

function urnId(urn, kind) {
    const match = typeof urn === "string" ? urn.match(/^soundcloud:([a-z-]+):(\d+)$/) : null;
    if (!match || match[1] !== kind) return null;
    const id = Number(match[2]);
    return Number.isSafeInteger(id) ? id : null;
}

// SoundCloud's play-history body, e.g. {"context_urn":"soundcloud:playlists:1","track_urn":"soundcloud:tracks:2"}.
// Returns {trackId, playlistId} (playlistId null without a playlist context), or null.
function parsePlayHistoryBody(body) {
    if (typeof body !== "string") return null;
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch (_e) {
        return null;
    }
    const trackId = urnId(parsed?.track_urn, "tracks");
    if (trackId === null) return null;
    return {trackId, playlistId: urnId(parsed.context_urn, "playlists")};
}

function playedIdsOf({trackId, playlistId}) {
    return playlistId === null ? [trackId] : [trackId, -playlistId];
}

// SoundCloud posts a play after 1 s of playback, so listening starts at 1.
function startListen(player, threshold) {
    return {path: player.path, position: player.position, now: player.now, listened: 1, threshold, status: "listening"};
}

// Advances a listen by one player sample ({path, position, duration, playing, now},
// or null when the player bar is gone). Samples can be far apart in a background
// tab, so an advance counts up to the wall time elapsed (+1 s); a bigger jump is
// a seek. A track shorter than the threshold counts once played to its last second.
function listenStep(state, sample) {
    if (sample === null || sample.path !== state.path) return {...state, status: "dropped"};
    const advanced = sample.position - state.position;
    const elapsed = (sample.now - state.now) / 1000;
    const listened = state.listened + (sample.playing && advanced > 0 && advanced <= elapsed + 1 ? advanced : 0);
    const target = sample.duration > 0 ? Math.min(state.threshold, sample.duration - 1) : state.threshold;
    return {
        ...state,
        position: Number.isFinite(sample.position) ? sample.position : state.position,
        now: sample.now,
        listened,
        status: listened >= target ? "done" : "listening",
    };
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
// isDebug is read lazily: the fetch starts before content.js has sent a config.
async function getFollowingUsers(isDebug) {
    let authToken = getCookie("oauth_token");
    if (authToken === null) {
        if (isDebug?.()) console.log("[SCF] Did not find OAuth token for current user");
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

        if (isDebug?.()) console.log(`[SCF] Fetched ${followings.length} followings for current user`);
        return followings;
    } catch (e) {
        console.warn("[SCF] failed to get following list:", e);
        return [];
    }
}

// Returns the ids and usernames of the users that we're following
// in the format {ids: Set<integer>, usernames: Array<string>}
async function getFollowingIdsAndUsernames(isDebug) {
    let users = await getFollowingUsers(isDebug);
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

// ── Impure: seen-tracks channel to content.js ────────────────────────────────
// Details are JSON strings — objects don't cross the content-script ↔ page boundary cleanly in Firefox.

// If content.js doesn't answer in time (e.g. it was invalidated by an
// extension update), continue as if nothing was seen so the feed never hangs.
// Top-level var so tests can shorten it through the vm sandbox.
var SEEN_QUERY_TIMEOUT_MS = 3000;
// Bounds the memory and observed anchors of entries whose items never render.
var UNSEEN_MAX_PATHS = 500;
// Same for the first config: without it, responses pass through unfiltered.
var CONFIG_WAIT_MS = 3000;
let scfSeenReqId = 0;

// Asks content.js which of `ids` are in tab `tabId`'s `list` ("seen" | "played")
// of scope `source` ("tab" | "all"). Resolves to a fresh Set of matching ids;
// resolves to an empty Set on timeout.
function querySeen(tabId, list, source, ids) {
    const reqId = ++scfSeenReqId;
    return new Promise((resolve) => {
        const timer = setTimeout(() => done([]), SEEN_QUERY_TIMEOUT_MS);
        function done(seen) {
            clearTimeout(timer);
            document.removeEventListener("scf:seen-result", onResult);
            resolve(new Set(Array.isArray(seen) ? seen : []));
        }
        function onResult(event) {
            let res;
            try {
                res = JSON.parse(event.detail);
            } catch (_e) {
                return;
            }
            if (res && res.reqId === reqId) done(res.seen);
        }
        document.addEventListener("scf:seen-result", onResult);
        document.dispatchEvent(new CustomEvent("scf:seen-query", {
            detail: JSON.stringify({reqId, tabId, list, source, ids}),
        }));
    });
}

// Reports the track ids a tab just showed, so content.js records them into
// the tab's own list and the shared list.
function reportSeen(tabId, ids) {
    document.dispatchEvent(new CustomEvent("scf:seen", {
        detail: JSON.stringify({tabId, ids: [...new Set(ids)]}),
    }));
}

// tabId is null before the first config and on non-settings tabs, which never hide by
// history; the shared lists are recorded anyway.
function reportPlayed(tabId, ids) {
    document.dispatchEvent(new CustomEvent("scf:played", {
        detail: JSON.stringify({tabId, ids}),
    }));
}

// ── Impure: player bar ───────────────────────────────────────────────────────

function readPlayer() {
    const link = document.querySelector(".playbackSoundBadge__titleLink");
    const progress = document.querySelector(".playbackTimeline__progressWrapper");
    if (!link || !progress) return null;
    return {
        path: permalinkPath(link.getAttribute("href")),
        position: parseInt(progress.getAttribute("aria-valuenow"), 10),
        duration: parseInt(progress.getAttribute("aria-valuemax"), 10),
        playing: document.querySelector(".playControl")?.classList.contains("playing") === true,
        now: Date.now(),
    };
}

(function () {
    // Skip counters for the loading-spinner info text; reset on every feed reset.
    let scfSkipped = 0; // items hidden by the active filter in this feed view
    let scfScanned = 0; // total items seen in this feed view
    // Shown tracks count as seen once their feed link is on screen, not when
    // their page loads. Both are cleared on every feed reset.
    const scfUnseen = new Map(); // link path → {tabId, ids, title}
    const scfWatchedLinks = new Map(); // link path → Set of observed anchors
    const scfShownInView = new Set(); // hides repeats of not-yet-seen tracks under "seen"
    // Mutable: re-read from the dataset on every scf:apply-config event.
    let config = JSON.parse(document.documentElement.dataset.scfConfig || "null");
    // Start fetching followings immediately — no await here is intentional.
    const followings = getFollowingIdsAndUsernames(() => config?.debug);

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

    // Feeds the tab bar's info section. Same rule as scfUpdateSkipInfo: only
    // fired from the response and reset handlers, never from a feed observer.
    function scfReportStats(tabId) {
        document.dispatchEvent(new CustomEvent("scf:stats", {
            detail: JSON.stringify({tabId, filtered: scfSkipped, scanned: scfScanned}),
        }));
    }

    // The browser reports when a watched link enters the viewport, so scrolling
    // runs no script, and a hidden tab (which doesn't render) records nothing.
    const scfOnScreen = new IntersectionObserver((entries) => {
        const byTab = new Map();
        for (const {target, isIntersecting} of entries) {
            if (!isIntersecting) continue;
            const path = linkPath(target);
            const entry = scfUnseen.get(path);
            scfUnwatchPath(path);
            scfOnScreen.unobserve(target);
            if (!entry) continue;
            scfUnseen.delete(path);
            if (!byTab.has(entry.tabId)) byTab.set(entry.tabId, []);
            byTab.get(entry.tabId).push(...entry.ids);
            if (config?.debug) console.log(`[SCF] seen on screen "${entry.title}"`);
        }
        for (const [tabId, ids] of byTab) reportSeen(tabId, ids);
        if (scfUnseen.size === 0) scfStopWatchingFeed();
    });

    function scfUnwatchPath(path) {
        const links = scfWatchedLinks.get(path);
        if (!links) return;
        for (const link of links) scfOnScreen.unobserve(link);
        scfWatchedLinks.delete(path);
    }

    // Links outside the feed (other pages, the player bar) prove nothing.
    // `scope` is where the node sits; removed nodes are detached, so it is their old parent.
    function scfFeedLinksIn(node, scope = node) {
        if (node?.nodeType !== 1) return [];
        if (!scope?.closest?.(".stream__list")) return node.querySelectorAll(".stream__list a[href]");
        const links = [...node.querySelectorAll("a[href]")];
        if (node.matches("a[href]")) links.push(node);
        return links;
    }

    function scfWatchLinks(links) {
        for (const link of links) {
            const path = linkPath(link);
            if (!scfUnseen.has(path)) continue;
            let watched = scfWatchedLinks.get(path);
            if (!watched) {
                watched = new Set();
                scfWatchedLinks.set(path, watched);
            }
            if (watched.has(link)) continue;
            watched.add(link);
            scfOnScreen.observe(link);
        }
    }

    // Detached anchors would stay observed (and retained) forever; their unseen entry stays in case the item renders again.
    function scfForgetLinks(node, parent) {
        for (const link of scfFeedLinksIn(node, parent)) {
            const path = linkPath(link);
            const watched = scfWatchedLinks.get(path);
            if (!watched?.delete(link)) continue;
            scfOnScreen.unobserve(link);
            if (watched.size === 0) scfWatchedLinks.delete(path);
        }
    }

    // Catches items whenever SoundCloud renders them, including lazily on
    // scroll. Only reads the DOM, so it cannot re-trigger itself.
    const scfFeedWatcher = new MutationObserver((records) => {
        for (const record of records) {
            if (scfWatchedLinks.size > 0) for (const node of record.removedNodes) scfForgetLinks(node, record.target);
            for (const node of record.addedNodes) scfWatchLinks(scfFeedLinksIn(node));
        }
    });

    // Once connected, the watcher sees every later render, so the full scan
    // only has to catch what was on the page before.
    let scfFeedWatched = false;
    function scfWatchFeed() {
        if (scfFeedWatched || scfUnseen.size === 0) return;
        scfFeedWatched = true;
        scfFeedWatcher.observe(document.documentElement, {childList: true, subtree: true});
        scfWatchLinks(scfFeedLinksIn(document.querySelector(".stream__list")));
    }

    function scfStopWatchingFeed() {
        scfFeedWatched = false;
        scfFeedWatcher.disconnect();
        scfOnScreen.disconnect();
        scfWatchedLinks.clear();
    }

    // filter.js starts before content.js has read storage, so the first
    // feed response can arrive before any config does.
    // After one timeout, later responses stop waiting.
    let scfConfigWaitExpired = false;
    function scfWhenConfigured() {
        if (config || scfConfigWaitExpired) return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => {
                clearTimeout(timer);
                document.removeEventListener("scf:apply-config", done);
                resolve();
            };
            const timer = setTimeout(() => {
                scfConfigWaitExpired = true;
                done();
            }, CONFIG_WAIT_MS);
            document.addEventListener("scf:apply-config", done);
        });
    }

    function scfRecordPlay(ids) {
        const cfg = config;
        reportPlayed(cfg?.type === "settings" ? cfg.id : null, ids);
        if (cfg?.debug) console.log(`[SCF] played ${ids.join(", ")}`);
    }

    // One listen at a time: a new play replaces the pending one.
    let scfListenTimer = null;
    function scfOnPlay(play) {
        clearInterval(scfListenTimer);
        scfListenTimer = null;
        const ids = playedIdsOf(play);
        const threshold = config?.playedThreshold > 0 ? config.playedThreshold : 0;
        const player = threshold > 0 ? readPlayer() : null;
        // Without a readable player bar, count the play now rather than never.
        if (player === null) {
            scfRecordPlay(ids);
            return;
        }
        let listen = startListen(player, threshold);
        const timer = setInterval(() => {
            try {
                listen = listenStep(listen, readPlayer());
            } catch (_e) {
                listen = {...listen, status: "dropped"};
            }
            if (listen.status === "listening") return;
            clearInterval(timer);
            if (scfListenTimer === timer) scfListenTimer = null;
            if (listen.status === "done") scfRecordPlay(ids);
        }, 1000);
        scfListenTimer = timer;
    }

    // Capture the request URL in open() so it is available in send().
    // open() always precedes send() in the XHR lifecycle.
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
        if (url.startsWith("https://api-v2.soundcloud.com/stream?") && config) {
            url = applyActivityTypeFilter(url, config);
        }
        this._scf_method = method;
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
            const filterOnload = function (event) {
                // Always hand control back to SoundCloud's original onload, even if
                // our filtering fails — otherwise SC's fetch never completes and the
                // request hangs. finish() runs on the happy path, on any parse/filter
                // error (response passed through untouched), and even if the followings
                // lookup rejects.
                const finish = () => onload.call(xhr, event);
                // Snapshot the config so the seen query, the filtering and the
                // seen report all use the same tab.
                const cfg = config;
                const seenMode = seenModeOf(cfg);
                const hides = hiddenHistoryOf(cfg);
                // querySeen never rejects (timeout → empty Set).
                let seenPromise = Promise.resolve(new Set());
                if (hides !== null) {
                    try {
                        const ids = trackIdsIn(JSON.parse(xhr.responseText).collection);
                        if (ids.length > 0) {
                            seenPromise = querySeen(cfg.id, hides, cfg.settings.alreadySeen.source, ids);
                        }
                    } catch (_e) {
                        // Unparseable response — the handler below passes it through.
                    }
                }
                Promise.all([followings, seenPromise]).then(([followingData, seen]) => {
                    try {
                        if (cfg) {
                            if (hides === "seen") {
                                for (const id of scfShownInView) seen.add(id);
                            }
                            const history = {hides, ids: seen, playlistRule: cfg.playlistPlayedRule === "all" ? "all" : "any"};
                            const responseData = JSON.parse(xhr.responseText);
                            // The stop check must see the raw page: items that survive
                            // filtering always satisfy the age cap, so the filtered
                            // collection could never trip it.
                            const rawCollection = responseData.collection;
                            const shown = []; // {ids, path, title} of items that passed every filter
                            responseData.collection = rawCollection.filter((item) => {
                                const label = item.track?.title ?? item.playlist?.title ?? item.type;
                                if (cfg.type === "deepCuts") {
                                    const passes = applyDeepCutsFilter(item);
                                    if (cfg.debug) console.log(`[SCF] ${passes ? "SHOWN" : "FILTERED: deep cuts"} [${item.type}] "${label}"`);
                                    return passes;
                                }
                                const debug = cfg.debug ? {checks: []} : null;
                                const remove = shouldFilterItem(item, cfg.settings, followingData, history, shown, debug);
                                if (cfg.debug) console.log(`[SCF] ${remove ? "FILTERED" : "SHOWN"} [${item.type}] "${label}" — ${debug.checks.join(" | ")}`);
                                return !remove;
                            });

                            // Update the spinner's "Skipped X out of Y" counters.
                            scfScanned += rawCollection.length;
                            scfSkipped += rawCollection.length - responseData.collection.length;
                            scfUpdateSkipInfo();
                            scfReportStats(cfg.id);

                            if (cfg.settings && shouldStopLoadingFeed(cfg.settings, rawCollection)) {
                                responseData.next_href = null;
                            }
                            Object.defineProperty(xhr, "responseText", {value: JSON.stringify(responseData), configurable: true});

                            // Every mode but Off records what gets on screen, paused or not.
                            if (seenMode !== "off") {
                                const unlinked = [];
                                for (const {ids, path, title} of shown) {
                                    if (hides === "seen") ids.forEach((id) => scfShownInView.add(id));
                                    if (path) {
                                        scfUnseen.delete(path);
                                        scfUnseen.set(path, {tabId: cfg.id, ids, title});
                                    } else unlinked.push(...ids);
                                }
                                while (scfUnseen.size > UNSEEN_MAX_PATHS) {
                                    const oldest = scfUnseen.keys().next().value;
                                    scfUnseen.delete(oldest);
                                    scfUnwatchPath(oldest);
                                }
                                if (unlinked.length > 0) reportSeen(cfg.id, unlinked);
                                scfWatchFeed();
                            }
                        }
                    } catch (e) {
                        // Non-JSON / rate-limited / unexpected-shape response. Never
                        // let filtering break SoundCloud — leave responseText untouched.
                        if (cfg?.debug) console.warn("[SCF] response passed through unfiltered:", e);
                    }
                    finish();
                }, finish);
            };
            xhr.onload = function (event) {
                scfWhenConfigured()
                    .then(() => filterOnload.call(xhr, event))
                    .catch(() => onload.call(xhr, event));
            };
        }
        send.call(this, data);
        try {
            const play = isPlayHistoryPost(this._scf_method, this._scf_url) ? parsePlayHistoryBody(data) : null;
            if (play) scfOnPlay(play);
        } catch (e) {
            if (config?.debug) console.warn("[SCF] play not recorded:", e);
        }
    };

    // Config updates from content.js. "update-only" swaps the config used for
    // future requests; "reset-feed" additionally resets the skip counters and
    // rebuilds the feed in place, falling back to a full reload on failure.
    // State was persisted by content.js before dispatching, so a fallback
    // reload boots into the correct tab. Seen lists live in content.js and
    // are not touched by a reset.
    document.addEventListener("scf:apply-config", (event) => {
        config = JSON.parse(document.documentElement.dataset.scfConfig || "null");
        if (event.detail !== "reset-feed") return;
        scfSkipped = 0;
        scfScanned = 0;
        scfUnseen.clear();
        scfShownInView.clear();
        scfStopWatchingFeed();
        scfUpdateSkipInfo();
        scfReportStats(config?.id);
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
