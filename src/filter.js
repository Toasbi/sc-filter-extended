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

        // allowNone: reposts are excluded server-side via activityTypes — no items reach here.

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
        } while (url !== null);

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


(function () {
    const seenIds = new Set();
    // Start fetching followings immediately — no await here is intentional.
    const followings = getFollowingIdsAndUsernames();
    const config = JSON.parse(document.documentElement.dataset.scfConfig || "null");

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
            xhr.onload = function (event) {
                followings.then((followingData) => {
                    const responseData = JSON.parse(xhr.responseText);
                    if (config) {
                        responseData.collection = responseData.collection.filter((item) => {
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

                        if (config?.settings && shouldStopLoadingFeed(config.settings, responseData.collection)) {
                            responseData.next_href = null;
                        }
                    }
                    Object.defineProperty(xhr, "responseText", {value: JSON.stringify(responseData)});
                    onload.call(xhr, event);
                });
            };
        }
        send.call(this, data);
    };
})();
