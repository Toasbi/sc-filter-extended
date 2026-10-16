// Loaded after content.js: shares its global scope (infoCounts, SEEN_INDEX_KEY, browser, …).

// ── Constants ────────────────────────────────────────────────────────────────

const FIREFOX_STORE_URL = "https://addons.mozilla.org/en-GB/firefox/addon/soundcloud-feedfilter-extended/";
const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/soundcloud-feed-filter-ex/mnfcpieidcneompnhaamejajfodlclal";

// Shared-history size at which the one-time rating prompt appears.
const RATING_MIN_PLAYED = 100;
const RATING_MIN_SEEN = 200;
const RATING_MESSAGE = "Thank you for using my extension <3\nIf you enjoy it, a rating in the store helps a lot, and if you want to support it you can buy me a coffee.\nFeedback is always welcome too.";

// target: what the step highlights; clicking any match advances the tour.
const ONBOARDING_STEPS = [
    {target: ".scf-gear-btn", text: "Welcome! Each tab is a filter preset for your feed. Hover over a tab and click the pencil on the right to open its settings."},
    {target: ".scf-add-link", text: "Add your own filter tabs with +."},
    {target: ".scf-info-link", text: "Click the info icon to show this tab's stats: how many tracks were skipped, and how many you've seen or played."},
    {target: ".scf-global-gear-link", text: "The gear on the left opens the extension settings: how long your history is kept, when a track counts as played, and this tour if you want to see it again."},
];

// ── Pure: card choice ─────────────────────────────────────────────────────────

// A replayed tour was asked for, so it outranks the rating prompt; the first-run tour waits.
function cardToShow({tour, ratingDue}) {
    if (tour?.replay) return "tour";
    if (ratingDue) return "rating";
    return tour ? "tour" : null;
}

function shouldAskForRating({played, seen, done}) {
    return !done && (played >= RATING_MIN_PLAYED || seen >= RATING_MIN_SEEN);
}

// manifest_version can't tell the browsers apart: the MV3 manifest also carries gecko settings.
function storeUrlFor(extensionBaseUrl) {
    return extensionBaseUrl.startsWith("moz-extension://") ? FIREFOX_STORE_URL : CHROME_STORE_URL;
}

// No stored tabs and no history means a fresh install; users updating skip the tour.
function shouldShowOnboarding({done, hasStoredTabs, hasHistory}) {
    return done === false || (done === undefined && !hasStoredTabs && !hasHistory);
}

// ── Pure: DOM builders ────────────────────────────────────────────────────────

function buildRatingPrompt() {
    const prompt = document.createElement("div");
    prompt.id = "scf-rating-prompt";
    prompt.className = "scf-card";
    prompt.innerHTML = `<button class="scf-close-btn" data-rating-action title="Close">×</button>
    <p class="scf-card-text"></p>
    <div class="scf-panel-footer">
      <a class="scf-text-btn" data-rating-action href="${GITHUB_ISSUES_URL}" target="_blank" rel="noopener noreferrer">Feedback</a>
      <a class="scf-coffee-btn" data-rating-action href="${BUY_ME_A_COFFEE_URL}" target="_blank" rel="noopener noreferrer">${COFFEE_ICON_SVG}<span>Buy me a coffee</span></a>
      <a class="scf-btn scf-btn-primary" data-rating-action href="${STORE_URL}" target="_blank" rel="noopener noreferrer">Rate</a>
    </div>`;
    prompt.querySelector(".scf-card-text").textContent = RATING_MESSAGE;
    return prompt;
}

function buildOnboardingCard(step, stepCount) {
    const card = document.createElement("div");
    card.id = "scf-onboarding";
    card.className = "scf-card";
    card.innerHTML = `<p class="scf-card-text"></p>
    <div class="scf-panel-footer">
      <button class="scf-text-btn" data-onboarding-skip>Skip</button>
      <span class="scf-card-step">${step + 1} / ${stepCount}</span>
      <button class="scf-btn scf-btn-primary" data-onboarding-next>${step + 1 < stepCount ? "Next" : "Got it"}</button>
    </div>`;
    card.querySelector(".scf-card-text").textContent = ONBOARDING_STEPS[step].text;
    return card;
}

// ── Impure: card state ────────────────────────────────────────────────────────

const STORE_URL = storeUrlFor(browser.runtime.getURL(""));

let ratingDone = null; // null until loaded; unknown counts as done
let ratingCounts = null; // latched by the first renderCardAtLoad of the document
let tour; // undefined until loaded, then null or {step, replay}; the step is never stored
let cardStateLoad = null;

// Kept out of loadState: a failure here must not fall back to default tabs. Retried on the next call.
function loadCardState() {
    cardStateLoad ??= readCardState().catch((e) => {
        console.error(e);
        cardStateLoad = null;
    });
    return cardStateLoad;
}

async function readCardState() {
    const [sync, local] = await Promise.all([
        browser.storage.sync.get(["scfRatingDone", "scFilterTabs"]),
        // Per device: a sync write from a fresh second install would restart the tour everywhere.
        browser.storage.local.get(["scfOnboardingDone", SEEN_INDEX_KEY]),
    ]);
    const showTour = shouldShowOnboarding({
        done: local.scfOnboardingDone,
        hasStoredTabs: sync.scFilterTabs !== undefined,
        hasHistory: local[SEEN_INDEX_KEY] !== undefined,
    });
    // The first tab switch stores scFilterTabs, which would otherwise end the tour.
    if (showTour && local.scfOnboardingDone === undefined) {
        await browser.storage.local.set({scfOnboardingDone: false});
    }
    // An answer, replay or finish in this tab may not have reached storage yet.
    if (ratingDone !== true) ratingDone = sync.scfRatingDone === true;
    if (tour === undefined) tour = showTour ? {step: 0, replay: false} : null;
}

function ratingDue() {
    return ratingCounts !== null && shouldAskForRating({...ratingCounts, done: ratingDone !== false});
}

// ── Impure: card slot ─────────────────────────────────────────────────────────

// Null off the feed page.
function liveTabBar() {
    return document.querySelector("#scf-stream-header > #scf-tab-bar");
}

// Rebuilt on every call: initFilters swaps in a new tab bar on SPA navigation.
function renderCard() {
    for (const el of document.querySelectorAll(".scf-card")) el.remove();
    for (const el of document.querySelectorAll(".scf-onboarding-target")) {
        el.classList.remove("scf-onboarding-target");
    }
    const bar = liveTabBar();
    if (!bar) return;
    const card = cardToShow({tour, ratingDue: ratingDue()});
    if (card === "rating") bar.after(ratingCard());
    if (card === "tour") {
        onboardingTarget(bar, tour.step)?.classList.add("scf-onboarding-target");
        bar.after(tourCard());
    }
}

// Counts are read once per document: Save/Delete/+ re-run initFilters mid-session,
// and inserting the card then would push the feed down.
function renderCardAtLoad() {
    ratingCounts ??= {played: infoCounts.allPlayed, seen: infoCounts.allSeen};
    renderCard();
}

function ratingCard() {
    const prompt = buildRatingPrompt();
    const onAction = (event) => {
        if (event.target.closest("[data-rating-action]")) answerRating();
    };
    prompt.addEventListener("click", onAction);
    // Middle-click opens the link without firing click.
    prompt.addEventListener("auxclick", (event) => {
        if (event.button === 1) onAction(event);
    });
    return prompt;
}

function answerRating() {
    browser.storage.sync.set({scfRatingDone: true}).catch(console.error);
    // Deferred: a link removed during its own click doesn't open.
    setTimeout(() => {
        ratingDone = true;
        renderCard();
    });
}

function tourCard() {
    const card = buildOnboardingCard(tour.step, ONBOARDING_STEPS.length);
    card.querySelector("[data-onboarding-skip]").addEventListener("click", finishTour);
    card.querySelector("[data-onboarding-next]").addEventListener("click", advanceTour);
    return card;
}

// Prefers the active tab's gear; Deep Cuts has none.
function onboardingTarget(bar, step) {
    const {target} = ONBOARDING_STEPS[step];
    return bar.querySelector(`.g-tabs-link.active ${target}`) ?? bar.querySelector(target);
}

// In memory only: storage already says done, and a reload shouldn't resume a replay.
function replayTour() {
    tour = {step: 0, replay: true};
    renderCard();
}

function advanceTour() {
    if (tour.step + 1 >= ONBOARDING_STEPS.length) {
        finishTour();
        return;
    }
    tour = {...tour, step: tour.step + 1};
    renderCard();
}

function finishTour() {
    tour = null;
    browser.storage.local.set({scfOnboardingDone: true}).catch(console.error);
    renderCard();
}

// Capture phase: the gear's own handler stops propagation. The panels still open normally.
document.addEventListener("click", (event) => {
    if (!document.getElementById("scf-onboarding") || !event.target.closest?.("#scf-tab-bar")) return;
    if (event.target.closest(ONBOARDING_STEPS[tour.step].target)) advanceTour();
}, true);

// Answered or finished in another SoundCloud tab.
browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.scfRatingDone?.newValue === true) ratingDone = true;
    else if (area === "local" && changes.scfOnboardingDone?.newValue === true) tour = null;
    else return;
    renderCard();
});
