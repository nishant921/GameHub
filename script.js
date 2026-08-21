const API_BASE_URL = "https://www.freetogame.com/api";

// FreeToGame's category/tag vocabulary doesn't line up one-to-one with
// the genre keys already used in index.html (data-genre="..."), so we
// map them here. Everything goes through the same "category" query
// param. "adventure", "rpg", and "simulation" have no exact FreeToGame
// equivalent — these are the closest available tags.
const genreMap = {
    action: "action",
    adventure: "open-world",   // closest available tag; no true "adventure" category
    rpg: "action-rpg",         // closest available tag; no plain "rpg" category
    racing: "racing",
    strategy: "strategy",
    sports: "sports",
    horror: "horror",
    simulation: "sandbox"      // closest available tag; no true "simulation" category
};


/* ======================================================================
   2. STATE
   ====================================================================== */

const STORAGE_KEYS = {
    favorites: "gamehub-favorites",
    wishlist: "gamehub-wishlist",
    recent: "gamehub-recent"
};

const state = {
    // Every normalized game we've ever fetched this session, keyed by id.
    // Favorites/Wishlist/Recently Viewed look games up here so they can
    // render even if that game isn't part of the currently loaded lists.
    gameCache: new Map(),

    // The current Explore result set, already normalized, from the last
    // search/genre API call. Year/Sort are applied client-side on top of
    // this without re-hitting the API. (Rating filter is a no-op — see
    // gameMatchesClientFilters — since FreeToGame has no rating data.)
    explore: {
        rawResults: [],
        nextPageUrl: null, // always null — FreeToGame has no pagination
        loading: false
    },

    favoriteIds: loadIdListFromStorage(STORAGE_KEYS.favorites),
    wishlistIds: loadIdListFromStorage(STORAGE_KEYS.wishlist),
    recentIds: loadIdListFromStorage(STORAGE_KEYS.recent),

    filters: {
        search: "",
        genre: "all",
        rating: 0,
        year: "all",
        sort: "relevance"
    }
};


/* ======================================================================
   3. API FUNCTIONS
   ====================================================================== */

// Requests already in flight or already completed are cached by their
// full URL, so re-selecting the same filters or re-opening a game you
// already viewed doesn't cost another network request.
const apiCache = new Map();

function buildUrl(path, params = {}) {
    const url = new URL(`${API_BASE_URL}${path}`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
            url.searchParams.set(key, value);
        }
    });
    return url.toString();
}

class ApiError extends Error {
    constructor(kind, message) {
        super(message);
        this.kind = kind;
    }
}

async function cachedFetch(url) {
    if (apiCache.has(url)) {
        return apiCache.get(url);
    }

    const requestPromise = (async () => {
        let response;
        try {
            response = await fetch(url);
        } catch (networkErr) {
            throw new ApiError("network", "A network error occurred while contacting FreeToGame.");
        }

        if (response.status === 404) {
            throw new ApiError("not-found", "That game or endpoint couldn't be found.");
        }
        if (response.status === 429) {
            throw new ApiError("rate-limit", "Too many requests to FreeToGame. Please wait a moment.");
        }
        if (!response.ok) {
            throw new ApiError("unknown", `FreeToGame request failed (status ${response.status}).`);
        }

        return response.json();
    })();

    apiCache.set(url, requestPromise);

    try {
        return await requestPromise;
    } catch (err) {
        // Don't cache failures — allow retrying later.
        apiCache.delete(url);
        throw err;
    }
}

async function fetchPopularGames() {
    const url = buildUrl("/games", { "sort-by": "popularity" });
    const data = await cachedFetch(url);
    const games = (Array.isArray(data) ? data : []).slice(0, 10).map(normalizeGame);
    registerGames(games);
    return games;
}

async function fetchTrendingGames() {
    // FreeToGame has no literal "trending" endpoint; sorting by most
    // recent release date is a reasonable stand-in for "what's hot now".
    const url = buildUrl("/games", { "sort-by": "release-date" });
    const data = await cachedFetch(url);
    const games = (Array.isArray(data) ? data : []).slice(0, 10).map(normalizeGame);
    registerGames(games);
    return games;
}

async function fetchGameDetails(gameId) {
    const url = buildUrl("/game", { id: gameId });
    const data = await cachedFetch(url);
    const game = normalizeGame(data);
    registerGames([game]);
    return game;
}

// Counts per genre key, used for the "N titles" labels on the genre
// cards. FreeToGame doesn't expose counts directly, so we fetch each
// mapped category's game list once (cachedFetch dedupes/caches these)
// and use the array length.
async function fetchGenreCounts() {
    const entries = Object.entries(genreMap);
    const results = await Promise.all(
        entries.map(async ([key, category]) => {
            try {
                const url = buildUrl("/games", { category });
                const data = await cachedFetch(url);
                return [key, Array.isArray(data) ? data.length : 0];
            } catch (err) {
                return [key, undefined];
            }
        })
    );
    return Object.fromEntries(results);
}

// Powers the Explore grid. FreeToGame has no free-text search endpoint,
// so genre goes to the API (a real "category" param) and search is
// applied client-side against whatever that call returns. There's also
// no pagination — one request returns the full result set — so
// nextPageUrl is always null here.
async function fetchExploreGames({ search, genreKey } = {}) {
    const params = {};
    if (genreKey && genreKey !== "all" && genreMap[genreKey]) {
        params.category = genreMap[genreKey];
    }

    const url = buildUrl("/games", params);
    const data = await cachedFetch(url);
    let games = (Array.isArray(data) ? data : []).map(normalizeGame);

    if (search) {
        const needle = search.toLowerCase();
        games = games.filter((game) => game.title.toLowerCase().includes(needle));
    }

    registerGames(games);
    return { games, nextPageUrl: null };
}


/* ======================================================================
   4. normalizeGame()
   ----------------------------------------------------------------------
   Converts a raw FreeToGame game object (list or detail response — both
   use this same shape, detail just adds a couple of extra fields) into
   the flat object every other part of GameHub expects. This is the ONLY
   place that needs to change if the data source is ever swapped again.
   ====================================================================== */

function normalizeGame(rawGame) {
    return {
        id: rawGame.id,
        title: rawGame.title || "Untitled",
        // FreeToGame's list endpoint only gives short_description; the
        // single-game detail endpoint (fetchGameDetails) gives the full
        // "description" field, which is preferred when present.
        description: rawGame.description || rawGame.short_description || "No description available.",
        genre: rawGame.genre || "Unknown",
        genres: rawGame.genre ? [rawGame.genre] : [],
        // FreeToGame has no rating data at all — kept as null rather
        // than 0 so the UI can tell "no data" apart from "rated zero".
        rating: null,
        year: rawGame.release_date ? new Date(rawGame.release_date).getFullYear() : null,
        releaseDate: rawGame.release_date || "Unknown",
        developer: rawGame.developer || "Unknown",
        // FreeToGame gives one platform string per game (e.g. "PC (Windows)");
        // split on commas defensively in case that ever changes.
        platforms: rawGame.platform ? rawGame.platform.split(",").map((p) => p.trim()) : [],
        image: rawGame.thumbnail || "",
        featured: false,
        trending: false,
        popular: false
    };
}

function registerGames(games) {
    games.forEach((game) => state.gameCache.set(game.id, game));
}

function findGameById(id) {
    return state.gameCache.get(Number(id));
}


/* ======================================================================
   5. DOM REFERENCES
   ====================================================================== */

const dom = {
    // Navbar
    navbar: document.getElementById("navbar"),
    navLinks: document.getElementById("nav-links"),
    navBurger: document.getElementById("nav-burger"),
    searchToggle: document.getElementById("search-toggle"),

    // Hero
    heroImage: document.getElementById("hero-image"),
    heroTitle: document.getElementById("hero-title"),
    heroDescription: document.getElementById("hero-description"),
    heroGenre: document.getElementById("hero-genre"),
    heroRating: document.getElementById("hero-rating"),
    heroYear: document.getElementById("hero-year"),
    heroExploreBtn: document.getElementById("hero-explore-btn"),
    heroLibraryBtn: document.getElementById("hero-library-btn"),
    heroDots: document.getElementById("hero-dots"),

    // Game grids
    trendingGames: document.getElementById("trending-games"),
    popularGames: document.getElementById("popular-games"),
    trendingViewAll: document.getElementById("trending-view-all"),
    popularViewAll: document.getElementById("popular-view-all"),

    // Genres
    genreGrid: document.getElementById("genre-grid"),

    // Explore / search / filters
    searchInput: document.getElementById("search-input"),
    genreFilter: document.getElementById("genre-filter"),
    sortFilter: document.getElementById("sort-filter"),
    ratingFilter: document.getElementById("rating-filter"),
    yearFilter: document.getElementById("year-filter"),
    applyFiltersBtn: document.getElementById("apply-filters"),
    exploreGames: document.getElementById("explore-games"),
    exploreStatus: document.getElementById("explore-status"),
    exploreStatusText: document.getElementById("explore-status-text"),
    exploreSection: document.getElementById("explore-section"),

    // Card template
    gameCardTemplate: document.getElementById("game-card-template"),

    // Modal
    gameModal: document.getElementById("game-modal"),
    modalBackdrop: document.getElementById("modal-backdrop"),
    modalClose: document.getElementById("modal-close"),
    modalImage: document.getElementById("modal-image"),
    modalTitle: document.getElementById("modal-title"),
    modalDescription: document.getElementById("modal-description"),
    modalRating: document.getElementById("modal-rating"),
    modalReleaseDate: document.getElementById("modal-release-date"),
    modalDeveloper: document.getElementById("modal-developer"),
    modalGenres: document.getElementById("modal-genres"),
    modalPlatforms: document.getElementById("modal-platforms"),
    modalAddLibraryBtn: document.getElementById("modal-add-library-btn"),
    modalWishlistBtn: document.getElementById("modal-wishlist-btn"),

    // Library
    favoriteGames: document.getElementById("favorite-games"),
    wishlistGames: document.getElementById("wishlist-games"),
    recentGames: document.getElementById("recent-games"),
    tabFavorites: document.getElementById("tab-favorites"),
    tabWishlist: document.getElementById("tab-wishlist"),
    tabRecent: document.getElementById("tab-recent"),
    libraryEmptyHint: document.getElementById("library-empty-hint"),

    // Footer
    footerYear: document.getElementById("footer-year")
};


/* ======================================================================
   6. UTILITY FUNCTIONS
   ====================================================================== */

function loadIdListFromStorage(key) {
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn(`Could not read "${key}" from localStorage:`, err);
        return [];
    }
}

function saveIdListToStorage(key, idList) {
    try {
        localStorage.setItem(key, JSON.stringify(idList));
    } catch (err) {
        console.warn(`Could not save "${key}" to localStorage:`, err);
    }
}

// FreeToGame has no rating data — game.rating is always null. Shown as
// "N/A" so it reads as "no data" rather than "rated zero".
function formatRating(rating) {
    if (rating === null || rating === undefined) return "N/A";
    return Number(rating).toFixed(1);
}

function formatDate(dateString) {
    if (!dateString || dateString === "Unknown") return "Unknown";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
    });
}

function clearElement(element) {
    element.innerHTML = "";
}

function debounce(fn, delayMs) {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delayMs);
    };
}

// Friendly text for whatever went wrong with an API call.
function describeError(err) {
    if (err instanceof ApiError) {
        if (err.kind === "not-found") return "That couldn't be found.";
        if (err.kind === "rate-limit") return "Too many requests right now. Please try again shortly.";
        if (err.kind === "network") return "Unable to reach FreeToGame. Check your connection and try again.";
    }
    return "Unable to load games. Please try again.";
}

// Lightweight loading/error placeholders that reuse existing structure —
// just a text node inside the same grid container, no new CSS needed.
function showGridMessage(container, message) {
    clearElement(container);
    const note = document.createElement("p");
    note.textContent = message;
    container.appendChild(note);
}


/* ======================================================================
   7. GAME CARD CREATION
   ====================================================================== */

function createGameCard(game) {
    const fragment = dom.gameCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector(".game-card");

    card.dataset.gameId = game.id;
    card.dataset.genre = (game.genre || "").toLowerCase();

    // The card opens the modal on click, so it needs to be reachable and
    // operable from the keyboard too (Tab to focus, Enter/Space to
    // activate) — without this, keyboard and screen-reader users simply
    // can't open a game's details.
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `View details for ${game.title}`);

    const image = card.querySelector(".game-image");
    if (game.image) {
        image.src = game.image;
    }
    image.alt = game.title;

    const title = card.querySelector(".game-title");
    title.textContent = game.title;

    const genre = card.querySelector(".game-genre");
    genre.textContent = game.genre;

    const year = card.querySelector(".game-year");
    year.textContent = game.year || "—";

    // No rating data from FreeToGame — formatRating() renders "N/A". A
    // "★ N/A" badge on every card reads as broken, so hide the badge
    // entirely rather than show it (see .game-rating-badge.is-hidden).
    const rating = card.querySelector(".game-rating");
    rating.textContent = formatRating(game.rating);
    const ratingBadge = card.querySelector(".game-rating-badge");
    if (ratingBadge) {
        ratingBadge.classList.toggle("is-hidden", game.rating === null || game.rating === undefined);
    }

    const favoriteBtn = card.querySelector(".favorite-btn");
    favoriteBtn.dataset.gameId = game.id;
    setFavoriteButtonState(favoriteBtn, isFavorite(game.id));

    card.addEventListener("click", (event) => {
        if (event.target.closest(".favorite-btn")) return;
        openGameModal(game);
    });

    card.addEventListener("keydown", (event) => {
        if (event.target.closest(".favorite-btn")) return;
        if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
            event.preventDefault();
            openGameModal(game);
        }
    });

    favoriteBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavorite(game.id);
    });

    return card;
}


/* ======================================================================
   8. RENDERING
   ====================================================================== */

function renderGames(games, container) {
    clearElement(container);
    const fragment = document.createDocumentFragment();
    games.forEach((game) => {
        fragment.appendChild(createGameCard(game));
    });
    container.appendChild(fragment);
}

async function loadTrendingSection() {
    showGridMessage(dom.trendingGames, "Loading games...");
    try {
        const games = await fetchTrendingGames();
        renderGames(games, dom.trendingGames);
        return games;
    } catch (err) {
        showGridMessage(dom.trendingGames, describeError(err));
        return [];
    }
}

async function loadPopularSection() {
    showGridMessage(dom.popularGames, "Loading games...");
    try {
        const games = await fetchPopularGames();
        renderGames(games, dom.popularGames);
        return games;
    } catch (err) {
        showGridMessage(dom.popularGames, describeError(err));
        return [];
    }
}

async function loadGenreCounts() {
    try {
        const countsByKey = await fetchGenreCounts();
        document.querySelectorAll("[data-count-for]").forEach((el) => {
            const key = el.dataset.countFor;
            const count = countsByKey[key];
            el.textContent = count !== undefined ? `${count} titles` : "— titles";
        });
    } catch (err) {
        // Non-critical — leave the default "— titles" placeholders in place.
        console.warn("Could not load genre counts:", err);
    }
}


/* ======================================================================
   9. HERO
   ====================================================================== */

function renderHero(game) {
    if (!game) return;

    if (game.image) {
        dom.heroImage.src = game.image;
        dom.heroImage.alt = game.title;
    }
    dom.heroImage.dataset.gameId = game.id;

    dom.heroTitle.textContent = game.title;
    dom.heroDescription.textContent = game.description;
    dom.heroGenre.textContent = game.genre;
    // No rating data from FreeToGame — formatRating() renders "N/A".
    dom.heroRating.textContent = formatRating(game.rating);
    dom.heroYear.textContent = game.year || "—";

    dom.heroExploreBtn.dataset.gameId = game.id;
    dom.heroLibraryBtn.dataset.gameId = game.id;
}

const HERO_SLIDE_COUNT = 5;
const HERO_AUTO_ADVANCE_MS = 7000;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const heroState = {
    games: [],
    activeIndex: 0,
    timerId: null
};

async function loadHero(candidateGames) {
    heroState.games = candidateGames.filter((g) => g.image).slice(0, HERO_SLIDE_COUNT);
    if (heroState.games.length === 0) return;

    renderHeroDots();
    await setActiveHeroSlide(0);

    if (heroState.games.length > 1) {
        startHeroAutoAdvance();
        dom.heroImage.closest(".hero")?.addEventListener("mouseenter", stopHeroAutoAdvance);
        dom.heroImage.closest(".hero")?.addEventListener("mouseleave", startHeroAutoAdvance);
    }
}

function renderHeroDots() {
    clearElement(dom.heroDots);
    heroState.games.forEach((game, index) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "hero-dot";
        dot.setAttribute("aria-label", `Show featured game: ${game.title}`);
        dot.addEventListener("click", () => {
            setActiveHeroSlide(index);
            startHeroAutoAdvance(); // restart the timer on manual interaction
        });
        dom.heroDots.appendChild(dot);
    });
}

async function setActiveHeroSlide(index) {
    const game = heroState.games[index];
    if (!game) return;

    heroState.activeIndex = index;
    renderHero(game);

    [...dom.heroDots.children].forEach((dot, i) => {
        dot.classList.toggle("is-active", i === index);
    });

    // The list endpoint doesn't include the full description — fetch
    // full details in the background and refresh the hero if still on-screen.
    try {
        const detailed = await fetchGameDetails(game.id);
        if (heroState.activeIndex === index) {
            renderHero(detailed);
        }
    } catch (err) {
        // Hero already shows usable (if generic) info — fine to ignore.
    }
}

function startHeroAutoAdvance() {
    stopHeroAutoAdvance();
    if (prefersReducedMotion || heroState.games.length <= 1) return;

    heroState.timerId = setInterval(() => {
        const nextIndex = (heroState.activeIndex + 1) % heroState.games.length;
        setActiveHeroSlide(nextIndex);
    }, HERO_AUTO_ADVANCE_MS);
}

function stopHeroAutoAdvance() {
    if (heroState.timerId) {
        clearInterval(heroState.timerId);
        heroState.timerId = null;
    }
}


/* ======================================================================
   10. MODAL
   ====================================================================== */

function openGameModal(game) {
    if (!game) return;

    populateModal(game);
    dom.gameModal.setAttribute("aria-hidden", "false");
    addToRecentlyViewed(game.id);
    dom.modalClose.focus();

    // Enrich with full details (real description) if this game came from
    // a list endpoint rather than the detail endpoint.
    fetchGameDetails(game.id)
        .then((detailed) => {
            if (isModalOpen() && dom.modalAddLibraryBtn.dataset.gameId === String(game.id)) {
                populateModal(detailed);
            }
        })
        .catch(() => {
            // Keep showing what we already have; not worth blocking the user.
        });
}

function populateModal(game) {
    if (game.image) {
        dom.modalImage.src = game.image;
    }
    dom.modalImage.alt = game.title;
    dom.modalTitle.textContent = game.title;
    dom.modalDescription.textContent = game.description;
    // No rating data from FreeToGame — formatRating() renders "N/A".
    dom.modalRating.textContent = formatRating(game.rating);
    dom.modalReleaseDate.textContent = formatDate(game.releaseDate);
    dom.modalDeveloper.textContent = game.developer;

    clearElement(dom.modalGenres);
    (game.genres && game.genres.length ? game.genres : [game.genre]).forEach((genreName) => {
        const tag = document.createElement("span");
        tag.className = "modal-tag";
        tag.textContent = genreName;
        dom.modalGenres.appendChild(tag);
    });

    clearElement(dom.modalPlatforms);
    (game.platforms || []).forEach((platformName) => {
        const tag = document.createElement("span");
        tag.className = "modal-tag";
        tag.textContent = platformName;
        dom.modalPlatforms.appendChild(tag);
    });

    dom.modalAddLibraryBtn.dataset.gameId = game.id;
    updateAddToLibraryButton(game.id);

    dom.modalWishlistBtn.dataset.gameId = game.id;
    updateWishlistButton(game.id);
}

function closeGameModal() {
    dom.gameModal.setAttribute("aria-hidden", "true");
}

function isModalOpen() {
    return dom.gameModal.getAttribute("aria-hidden") === "false";
}


/* ======================================================================
   11. SEARCH / FILTERING / SORTING
   ----------------------------------------------------------------------
   Genre goes to the API (a real "category" param). Search has no server
   endpoint on FreeToGame, so it's applied client-side inside
   fetchExploreGames() against whatever the genre call returned. Year and
   Sort stay client-side here, applied on top of state.explore.rawResults.

   Rating filtering/sorting are effectively no-ops: FreeToGame has no
   rating data, so every game.rating is null. gameMatchesClientFilters()
   below deliberately ignores the rating filter rather than hiding every
   game — consider removing the Rating dropdown from index.html since it
   no longer does anything.
   ====================================================================== */

function gameMatchesClientFilters(game, filters) {
    // Rating filter intentionally skipped — FreeToGame has no rating data.

    if (filters.year !== "all") {
        if (filters.year === "older") {
            if (!game.year || game.year >= 2023) return false;
        } else if (String(game.year) !== filters.year) {
            return false;
        }
    }

    return true;
}

function sortGames(games, sortMode) {
    const sorted = [...games];

    switch (sortMode) {
        case "rating-desc":
        case "rating-asc":
            // No-op: FreeToGame has no rating data to sort by.
            break;
        case "release-desc":
            sorted.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));
            break;
        case "release-asc":
            sorted.sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
            break;
        case "alpha":
            sorted.sort((a, b) => a.title.localeCompare(b.title));
            break;
        case "relevance":
        default:
            // Keep the order FreeToGame returned.
            break;
    }

    return sorted;
}

// Applies year/sort to the already-fetched result set and renders. No
// network request — safe to call on every dropdown change.
function applyClientFiltersAndRender() {
    const { rating, year, sort } = state.filters;

    let results = state.explore.rawResults.filter((game) =>
        gameMatchesClientFilters(game, { rating, year })
    );
    results = sortGames(results, sort);

    if (results.length === 0) {
        clearElement(dom.exploreGames);
        dom.exploreStatusText.textContent =
            "No games matched these filters. Try adjusting your search or filters.";
        dom.exploreStatus.hidden = false;
    } else {
        dom.exploreStatus.hidden = true;
        renderGames(results, dom.exploreGames);
    }

    updateLoadMoreButton();
}

function readFiltersFromControls() {
    state.filters.search = dom.searchInput.value.trim();
    state.filters.genre = dom.genreFilter.value;
    state.filters.rating = Number(dom.ratingFilter.value);
    state.filters.year = dom.yearFilter.value;
    state.filters.sort = dom.sortFilter.value;
}

// Full pipeline: fetches games for the current genre (search is applied
// client-side inside fetchExploreGames), replaces the Explore result
// set, then applies year/sort and renders.
async function refreshExplore() {
    readFiltersFromControls();

    state.explore.loading = true;
    dom.exploreStatus.hidden = true;
    showGridMessage(dom.exploreGames, "Loading games...");

    try {
        const { games, nextPageUrl } = await fetchExploreGames({
            search: state.filters.search,
            genreKey: state.filters.genre
        });
        state.explore.rawResults = games;
        state.explore.nextPageUrl = nextPageUrl;
        applyClientFiltersAndRender();
    } catch (err) {
        state.explore.rawResults = [];
        state.explore.nextPageUrl = null;
        clearElement(dom.exploreGames);
        dom.exploreStatusText.textContent = describeError(err);
        dom.exploreStatus.hidden = false;
        updateLoadMoreButton();
    } finally {
        state.explore.loading = false;
    }
}

// FreeToGame has no pagination — every /games call already returns the
// full result set, so there's never a next page to load. Kept as a
// no-op (rather than deleted) so the "Load More" button code below
// doesn't need to change.
async function loadMoreExploreResults() {
    return;
}


/* ======================================================================
   "Load More" button — created in JS only (no HTML/CSS file changes),
   using the same button classes already used elsewhere on the page.
   Stays hidden permanently since state.explore.nextPageUrl is always
   null with FreeToGame (no pagination).
   ====================================================================== */

let loadMoreBtn = null;

function ensureLoadMoreButton() {
    if (loadMoreBtn) return loadMoreBtn;

    loadMoreBtn = document.createElement("button");
    loadMoreBtn.type = "button";
    loadMoreBtn.id = "load-more-games";
    loadMoreBtn.className = "btn btn-outline";
    loadMoreBtn.textContent = "Load More";
    loadMoreBtn.hidden = true;
    loadMoreBtn.addEventListener("click", loadMoreExploreResults);

    dom.exploreStatus.insertAdjacentElement("afterend", loadMoreBtn);
    return loadMoreBtn;
}

function updateLoadMoreButton() {
    const btn = ensureLoadMoreButton();
    btn.hidden = !state.explore.nextPageUrl;
}

function setLoadMoreButtonState(mode) {
    if (!loadMoreBtn) return;
    loadMoreBtn.disabled = mode === "loading";
    loadMoreBtn.textContent = mode === "loading" ? "Loading..." : "Load More";
}


/* ======================================================================
   12. FAVORITES
   ====================================================================== */

function isFavorite(gameId) {
    return state.favoriteIds.includes(Number(gameId));
}

function setFavoriteButtonState(button, active) {
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? "Remove from favorites" : "Add to favorites");
}

function toggleFavorite(gameId) {
    const id = Number(gameId);

    if (isFavorite(id)) {
        state.favoriteIds = state.favoriteIds.filter((favId) => favId !== id);
    } else {
        state.favoriteIds.push(id);
    }

    saveIdListToStorage(STORAGE_KEYS.favorites, state.favoriteIds);

    document.querySelectorAll(`.favorite-btn[data-game-id="${id}"]`).forEach((btn) => {
        setFavoriteButtonState(btn, isFavorite(id));
    });

    if (dom.modalAddLibraryBtn.dataset.gameId === String(id)) {
        updateAddToLibraryButton(id);
    }

    renderFavoritesLibrary();
}

// Looks games up in the cache; fetches any that aren't cached yet
// (e.g. a favorite from a previous session we haven't re-fetched).
async function resolveGamesByIds(ids) {
    const resolved = [];
    const missing = [];

    ids.forEach((id) => {
        const cached = findGameById(id);
        if (cached) {
            resolved.push(cached);
        } else {
            missing.push(id);
        }
    });

    if (missing.length > 0) {
        const fetched = await Promise.all(
            missing.map((id) => fetchGameDetails(id).catch(() => null))
        );
        fetched.forEach((game) => {
            if (game) resolved.push(game);
        });
    }

    // Preserve original id order (e.g. newest-first for recently viewed).
    return ids
        .map((id) => resolved.find((game) => game.id === id))
        .filter(Boolean);
}

async function renderFavoritesLibrary() {
    const favoriteGames = await resolveGamesByIds(state.favoriteIds);
    renderGames(favoriteGames, dom.favoriteGames);
    updateLibraryEmptyHint();
}


/* ======================================================================
   13. RECENTLY VIEWED
   ====================================================================== */

const RECENT_LIMIT = 10;

function addToRecentlyViewed(gameId) {
    const id = Number(gameId);

    state.recentIds = state.recentIds.filter((recentId) => recentId !== id);
    state.recentIds.unshift(id);
    state.recentIds = state.recentIds.slice(0, RECENT_LIMIT);

    saveIdListToStorage(STORAGE_KEYS.recent, state.recentIds);
    renderRecentLibrary();
}

async function renderRecentLibrary() {
    const recentGamesList = await resolveGamesByIds(state.recentIds);
    renderGames(recentGamesList, dom.recentGames);
    updateLibraryEmptyHint();
}


/* ======================================================================
   WISHLIST (storage ready now; UI wiring arrives next phase)
   ====================================================================== */

function isWishlisted(gameId) {
    return state.wishlistIds.includes(Number(gameId));
}

function toggleWishlist(gameId) {
    const id = Number(gameId);

    if (isWishlisted(id)) {
        state.wishlistIds = state.wishlistIds.filter((wishId) => wishId !== id);
    } else {
        state.wishlistIds.push(id);
    }

    saveIdListToStorage(STORAGE_KEYS.wishlist, state.wishlistIds);

    if (dom.modalWishlistBtn.dataset.gameId === String(id)) {
        updateWishlistButton(id);
    }

    renderWishlistLibrary();
}

async function renderWishlistLibrary() {
    const wishlistGamesList = await resolveGamesByIds(state.wishlistIds);
    renderGames(wishlistGamesList, dom.wishlistGames);
    updateLibraryEmptyHint();
}

function updateAddToLibraryButton(gameId) {
    const active = isFavorite(gameId);
    dom.modalAddLibraryBtn.textContent = active ? "In Library ✓" : "Add to Library";
}

function updateWishlistButton(gameId) {
    const active = isWishlisted(gameId);
    dom.modalWishlistBtn.classList.toggle("is-active", active);
    dom.modalWishlistBtn.textContent = active ? "Saved ✓" : "Save for Later";
}


/* ======================================================================
   14. LIBRARY TABS
   ====================================================================== */

const libraryTabs = [
    { tabButton: dom.tabFavorites, panel: dom.favoriteGames },
    { tabButton: dom.tabWishlist, panel: dom.wishlistGames },
    { tabButton: dom.tabRecent, panel: dom.recentGames }
];

function activateLibraryTab(targetPanelId) {
    libraryTabs.forEach(({ tabButton, panel }) => {
        const isTarget = panel.id === targetPanelId;
        tabButton.classList.toggle("is-active", isTarget);
        panel.hidden = !isTarget;
    });
    updateLibraryEmptyHint();
}

function updateLibraryEmptyHint() {
    const activePanel = libraryTabs.find(({ panel }) => !panel.hidden)?.panel;
    if (!activePanel || !dom.libraryEmptyHint) return;
    dom.libraryEmptyHint.hidden = activePanel.children.length > 0;
}


/* ======================================================================
   15. GENRE NAVIGATION
   ====================================================================== */

function goToGenre(genreKey) {
    dom.genreFilter.value = genreKey;
    refreshExplore();
    dom.exploreSection.scrollIntoView({ behavior: "smooth" });
}


/* ======================================================================
   NAVBAR — smooth-scroll links, active-section highlighting, mobile menu
   ====================================================================== */

const navSectionMap = [
    { link: document.getElementById("nav-home"), section: document.getElementById("hero-section") },
    { link: document.getElementById("nav-explore"), section: dom.exploreSection },
    { link: document.getElementById("nav-genres"), section: document.getElementById("genres-section") },
    { link: document.getElementById("nav-trending"), section: document.getElementById("trending-section") },
    { link: document.getElementById("nav-library"), section: document.getElementById("library-section") }
].filter((entry) => entry.link && entry.section);

function setupNavbar() {
    navSectionMap.forEach(({ link, section }) => {
        link.addEventListener("click", () => {
            section.scrollIntoView({ behavior: "smooth" });
            closeMobileNav();
        });
    });

    if (dom.navBurger) {
        dom.navBurger.addEventListener("click", () => {
            const isOpen = dom.navLinks.classList.toggle("is-open");
            dom.navBurger.classList.toggle("is-open", isOpen);
            dom.navBurger.setAttribute("aria-expanded", String(isOpen));
        });
    }

    if (dom.searchToggle) {
        dom.searchToggle.addEventListener("click", () => {
            dom.exploreSection.scrollIntoView({ behavior: "smooth" });
            dom.searchInput.focus();
        });
    }

    if ("IntersectionObserver" in window && navSectionMap.length) {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    const match = navSectionMap.find(({ section }) => section === entry.target);
                    if (!match) return;
                    navSectionMap.forEach(({ link }) => link.classList.remove("is-active"));
                    match.link.classList.add("is-active");
                });
            },
            { rootMargin: "-45% 0px -50% 0px" }
        );
        navSectionMap.forEach(({ section }) => observer.observe(section));
    }
}

function closeMobileNav() {
    dom.navLinks.classList.remove("is-open");
    dom.navBurger?.classList.remove("is-open");
    dom.navBurger?.setAttribute("aria-expanded", "false");
}

function setupViewAllButtons() {
    dom.trendingViewAll?.addEventListener("click", () => goToGenre("all"));
    dom.popularViewAll?.addEventListener("click", () => goToGenre("all"));
}

function setupFooter() {
    if (dom.footerYear) {
        dom.footerYear.textContent = new Date().getFullYear();
    }
}


/* ======================================================================
   16. EVENT LISTENERS
   ====================================================================== */

function setupEventListeners() {
    setupNavbar();
    setupViewAllButtons();
    setupFooter();

    // Modal close interactions
    dom.modalClose.addEventListener("click", closeGameModal);
    dom.modalBackdrop.addEventListener("click", closeGameModal);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && isModalOpen()) {
            closeGameModal();
        }
    });

    // Modal "Add to Library" button
    dom.modalAddLibraryBtn.addEventListener("click", () => {
        const gameId = dom.modalAddLibraryBtn.dataset.gameId;
        if (!gameId) return;
        toggleFavorite(gameId);
    });

    // Modal "Save for Later" (wishlist) button
    dom.modalWishlistBtn.addEventListener("click", () => {
        const gameId = dom.modalWishlistBtn.dataset.gameId;
        if (!gameId) return;
        toggleWishlist(gameId);
    });

    // Hero buttons
    dom.heroExploreBtn.addEventListener("click", () => {
        const game = findGameById(dom.heroExploreBtn.dataset.gameId);
        if (game) openGameModal(game);
    });
    dom.heroLibraryBtn.addEventListener("click", () => {
        const gameId = dom.heroLibraryBtn.dataset.gameId;
        if (gameId) toggleFavorite(gameId);
    });

    // Search — debounced as-you-type, plus instant on Enter.
    const debouncedSearch = debounce(refreshExplore, 500);
    dom.searchInput.addEventListener("input", debouncedSearch);
    dom.searchInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            refreshExplore();
        }
    });

    // Genre needs a fresh API call (new catalog slice).
    dom.genreFilter.addEventListener("change", refreshExplore);

    // Year/Sort are purely client-side — no network request. (Rating is
    // wired the same way for consistency, but is a no-op — see Section 11.)
    [dom.ratingFilter, dom.yearFilter, dom.sortFilter].forEach((select) => {
        select.addEventListener("change", applyClientFiltersAndRender);
    });

    // Apply button re-runs the full pipeline (covers search + genre + rest).
    dom.applyFiltersBtn.addEventListener("click", refreshExplore);

    // Genre cards
    dom.genreGrid.addEventListener("click", (event) => {
        const genreCard = event.target.closest("[data-genre]");
        if (!genreCard) return;
        goToGenre(genreCard.dataset.genre);
    });

    // Library tabs
    dom.tabFavorites.addEventListener("click", () => activateLibraryTab("favorite-games"));
    dom.tabWishlist.addEventListener("click", () => activateLibraryTab("wishlist-games"));
    dom.tabRecent.addEventListener("click", () => activateLibraryTab("recent-games"));
}


/* ======================================================================
   17. INITIALIZATION
   ====================================================================== */

async function init() {
    setupEventListeners();
    ensureLoadMoreButton();

    // Trending/Popular load in parallel; each fails independently so one
    // broken request doesn't take down the other section.
    const [trendingGames, popularGames] = await Promise.all([
        loadTrendingSection(),
        loadPopularSection()
    ]);

    const heroCandidates = [...trendingGames, ...popularGames].filter(
        (game, index, all) => all.findIndex((g) => g.id === game.id) === index
    );
    loadHero(heroCandidates);
    loadGenreCounts();

    await refreshExplore();

    await Promise.all([
        renderFavoritesLibrary(),
        renderWishlistLibrary(),
        renderRecentLibrary()
    ]);
    activateLibraryTab("favorite-games");
}

document.addEventListener("DOMContentLoaded", init);
