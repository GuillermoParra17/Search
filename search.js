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
const MAX_SUBITEMS_SHOWN = 10;
const FUZZY_THRESHOLD = 0.3;
const FALLBACK_SCORE = 0.25;     // score used for exact matches Fuse did not return

const OTHER_REGION = "Other";
const OTHER_BOARDS = "Other Affiliate(s)";

// Order = display order and tie-break priority for "matched in" labels.
const FIELDS = [
    { key: "itemName",     label: "WORK PACKAGE",  weight: 0.40 },
    { key: "subitems",     label: "SUBITEM",       weight: 0.15 },
    { key: "description",  label: "DESCRIPTION",   weight: 0.15 },
    { key: "learnings",    label: "LEARNINGS",     weight: 0.10 },
    { key: "realizedHWWK", label: "REALIZED HWWK", weight: 0.10 },
    { key: "diseaseArea",  label: "DISEASE AREA",  weight: 0.05 },
    { key: "product",      label: "PRODUCT",       weight: 0.05 }
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

function matchedFieldLabels(item, fields, terms) {

    return FIELDS
        .filter(field => fields.includes(field.key))
        .filter(field =>
            terms.some(term => textHasTerm(item._lc[field.key], term))
        )
        .map(field => field.label);
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
        $("results").addEventListener("keydown", handleResultsKeydown);

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

    const { terms, fields, results } = searchCache;

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

    html.push(boardSummaryHtml(topBoards, otherBoards));
    html.push(pager);

    pageResults.forEach(result => {
        html.push(cardHtml(result, terms, fields, regex));
    });

    html.push(pager);

    $("results").innerHTML = html.join("");
}

function boardSummaryHtml(topBoards, otherBoards) {

    const pills = topBoards.map(([board, count]) => {

        const shortName = board
            .replace(" Work Package Overview", "")
            .replace(" WP Portfolio Overview", "")
            .replace(" Work Packages Overview", "");

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

function cardHtml({ item, exact, score }, terms, fields, regex) {

    const percentage = Math.max(0, Math.min(100, Math.round((1 - score) * 100)));

    let scoreColor = "#ef4444";
    if (percentage >= 90) scoreColor = "#22c55e";
    else if (percentage >= 75) scoreColor = "#0073ea";
    else if (percentage >= 60) scoreColor = "#f59e0b";

    const labels = exact ? matchedFieldLabels(item, fields, terms) : [];
    const matchLocation = labels.length ? labels.join(" · ") : "SIMILAR MATCH";

    const textSection = (label, text, truncate) => text ? `
        <div class="section-label">${label}</div>
        <div style="white-space: pre-line">${highlight(truncate ? excerpt(text, terms) : text, regex)}</div>
    ` : "";

    let subitemsHtml = "";

    if (fields.includes("subitems")) {

        const matching = item.subitems.filter(subitem => {
            const lower = subitem.toLowerCase();
            return terms.some(term => textHasTerm(lower, term));
        });

        const shown = matching.slice(0, MAX_SUBITEMS_SHOWN);

        subitemsHtml = shown
            .map(subitem => `<div class="subitem-name">⭐ ${highlight(subitem, regex)}</div>`)
            .join("");

        if (matching.length > shown.length) {
            subitemsHtml += `<div class="subitem-name">… and ${matching.length - shown.length} more</div>`;
        }
    }

    const keywords = terms
        .map(term => `<span class="keyword">${escapeHtml(termKey(term))}</span>`)
        .join("");

    const url = isSafeUrl(item.url) ? item.url : "";

    return `
        <div class="result-card" data-url="${escapeHtml(url)}" tabindex="0" role="link">

            <div class="result-header">
                <div class="match-score" style="color:${scoreColor}">
                    ${percentage}% Match
                </div>
                <div class="match-type">${escapeHtml(matchLocation)}</div>
            </div>

            <div class="section-label">Board</div>
            <div class="board-name">${escapeHtml(item.boardName)}</div>

            <div class="section-label">Work Package</div>
            <div class="work-package">${highlight(item.itemName, regex)}</div>

            <div class="section-label">Keywords</div>
            <div class="keywords">${keywords}</div>

            ${textSection("Description / Deliverables", item.description, true)}
            ${textSection("Learnings", item.learnings, true)}
            ${textSection("Realized HWWK?", item.realizedHWWK, true)}
            ${textSection("Disease Area", item.diseaseArea, false)}
            ${textSection("Product", item.product, false)}

            ${subitemsHtml ? `
            <div class="section-label">Matching Subitems</div>
            <div>${subitemsHtml}</div>
            ` : ""}

        </div>
    `;
}

/* ---------- Events ---------- */

function openCard(card) {

    const url = card && card.dataset.url;

    if (isSafeUrl(url)) {
        window.open(url, "_blank", "noopener");
    }
}

function handleResultsClick(event) {

    const target = event.target;

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

    openCard(target.closest(".result-card"));
}

function handleResultsKeydown(event) {

    if (event.key === "Enter" && event.target.classList.contains("result-card")) {
        openCard(event.target);
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

function clearSearch() {

    $("searchInput").value = "";
    $("results").innerHTML = "";
    $("resultCount").innerHTML = "";

    currentPage = 1;
    activeBoardFilter = null;
    currentSearchResults = [];
    searchCache = { key: null };

    $("searchInput").focus();
}

/* ---------- CSV export ---------- */

const EXCEL_CELL_LIMIT = 32000;   // Excel cuts cells at 32,767 characters

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

    downloadCsv(allData.map(exportRow), "all-work-packages.csv");
}

function exportSearchResults() {

    const { terms, fields } = searchCache;

    downloadCsv(
        currentSearchResults.map(({ item, exact, score }) => {

            const labels = exact && terms ? matchedFieldLabels(item, fields, terms) : [];

            return {
                "Match %": Math.max(0, Math.min(100, Math.round((1 - score) * 100))),
                "Matched In": labels.length ? labels.join(" · ") : "Similar match",
                ...exportRow(item)
            };
        }),
        "search-results.csv"
    );
}

function csvCell(value) {

    let text = String(value ?? "");

    if (text.length > EXCEL_CELL_LIMIT) {
        text = text.slice(0, EXCEL_CELL_LIMIT) + "…";
    }

    // stop spreadsheet apps from executing cells that start with = + @ or -<non-space>
    if (/^[=+@\t\r]|^-(?!\s)/.test(text)) text = "'" + text;

    return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows, filename) {

    if (!rows.length) {
        alert("No data to export");
        return;
    }

    const headers = Object.keys(rows[0]);

    const csv = [
        headers.map(csvCell).join(","),
        ...rows.map(row => headers.map(header => csvCell(row[header])).join(","))
    ].join("\r\n");

    // BOM so Excel reads UTF-8 correctly (e.g. "Türkiye")
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
