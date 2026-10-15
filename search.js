"use strict";

/* =====================================================================
   Work Package Search
   ===================================================================== */

/* ---------- Configuration ---------- */

const RESULTS_PER_PAGE = 50;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_WORD_LENGTH = 2;
const SHORT_WORD_MAX = 3;        // words this short must match at the START of a word ("ai" must not match "maintain")
const TOP_BOARD_PILLS = 10;
const MAX_TEXT_CHARS = 300;
const HEAD_CHARS = 140;           // cards show only the start of the description
const MAX_TAGS_SHOWN = 2;        // Disease Area / Product tags per card (matching ones may exceed this)
const MAX_HIT_TAGS_SHOWN = 4;
const FUZZY_THRESHOLD = 0.3;
const FALLBACK_SCORE = 0.25;     // score used for exact matches Fuse did not return

const OTHER_REGION = "Other";
const OTHER_BOARDS = "Other Affiliate(s)";

// Order = display order and tie-break priority for "matched in" labels.
const FIELDS = [
    { key: "itemName",     label: "WORK PACKAGE", short: "Work package",  weight: 0.40 },
    { key: "subitems",     label: "SUBITEM", short: "Subitem",       weight: 0.15 },
    { key: "description",  label: "DESCRIPTION", short: "Description",   weight: 0.15 },
    { key: "learnings",    label: "LEARNINGS", short: "Learnings",     weight: 0.10 },
    { key: "realizedHWWK", label: "REALIZED HWWK", short: "Realized HWWK", weight: 0.10 },
    { key: "diseaseArea",  label: "DISEASE AREA", short: "Disease area",  weight: 0.05 },
    { key: "product",      label: "PRODUCT", short: "Product",       weight: 0.05 }
];

const ALL_FIELD_KEYS = FIELDS.map(field => field.key);

const REGION_MAP = {

    Africa: [
        "Africa BC DAN",
        "Central Africa (Congo)",
        "East Africa (Kenya)",
        "Francophone West-Africa and Lusophone Africa (Cote d'Ivoire)",
        "Ghana",
        "Nigeria",
        "South Africa"
    ],

    APAC: [
        "Australia",
        "DAN Oncology",
        "FP Squad",
        "Hong Kong",
        "Indonesia",
        "Malaysia",
        "New Zealand",
        "Philippines",
        "Singapore",
        "South Korea",
        "Taiwan",
        "Thailand",
        "Vietnam"
    ],

    CEETRIS: [
        "Albania",
        "Bangladesh",
        "Belarus",
        "Bosnia-Herzegovina",
        "Georgia and Azerbaijan",
        "India",
        "Kazakhstan & Central Asia",
        "Macedonia & Kosovo",
        "Pakistan",
        "Russia",
        "Serbia & Montenegro",
        "Türkiye",
        "Turkmenistan",
        "Ukraine and Moldova",
        "CEETRIS ET",
        "CEETRIS DAN"
    ],

    Europe: [
        "Europe Area",
        "Austria",
        "Baltics",
        "BELUX",
        "Bulgaria",
        "Croatia",
        "Czech Republic",
        "Denmark and Iceland",
        "Estonia",
        "Finland",
        "Greece",
        "Hungary",
        "Ireland",
        "Israel",
        "Latvia",
        "Lithuania",
        "Netherlands",
        "Norway",
        "Poland",
        "Portugal",
        "Romania",
        "Slovakia",
        "Slovenia",
        "Sweden",
        "Switzerland"
    ],

    LATAM: [
        "Argentina",
        "CCAV",
        "Chile",
        "Colombia",
        "Ecuador",
        "Mexico",
        "Peru & Bolivia",
        "Uruguay & Paraguay",
        "Latam DA",
        "Latam Enabling Pillars"
    ],

    i8: [
        "Brazil",
        "Canada",
        "China",
        "FR",
        "Germany",
        "Italy",
        "Spain",
        "UK",
        "i8"
    ],

    CLT: ["CLT"],

    IPS: ["IPS"],

    Archive: ["Archive"]
};

const REGION_LABELS = {
    Africa: "🌍 Africa",
    APAC: "🌏 APAC",
    CEETRIS: "🌐 CEETRIS",
    Europe: "🌍 Europe",
    LATAM: "🌎 LATAM",
    i8: "🚀 i8",
    CLT: "🏢 CLT",
    IPS: "🔬 IPS",
    Archive: "📦 Archive",
    [OTHER_REGION]: "❓ Other"
};

/* ---------- State ---------- */

let allData = [];
let dataLoaded = false;
let currentPage = 1;
let currentSearchResults = [];   // what "Export Results" exports (after board filter)
let activeBoardFilter = null;
let activeTagFilter = null;      // { type: "diseaseArea" | "product", value }

const fuseCache = new Map();     // one Fuse index per distinct set of searched fields
const termRegexCache = new Map();
let searchCache = { key: null };

/* ---------- Small helpers ---------- */

function $(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSafeUrl(url) {
    return typeof url === "string" && /^https:\/\//i.test(url);
}

/* ---------- Region handling ---------- */

function getRegionForBoard(boardName) {

    // 1) exact match on the [Tag] at the start of the board name
    const tagMatch = boardName.match(/^\s*\[([^\]]+)\]/);
    const tag = tagMatch ? tagMatch[1].trim() : null;

    if (tag) {
        for (const [region, boards] of Object.entries(REGION_MAP)) {
            if (boards.includes(tag)) return region;
        }
    }

    // 2) fall back to "name contains entry"
    for (const [region, boards] of Object.entries(REGION_MAP)) {
        if (boards.some(board => boardName.includes(board))) return region;
    }

    return OTHER_REGION;
}

function prepareItem(item) {

    item.subitems = Array.isArray(item.subitems) ? item.subitems : [];
    item.boardName = item.boardName || "";

    item._region = getRegionForBoard(item.boardName);

    // lower-cased text per field, computed once
    item._lc = {};

    FIELDS.forEach(field => {

        const raw = field.key === "subitems"
            ? item.subitems.join("\n")
            : (item[field.key] || "");

        item._lc[field.key] = String(raw).toLowerCase();

    });

    return item;
}

/* ---------- Query parsing and matching ---------- */

// Plain words: lower-cased, edge punctuation stripped ("(oncology)," -> "oncology")
function parseWords(text) {

    const seen = new Set();

    return text
        .toLowerCase()
        .split(/\s+/)
        .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
        .filter(word => {
            if (word.length < MIN_WORD_LENGTH || seen.has(word)) return false;
            seen.add(word);
            return true;
        });
}

// A query is a list of terms:
//   "exact phrase"  -> { text: "exact phrase", phrase: true }  (must appear exactly, whole words)
//   other words     -> { text: "word",         phrase: false } (all must appear somewhere)
function parseQuery(query) {

    const phrases = [];

    const remainder = query.replace(/["“”]([^"“”]+)["“”]/g, (match, phrase) => {

        const clean = phrase.toLowerCase().replace(/\s+/g, " ").trim();

        if (clean.length >= MIN_WORD_LENGTH) phrases.push(clean);

        return " ";
    });

    const candidates = [
        ...phrases.map(text => ({ text, phrase: true })),
        ...parseWords(remainder).map(text => ({ text, phrase: false }))
    ];

    const seen = new Set();

    return candidates.filter(term => {
        const key = termKey(term);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function termKey(term) {
    return term.phrase ? `"${term.text}"` : term.text;
}

// Regex source for one term (also used for highlighting)
function termPattern(term) {

    if (term.phrase) {

        const body = term.text.split(" ").map(escapeRegExp).join("\\s+");

        return `(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`;
    }

    const body = escapeRegExp(term.text);

    // very short words must start a word ("ai" must not match "maintain")
    return term.text.length <= SHORT_WORD_MAX
        ? `(?<![\\p{L}\\p{N}])${body}`
        : body;
}

function textHasTerm(lowerCaseText, term) {

    if (!lowerCaseText) return false;

    if (!term.phrase && term.text.length > SHORT_WORD_MAX) {
        return lowerCaseText.includes(term.text);
    }

    const key = termKey(term);

    if (!termRegexCache.has(key)) {
        termRegexCache.set(key, new RegExp(termPattern(term), "u"));
    }

    return termRegexCache.get(key).test(lowerCaseText);
}

// every term must appear somewhere in the given fields
function itemMatchesAll(item, fields, terms) {

    return terms.every(term =>
        fields.some(field => textHasTerm(item._lc[field], term))
    );
}

function matchedFieldLabels(item, fields, terms, nameType = "label") {

    return FIELDS
        .filter(field => fields.includes(field.key))
        .filter(field =>
            terms.some(term => textHasTerm(item._lc[field.key], term))
        )
        .map(field => field[nameType]);
}

/* ---------- Fuzzy search (Fuse) ---------- */

function getFuse(fields) {

    const cacheKey = [...fields].sort().join("|");

    if (!fuseCache.has(cacheKey)) {

        fuseCache.set(
            cacheKey,
            new Fuse(allData, {
                includeScore: true,
                threshold: FUZZY_THRESHOLD,
                ignoreLocation: true,       // search the WHOLE text, not just the first ~100 chars
                minMatchCharLength: MIN_WORD_LENGTH,
                keys: FIELDS
                    .filter(field => fields.includes(field.key))
                    .map(field => ({ name: field.key, weight: field.weight }))
            })
        );
    }

    return fuseCache.get(cacheKey);
}

// Map(itemId -> average score) for items where EVERY word fuzzy-matches somewhere
function fuzzyScores(words, fields) {

    const fuse = getFuse(fields);
    let combined = null;

    for (const word of words) {

        const wordScores = new Map();

        fuse.search(word).forEach(result => {
            wordScores.set(result.item.itemId, result.score ?? 0);
        });

        if (!combined) {
            combined = wordScores;
        } else {
            for (const [id, score] of combined) {
                if (wordScores.has(id)) {
                    combined.set(id, score + wordScores.get(id));
                } else {
                    combined.delete(id);
                }
            }
        }

        if (combined.size === 0) break;
    }

    combined = combined || new Map();

    for (const [id, score] of combined) {
        combined.set(id, score / words.length);
    }

    return combined;
}

// Set of itemIds where at least one word fuzzy-matches inside the given fields
function fuzzyHitIds(words, fields) {

    const fuse = getFuse(fields);
    const ids = new Set();

    words.forEach(word => {
        fuse.search(word).forEach(result => ids.add(result.item.itemId));
    });

    return ids;
}

/* ---------- Text rendering helpers (all output is HTML-escaped) ---------- */

function buildHighlightRegex(terms) {

    if (!terms.length) return null;

    const alternatives = [...terms]
        .sort((a, b) => b.text.length - a.text.length)
        .map(termPattern);

    return new RegExp(`(${alternatives.join("|")})`, "giu");
}

function highlight(text, regex) {

    const value = String(text ?? "");

    if (!regex) return escapeHtml(value);

    // split() with a capture group puts matches at odd indexes
    return value
        .split(regex)
        .map((part, index) =>
            index % 2 === 1
                ? `<mark>${escapeHtml(part)}</mark>`
                : escapeHtml(part)
        )
        .join("");
}

// Shortens long text but keeps the first match visible
function excerpt(text, terms, max = MAX_TEXT_CHARS) {

    if (!text || text.length <= max) return text || "";

    const lower = text.toLowerCase();
    let firstMatch = -1;

    terms.forEach(term => {
        const index = lower.search(new RegExp(termPattern(term), "u"));
        if (index !== -1 && (firstMatch === -1 || index < firstMatch)) {
            firstMatch = index;
        }
    });

    if (firstMatch === -1 || firstMatch < max - 80) {
        return text.slice(0, max) + "…";
    }

    const start = Math.max(0, firstMatch - 80);
    const end = start + max;

    return "…" + text.slice(start, end) + (end < text.length ? "…" : "");
}

/* ---------- Loading ---------- */

fetch("data.json", { cache: "no-cache" })
    .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    })
    .then(data => {

        allData = (data.items || []).map(prepareItem);
        dataLoaded = true;

        const unassigned = new Set(
            allData
                .filter(item => item._region === OTHER_REGION)
                .map(item => item.boardName)
        );

        if (unassigned.size) {
            console.warn("Boards not mapped to any region:", [...unassigned]);
        }

        updateStats(data);
        buildRegionFilter(unassigned.size > 0);

        let searchTimeout;

        $("searchInput").addEventListener("input", () => {

            clearTimeout(searchTimeout);

            searchTimeout = setTimeout(() => {
                currentPage = 1;
                runSearch();
            }, SEARCH_DEBOUNCE_MS);

        });

        $("results").addEventListener("click", handleResultsClick);

    })
    .catch(error => {

        console.error(error);

        $("stats").textContent = "Error loading workspace data";

    });

function updateStats(data) {

    const generated = new Date(data.generatedAt);

    const failed = Array.isArray(data.failedBoards) ? data.failedBoards : [];

    $("stats").innerHTML = `
        <strong>${escapeHtml(data.boards)}</strong> Boards Indexed |
        <strong>${allData.length.toLocaleString()}</strong> Work Packages Indexed
        <br>
        Last Updated: ${escapeHtml(generated.toLocaleString())}
        <br>
        <small>
            Search results are refreshed daily from WBO Tech Suite.
        </small>
        ${failed.length ? `
        <br>
        <small>⚠️ ${failed.length} board(s) could not be refreshed in the last run; older data is shown for them.</small>
        ` : ""}
    `;
}

/* ---------- Filters ---------- */

function buildRegionFilter(includeOther) {

    const regions = Object.keys(REGION_MAP);

    if (includeOther) regions.push(OTHER_REGION);

    $("boardList").innerHTML = regions
        .map(region => `
            <label class="board-option">
                <input
                    type="checkbox"
                    class="region-checkbox"
                    value="${escapeHtml(region)}"
                    checked
                >
                ${escapeHtml(REGION_LABELS[region] || region)}
            </label>
        `)
        .join("");
}

function getSelectedRegions() {

    return [...document.querySelectorAll(".region-checkbox:checked")]
        .map(box => box.value);
}

function getSelectedSearchFields() {

    return [...document.querySelectorAll(".search-field:checked")]
        .map(box => box.value);
}

/* ---------- Search ---------- */

function showMessage(message) {

    $("resultCount").textContent = message;
    $("results").innerHTML = "";
    currentSearchResults = [];
}

function runSearch() {

    if (!dataLoaded) return;

    const query = $("searchInput").value.trim();

    if (!query) {
        $("resultCount").innerHTML = "";
        $("results").innerHTML = "";
        currentSearchResults = [];
        return;
    }

    const terms = parseQuery(query);

    if (!terms.length) {
        showMessage(`Please enter at least ${MIN_WORD_LENGTH} characters.`);
        return;
    }

    const fields = getSelectedSearchFields();

    if (!fields.length) {
        showMessage("Select at least one field to search in.");
        return;
    }

    const regions = new Set(getSelectedRegions());
    const similarBox = $("showSimilarMatches");
    const similar = Boolean(similarBox && similarBox.checked);

    // plain words (phrases split up) used for fuzzy ranking and similar matches
    const words = parseWords(terms.map(term => term.text).join(" "));

    // The heavy work is cached so paging / sorting / board pills re-render instantly.
    const key = [
        terms.map(termKey).join(" "),
        fields.join(","),
        [...regions].sort().join(","),
        similar
    ].join("␟");

    if (searchCache.key !== key) {
        searchCache = {
            key,
            terms,
            fields,
            results: computeResults(terms, words, fields, regions, similar)
        };
    }

    renderPage();
}

function computeResults(terms, words, fields, regions, similar) {

    // Scores always come from ALL fields, so the ranking (and the % shown)
    // does not change when a "Search In" box is ticked or unticked -
    // results only appear or disappear, they never jump to another page.
    const scores = fuzzyScores(words, ALL_FIELD_KEYS);

    // Only needed for similar matches: which items fuzzy-match in a ticked field
    const similarHits = similar ? fuzzyHitIds(words, fields) : null;

    const results = [];

    for (const item of allData) {

        if (!regions.has(item._region)) continue;

        // A work package qualifies when every term appears somewhere in the item
        // (any field), and it is shown as long as at least one of the fields
        // ticked in "Search In" contains one of the terms.
        const exact =
            itemMatchesAll(item, ALL_FIELD_KEYS, terms) &&
            fields.some(field =>
                terms.some(term => textHasTerm(item._lc[field], term))
            );

        const scored = scores.has(item.itemId);

        if (!exact && !(similar && scored && similarHits.has(item.itemId))) continue;

        results.push({
            item,
            exact,
            score: scored ? scores.get(item.itemId) : FALLBACK_SCORE
        });
    }

    results.sort((a, b) =>
        (b.exact - a.exact) ||
        (a.score - b.score) ||
        a.item.itemName.localeCompare(b.item.itemName)
    );

    return results;
}

// "relevance" keeps the computed order; the other modes re-sort a copy
function sortResults(results) {

    const select = $("sortSelect");
    const mode = select ? select.value : "relevance";

    if (mode === "relevance") return results;

    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    const byName = (a, b) => collator.compare(a.item.itemName, b.item.itemName);
    const byBoard = (a, b) => collator.compare(a.item.boardName, b.item.boardName);

    const sorted = [...results];

    if (mode === "name-asc") sorted.sort(byName);
    else if (mode === "name-desc") sorted.sort((a, b) => byName(b, a));
    else if (mode === "board-asc") sorted.sort((a, b) => byBoard(a, b) || byName(a, b));

    return sorted;
}

function renderPage() {

    const { terms, fields } = searchCache;

    // the tag filter (click a Disease Area / Product tag) applies before the board pills are counted
    const results = activeTagFilter
        ? searchCache.results.filter(result =>
              splitValues(result.item[activeTagFilter.type]).includes(activeTagFilter.value))
        : searchCache.results;

    // Board facets are built from the results BEFORE the board filter,
    // so the pills stay visible while a board is selected.
    const counts = new Map();

    results.forEach(result => {
        const board = result.item.boardName;
        counts.set(board, (counts.get(board) || 0) + 1);
    });

    const sortedBoards = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const topBoards = sortedBoards.slice(0, TOP_BOARD_PILLS);
    const otherBoards = sortedBoards.slice(TOP_BOARD_PILLS);
    const topNames = new Set(topBoards.map(([board]) => board));

    let visible = results;

    if (activeBoardFilter === OTHER_BOARDS) {
        visible = results.filter(r => !topNames.has(r.item.boardName));
    } else if (activeBoardFilter) {
        visible = results.filter(r => r.item.boardName === activeBoardFilter);
    }

    visible = sortResults(visible);

    currentSearchResults = visible;   // "Export Results" uses this (same order as on screen)

    const totalPages = Math.max(1, Math.ceil(visible.length / RESULTS_PER_PAGE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);

    const startIndex = (currentPage - 1) * RESULTS_PER_PAGE;
    const pageResults = visible.slice(startIndex, startIndex + RESULTS_PER_PAGE);

    const boardCount = new Set(visible.map(r => r.item.boardName)).size;

    $("resultCount").innerHTML = `
        ${visible.length.toLocaleString()} matching work package(s) found across ${boardCount} affiliate(s)
        <div class="page-range">
            ${visible.length
                ? `Showing ${(startIndex + 1).toLocaleString()}-${(startIndex + pageResults.length).toLocaleString()} of ${visible.length.toLocaleString()}`
                : ""}
        </div>
    `;

    const regex = buildHighlightRegex(terms);
    const pager = paginationHtml(totalPages);

    const html = [];

    if (activeBoardFilter) {
        html.push(`
            <div class="active-filter">
                Active Board Filter:
                <span class="active-filter-pill" data-clear-board="1">
                    ${escapeHtml(activeBoardFilter)} ✕
                </span>
            </div>
        `);
    }

    if (activeTagFilter) {
        html.push(`
            <div class="active-filter">
                Active ${activeTagFilter.type === "product" ? "Product" : "Disease Area"} Filter:
                <span class="active-filter-pill" data-clear-tag="1">
                    ${escapeHtml(activeTagFilter.value)} ✕
                </span>
            </div>
        `);
    }

    html.push(boardSummaryHtml(topBoards, otherBoards));
    html.push(pager);

    html.push(
        `<div class="results-grid">` +
        pageResults.map(result => cardHtml(result, terms, fields, regex)).join("") +
        `</div>`
    );

    html.push(pager);

    $("results").innerHTML = html.join("");
}

function shortBoardName(board) {

    return board
        .replace(" Work Package Overview", "")
        .replace(" WP Portfolio Overview", "")
        .replace(" Work Packages Overview", "");
}

function boardSummaryHtml(topBoards, otherBoards) {

    const pills = topBoards.map(([board, count]) => {

        const shortName = shortBoardName(board);

        return `
            <span class="board-summary-pill" data-board="${escapeHtml(board)}">
                ${escapeHtml(shortName)} (${count})
            </span>
        `;
    });

    if (otherBoards.length && activeBoardFilter !== OTHER_BOARDS) {

        const otherCount = otherBoards.reduce((sum, [, count]) => sum + count, 0);

        pills.push(`
            <span class="board-summary-pill" data-other-boards="1">
                Other Affiliates (${otherCount})
            </span>
        `);
    }

    return `<div class="board-summary">${pills.join("")}</div>`;
}

function paginationHtml(totalPages) {

    if (totalPages <= 1) return "";

    const pages = new Set([1, totalPages]);

    for (let i = currentPage - 2; i <= currentPage + 2; i++) {
        if (i >= 1 && i <= totalPages) pages.add(i);
    }

    let html = `
        <div class="pagination">
            <button data-page="${currentPage - 1}" ${currentPage === 1 ? "disabled" : ""}>
                ◀ Previous
            </button>
    `;

    let previous = 0;

    [...pages].sort((a, b) => a - b).forEach(page => {

        if (page - previous > 1) {
            html += `<button disabled>…</button>`;
        }

        html += `
            <button
                data-page="${page}"
                class="${page === currentPage ? "active-page" : ""}"
            >${page}</button>
        `;

        previous = page;
    });

    html += `
            <button data-page="${currentPage + 1}" ${currentPage === totalPages ? "disabled" : ""}>
                Next ▶
            </button>
        </div>
    `;

    return html;
}

/* ----- result cards ----- */

// "A | B | C" -> ["A", "B", "C"] (no empty values, no duplicates)
function splitValues(text) {

    return [...new Set(
        String(text || "").split("|").map(value => value.trim()).filter(Boolean)
    )];
}

// "[Singapore] Work Package Overview" -> "[Singapore]"
function boardTag(board) {

    const match = board.match(/^\s*(\[[^\]]+\])/);

    return match ? match[1] : shortBoardName(board);
}

function regionClass(region) {

    return "wp-region--" + region.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Only the beginning of the text, cut at a word boundary
function headText(text, max = HEAD_CHARS) {

    const value = String(text || "").replace(/\s+/g, " ").trim();

    if (value.length <= max) return value;

    const cut = value.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");

    return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.\-–]+$/, "") + "…";
}

function termsHit(lowerCaseText, terms) {

    return terms.some(term => textHasTerm(lowerCaseText, term));
}

// Disease Area / Product tags. Tags that match the search are blue and shown first.
// Clicking a tag filters the results by it.
function tagGroupHtml(type, text, icon, fields, terms) {

    const values = splitValues(text);

    if (!values.length) return "";

    const checkMatches = fields.includes(type);
    const isHit = value => checkMatches && termsHit(value.toLowerCase(), terms);

    const hits = values.filter(isHit);
    const ordered = [...hits, ...values.filter(value => !isHit(value))];

    const limit = Math.max(MAX_TAGS_SHOWN, Math.min(hits.length, MAX_HIT_TAGS_SHOWN));
    const shown = ordered.slice(0, limit);
    const hidden = ordered.slice(limit);

    const pills = shown.map(value => {

        const classes = [
            "wp-tag",
            `wp-tag--${type}`,
            hits.includes(value) ? "wp-tag--hit" : "",
            activeTagFilter && activeTagFilter.type === type && activeTagFilter.value === value
                ? "wp-tag--active" : ""
        ].filter(Boolean).join(" ");

        return `<button type="button" class="${classes}" data-tag-type="${type}" ` +
               `data-tag-value="${escapeHtml(value)}" title="Filter by ${escapeHtml(value)}">` +
               `${icon ? icon + " " : ""}${escapeHtml(value)}</button>`;
    });

    if (hidden.length) {
        pills.push(
            `<span class="wp-tag wp-tag--more${hidden.some(isHit) ? " wp-tag--hit" : ""}" ` +
            `title="${escapeHtml(hidden.join(", "))}">+${hidden.length}</span>`
        );
    }

    return pills.join("");
}

// "16 subitems", or "3 of 16 subitems" (blue) when the search matches some of them
function subitemTagHtml(item, terms, fields) {

    const total = item.subitems.length;

    if (!total) return "";

    const matching = fields.includes("subitems")
        ? item.subitems.filter(subitem => termsHit(subitem.toLowerCase(), terms)).length
        : 0;

    const noun = `subitem${total === 1 ? "" : "s"}`;

    return matching
        ? `<span class="wp-tag wp-tag--count wp-tag--hit">☰ ${matching} of ${total} ${noun}</span>`
        : `<span class="wp-tag wp-tag--count">☰ ${total} ${noun}</span>`;
}

// Places where the search matched that are NOT already visible on the card.
// Only the first one is shown; the rest are summarised as "+N more".
function matchBoxHtml(item, terms, fields, regex, descriptionHead) {

    const found = [];

    if (
        fields.includes("description") &&
        item.description &&
        termsHit(item._lc.description, terms) &&
        !termsHit(descriptionHead.toLowerCase(), terms)
    ) {
        found.push({ label: "Description", text: item.description });
    }

    if (fields.includes("subitems")) {
        item.subitems.forEach(subitem => {
            if (termsHit(subitem.toLowerCase(), terms)) {
                found.push({ label: "Subitem", text: subitem });
            }
        });
    }

    [
        ["learnings", "Learnings", item.learnings],
        ["realizedHWWK", "Realized HWWK", item.realizedHWWK]
    ].forEach(([key, label, text]) => {

        if (fields.includes(key) && text && termsHit(item._lc[key], terms)) {
            found.push({ label, text });
        }
    });

    if (!found.length) return "";

    const [first, ...rest] = found;

    const more = rest.length
        ? `<div class="wp-match-more" title="${escapeHtml([...new Set(rest.map(r => r.label))].join(", "))}">+${rest.length} more</div>`
        : "";

    return `
        <div class="wp-match">
            <div class="wp-match-line">
                <span class="wp-match-label">${first.label}</span>
                ${highlight(excerpt(first.text, terms, 140), regex)}
            </div>
            ${more}
        </div>
    `;
}

function cardHtml({ item, exact, score }, terms, fields, regex) {

    const percentage = Math.max(0, Math.min(100, Math.round((1 - score) * 100)));

    let scoreColor = "#ef4444";
    if (percentage >= 90) scoreColor = "#22c55e";
    else if (percentage >= 75) scoreColor = "#0073ea";
    else if (percentage >= 60) scoreColor = "#f59e0b";

    const names = exact ? matchedFieldLabels(item, fields, terms, "short") : [];
    const matchedIn = names.length ? `Matched in ${names.join(" · ")}` : "Similar match";

    const descriptionHead = headText(item.description);

    const description = descriptionHead
        ? `<div class="wp-description">${highlight(descriptionHead, regex)}</div>`
        : "";

    const tags =
        tagGroupHtml("diseaseArea", item.diseaseArea, "", fields, terms) +
        tagGroupHtml("product", item.product, "💊", fields, terms) +
        subitemTagHtml(item, terms, fields);

    const detailsLink = isSafeUrl(item.url)
        ? `<a class="wp-details" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Details <span aria-hidden="true">›</span></a>`
        : `<span class="wp-details wp-details--off">Details</span>`;

    return `
        <article class="wp-card">

            <div class="wp-card-body">

                <span class="wp-status ${regionClass(item._region)}"
                      title="${escapeHtml(item._region + " - " + item.boardName)}">
                    <span class="wp-status-region">${escapeHtml(item._region)}</span>
                    <span class="wp-status-sep">-</span>
                    <span class="wp-status-board">${escapeHtml(boardTag(item.boardName))}</span>
                </span>

                <div class="wp-title">${highlight(item.itemName, regex)}</div>

                ${description}

                ${tags ? `<div class="wp-tags">${tags}</div>` : ""}

                ${matchBoxHtml(item, terms, fields, regex, descriptionHead)}

            </div>

            <div class="wp-card-footer">

                <div class="wp-owner">
                    <span class="wp-avatar" style="background:${scoreColor}">${percentage}%</span>
                    <span class="wp-owner-name" title="${escapeHtml(matchedIn)}">${escapeHtml(matchedIn)}</span>
                </div>

                ${detailsLink}

            </div>

        </article>
    `;
}

/* ---------- Events ---------- */

function handleResultsClick(event) {

    const target = event.target;

    const tagButton = target.closest("[data-tag-type]");
    if (tagButton) {
        filterTag(tagButton.dataset.tagType, tagButton.dataset.tagValue);
        return;
    }

    if (target.closest("[data-clear-tag]")) {
        clearTagFilter();
        return;
    }

    const pageButton = target.closest("[data-page]");
    if (pageButton) {
        goToPage(Number(pageButton.dataset.page));
        return;
    }

    const boardPill = target.closest("[data-board]");
    if (boardPill) {
        filterBoard(boardPill.dataset.board);
        return;
    }

    if (target.closest("[data-other-boards]")) {
        filterOtherBoards();
        return;
    }

    if (target.closest("[data-clear-board]")) {
        clearBoardFilter();
        return;
    }

}

document.addEventListener("change", event => {

    const target = event.target;

    if (target.id === "selectAllBoards") {

        document.querySelectorAll(".region-checkbox").forEach(box => {
            box.checked = target.checked;
        });

        currentPage = 1;
        runSearch();
        return;
    }

    if (target.classList.contains("region-checkbox")) {

        const all = document.querySelectorAll(".region-checkbox");
        const checked = document.querySelectorAll(".region-checkbox:checked");

        $("selectAllBoards").checked = all.length === checked.length;

        currentPage = 1;
        runSearch();
        return;
    }

    if (
        target.classList.contains("search-field") ||
        target.id === "showSimilarMatches" ||
        target.id === "sortSelect"
    ) {
        currentPage = 1;
        runSearch();
    }
});

function goToPage(page) {

    currentPage = page;
    runSearch();

    $("resultCount").scrollIntoView({ behavior: "smooth", block: "start" });
}

function filterBoard(boardName) {

    currentPage = 1;
    activeBoardFilter = boardName;
    runSearch();
}

function filterOtherBoards() {

    currentPage = 1;
    activeBoardFilter = OTHER_BOARDS;
    runSearch();
}

function clearBoardFilter() {

    currentPage = 1;
    activeBoardFilter = null;
    runSearch();
}

// clicking the same tag again removes the filter
function filterTag(type, value) {

    const same =
        activeTagFilter &&
        activeTagFilter.type === type &&
        activeTagFilter.value === value;

    currentPage = 1;
    activeTagFilter = same ? null : { type, value };
    runSearch();
}

function clearTagFilter() {

    currentPage = 1;
    activeTagFilter = null;
    runSearch();
}

function clearSearch() {

    $("searchInput").value = "";
    $("results").innerHTML = "";
    $("resultCount").innerHTML = "";

    currentPage = 1;
    activeBoardFilter = null;
    activeTagFilter = null;
    currentSearchResults = [];
    searchCache = { key: null };

    $("searchInput").focus();
}

/* ---------- Export (Excel .xlsx, with CSV as a fallback) ---------- */

const EXCEL_CELL_LIMIT = 32000;   // Excel cuts cells at 32,767 characters

const COLUMN_WIDTHS = {
    "Match %": 9,
    "Matched In": 28,
    Board: 34,
    Region: 10,
    "Work Package": 48,
    URL: 42,
    "Description / Deliverables": 70,
    Learnings: 70,
    "Realized HWWK?": 28,
    "Disease Area": 24,
    Product: 28,
    Subitems: 60
};

function exportRow(item) {

    return {
        Board: item.boardName,
        Region: item._region,
        "Work Package": item.itemName,
        URL: item.url,
        "Description / Deliverables": item.description,
        Learnings: item.learnings,
        "Realized HWWK?": item.realizedHWWK,
        "Disease Area": item.diseaseArea,
        Product: item.product,
        Subitems: item.subitems.join(" | ")
    };
}

function exportAllData() {

    downloadXlsx(
        allData.map(exportRow),
        "all-work-packages.xlsx",
        "Work Packages"
    );
}

function exportSearchResults() {

    const { terms, fields } = searchCache;

    downloadXlsx(
        currentSearchResults.map(({ item, exact, score }) => {

            const labels = exact && terms ? matchedFieldLabels(item, fields, terms) : [];

            return {
                "Match %": Math.max(0, Math.min(100, Math.round((1 - score) * 100))),
                "Matched In": labels.length ? labels.join(" · ") : "Similar match",
                ...exportRow(item)
            };
        }),
        "search-results.xlsx",
        "Search Results"
    );
}

function saveBlob(blob, filename) {

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function downloadXlsx(rows, filename, sheetName) {

    if (!rows.length) {
        alert("No data to export");
        return;
    }

    try {

        saveBlob(await buildXlsxBlob(rows, sheetName), filename);

    } catch (error) {

        console.error("Excel export failed", error);

        alert("The Excel export failed, so a CSV file will be downloaded instead.");

        downloadCsv(rows, filename.replace(/\.xlsx$/i, ".csv"));
    }
}

/* ----- .xlsx writer (an .xlsx file is a zip of small XML files) ----- */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// characters that are not allowed in XML 1.0 (control characters, lone surrogates)
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function xmlEscape(value) {

    return String(value ?? "")
        .replace(XML_ILLEGAL, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function columnName(index) {

    let name = "";

    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
        name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    }

    return name;
}

function textCell(ref, text, style) {

    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}>` +
           `<is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function cleanCellText(value) {

    let text = String(value ?? "");

    if (text.length > EXCEL_CELL_LIMIT) {
        text = text.slice(0, EXCEL_CELL_LIMIT) + "…";
    }

    return text;
}

const XLSX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0073EA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

async function buildXlsxBlob(rows, sheetName) {

    const encoder = new TextEncoder();
    const headers = Object.keys(rows[0]);
    const lastColumn = columnName(headers.length - 1);
    const lastRow = rows.length + 1;
    const links = [];

    // header row: blue background, white bold text
    const sheetRows = [
        `<row r="1" ht="22" customHeight="1">` +
        headers.map((header, i) => textCell(`${columnName(i)}1`, header, 1)).join("") +
        `</row>`
    ];

    rows.forEach((row, index) => {

        const rowNumber = index + 2;
        let cells = "";

        headers.forEach((header, i) => {

            const ref = `${columnName(i)}${rowNumber}`;
            const value = row[header];

            if (typeof value === "number" && Number.isFinite(value)) {
                cells += `<c r="${ref}"><v>${value}</v></c>`;
                return;
            }

            const text = cleanCellText(value);

            if (!text) return;

            if (header === "URL" && isSafeUrl(text)) {
                links.push({ ref, url: text });
                cells += textCell(ref, text, 2);
            } else {
                cells += textCell(ref, text);
            }
        });

        sheetRows.push(`<row r="${rowNumber}">${cells}</row>`);
    });

    const columns = headers
        .map((header, i) =>
            `<col min="${i + 1}" max="${i + 1}" width="${COLUMN_WIDTHS[header] || 20}" customWidth="1"/>`
        )
        .join("");

    const hyperlinks = links.length
        ? `<hyperlinks>${links.map((link, i) =>
              `<hyperlink ref="${link.ref}" r:id="rId${i + 1}"/>`).join("")}</hyperlinks>`
        : "";

    const sheetXml =
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
        `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
        `<sheetViews><sheetView workbookViewId="0">` +
        `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
        `<selection pane="bottomLeft"/></sheetView></sheetViews>` +
        `<sheetFormatPr defaultRowHeight="15"/>` +
        `<cols>${columns}</cols>` +
        `<sheetData>${sheetRows.join("")}</sheetData>` +
        `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` +
        hyperlinks +
        `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
        `</worksheet>`;

    const safeSheetName = xmlEscape(String(sheetName).replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31));

    const files = [
        {
            name: "[Content_Types].xml",
            text:
                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
                `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
                `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
                `<Default Extension="xml" ContentType="application/xml"/>` +
                `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
                `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
                `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
                `</Types>`
        },
        {
            name: "_rels/.rels",
            text:
                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
                `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
                `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
                `</Relationships>`
        },
        {
            name: "xl/workbook.xml",
            text:
                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
                `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
                `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
                `<sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`
        },
        {
            name: "xl/_rels/workbook.xml.rels",
            text:
                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
                `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
                `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
                `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
                `</Relationships>`
        },
        { name: "xl/styles.xml", text: XLSX_STYLES },
        { name: "xl/worksheets/sheet1.xml", text: sheetXml }
    ];

    if (links.length) {
        files.push({
            name: "xl/worksheets/_rels/sheet1.xml.rels",
            text:
                `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
                `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
                links.map((link, i) =>
                    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ` +
                    `Target="${xmlEscape(link.url)}" TargetMode="External"/>`
                ).join("") +
                `</Relationships>`
        });
    }

    return buildZip(files.map(file => ({
        name: file.name,
        data: encoder.encode(file.text)
    })));
}

/* ----- minimal zip writer ----- */

const CRC_TABLE = (() => {

    const table = new Uint32Array(256);

    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }

    return table;
})();

function crc32(bytes) {

    let crc = 0xFFFFFFFF;

    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }

    return (crc ^ 0xFFFFFFFF) >>> 0;
}

async function deflateRaw(bytes) {

    const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new CompressionStream("deflate-raw"));

    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function buildZip(files) {

    const encoder = new TextEncoder();
    const canCompress = typeof CompressionStream === "function";

    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const parts = [];
    const centralParts = [];
    let offset = 0;
    let centralSize = 0;

    for (const file of files) {

        const nameBytes = encoder.encode(file.name);
        const crc = crc32(file.data);

        let method = 0;
        let body = file.data;

        if (canCompress) {
            try {
                body = await deflateRaw(file.data);
                method = 8;
            } catch {
                body = file.data;
                method = 0;
            }
        }

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);          // file names are UTF-8
        local.setUint16(8, method, true);
        local.setUint16(10, dosTime, true);
        local.setUint16(12, dosDate, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, body.length, true);
        local.setUint32(22, file.data.length, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);

        const central = new DataView(new ArrayBuffer(46));
        central.setUint32(0, 0x02014b50, true);
        central.setUint16(4, 20, true);
        central.setUint16(6, 20, true);
        central.setUint16(8, 0x0800, true);
        central.setUint16(10, method, true);
        central.setUint16(12, dosTime, true);
        central.setUint16(14, dosDate, true);
        central.setUint32(16, crc, true);
        central.setUint32(20, body.length, true);
        central.setUint32(24, file.data.length, true);
        central.setUint16(28, nameBytes.length, true);
        central.setUint32(42, offset, true);

        parts.push(new Uint8Array(local.buffer), nameBytes, body);
        centralParts.push(new Uint8Array(central.buffer), nameBytes);

        offset += 30 + nameBytes.length + body.length;
        centralSize += 46 + nameBytes.length;
    }

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...centralParts, new Uint8Array(end.buffer)], { type: XLSX_MIME });
}

/* ----- CSV fallback (only used if the Excel export fails) ----- */

function csvCell(value) {

    let text = cleanCellText(value);

    // stop spreadsheet apps from executing cells that start with = + @ or -<non-space>
    if (/^[=+@\t\r]|^-(?!\s)/.test(text)) text = "'" + text;

    return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows, filename) {

    const headers = Object.keys(rows[0]);

    const csv = [
        headers.map(csvCell).join(","),
        ...rows.map(row => headers.map(header => csvCell(row[header])).join(","))
    ].join("\r\n");

    // BOM so Excel reads UTF-8 correctly (e.g. "Türkiye")
    saveBlob(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }), filename);
}
