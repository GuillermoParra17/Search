let unfilteredResults = [];
let currentSearchResults = [];
let showSimilarMatches = false;

let currentPage = 1;
const RESULTS_PER_PAGE = 50;

let allData = [];
let fuse;

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

    CLT: [
        "CLT"
    ],

    IPS: [
        "IPS"
    ],

    Archive: [
    "Archive"
    ]

};

fetch("data.json")
    .then(response => response.json())
    .then(data => {

        allData = data.items;

        updateStats(data);

        buildRegionFilter();

        fuse = new Fuse(allData, {
            includeScore: true,
            threshold: 0.4,
            keys: []
        });

        let searchTimeout;

        document
            .getElementById("searchInput")
            .addEventListener("input", () => {
        
                clearTimeout(searchTimeout);
        
                searchTimeout = setTimeout(
                    runSearch,
                    300
                );
        
            });

    })
    .catch(error => {

        console.error(error);

        document.getElementById("stats").innerHTML =
            "Error loading workspace data";

    });

function updateStats(data) {
 
        const generated =
        new Date(data.generatedAt);
         
        const formattedDate =
        generated.toLocaleString();
         
        document.getElementById("stats").innerHTML =
        `
        <strong>${data.boards}</strong> Boards Indexed |
        <strong>${data.items.length.toLocaleString()}</strong> Work Packages Indexed
        <br>
        Last Updated: ${formattedDate}
        <br>
        <small>
        Search results are refreshed daily from WBO Tech Suite.
        </small>
        `;
 
}

function highlightText(text, searchTerm) {

    if (!text) return "";

    let highlighted = text;

    searchTerm
        .split(" ")
        .filter(word => word.trim() !== "")
        .forEach(word => {

            const regex =
                new RegExp(`(${word})`, "gi");

            highlighted =
                highlighted.replace(
                    regex,
                    "<mark>$1</mark>"
                );

        });

    return highlighted;

}

function getRegionLabel(region) {

    const labels = {

        Africa: "🌍 Africa",
        APAC: "🌏 APAC",
        CEETRIS: "🌐 CEETRIS",
        Europe: "🌍 Europe",
        LATAM: "🌎 LATAM",
        i8: "🚀 i8",
        CLT: "🏢 CLT",
        IPS: "🔬 IPS",
        Archive: "📦 Archive",

    };

    return labels[region] || region;

}

function buildRegionFilter() {

    const boardList =
        document.getElementById("boardList");

    boardList.innerHTML = "";

    Object.keys(REGION_MAP)
        .forEach(region => {

            const label =
                document.createElement("label");

            label.className =
                "board-option";

            label.innerHTML = `
                <input
                    type="checkbox"
                    class="region-checkbox"
                    value="${region}"
                    checked
                >
                ${getRegionLabel(region)}
            `;

            boardList.appendChild(label);

        });

}

function getSelectedBoards() {
    

    const selectedRegions = [];

    document
        .querySelectorAll(".region-checkbox:checked")
        .forEach(box => {

            selectedRegions.push(box.value);

        });

    const selectedBoards = [];

    selectedRegions.forEach(region => {

        REGION_MAP[region].forEach(board => {

            selectedBoards.push(board);

        });

    });

    return selectedBoards;

}

function getSelectedSearchFields() {

    const fields = [];

    document
        .querySelectorAll(".search-field:checked")
        .forEach(box => {

            fields.push(box.value);

        });

    return fields;

}

function buildSnippet(text, searchTerm) {

    if (!text) return "";

    const searchWords =
        searchTerm
            .split(" ")
            .filter(word => word.trim() !== "");

    let snippet = text;

    const firstWord = searchWords[0];

    const index =
        text.toLowerCase()
            .indexOf(firstWord.toLowerCase());

    if (index !== -1) {

        const start =
            Math.max(0, index - 50);

        const end =
            Math.min(text.length, index + 100);

        snippet =
            "..." +
            text.substring(start, end) +
            "...";

    }

    searchWords.forEach(word => {

        const regex =
            new RegExp(`(${word})`, "gi");

        snippet =
            snippet.replace(
                regex,
                "<mark>$1</mark>"
            );

    });

    return snippet;

}

function runSearch() {

    const searchTerm =
        document
            .getElementById("searchInput")
            .value
            .trim();

    if (!searchTerm) {

        document.getElementById("resultCount").innerHTML = "";
        document.getElementById("results").innerHTML = "";

        return;

    }

    const selectedBoards =
        getSelectedBoards();

    const selectedSearchFields =
        getSelectedSearchFields();

    showSimilarMatches =
    document.getElementById("showSimilarMatches").checked;
    
    const searchKeys = [];
    
    if (selectedSearchFields.includes("itemName")) {
        searchKeys.push({
            name: "itemName",
            weight: 0.40
        });
    }
    
    if (selectedSearchFields.includes("subitems")) {
        searchKeys.push({
            name: "subitems",
            weight: 0.15
        });
    }
    
    if (selectedSearchFields.includes("description")) {
        searchKeys.push({
            name: "description",
            weight: 0.15
        });
    }
    
    if (selectedSearchFields.includes("learnings")) {
        searchKeys.push({
            name: "learnings",
            weight: 0.10
        });
    }
    
    if (selectedSearchFields.includes("realizedHWWK")) {
        searchKeys.push({
            name: "realizedHWWK",
            weight: 0.10
        });
    }
    
    if (selectedSearchFields.includes("product")) {
        searchKeys.push({
            name: "product",
            weight: 0.05
        });
    }
    
    if (selectedSearchFields.includes("diseaseArea")) {
        searchKeys.push({
            name: "diseaseArea",
            weight: 0.05
        });
    }
    
    fuse = new Fuse(allData, {
        includeScore: true,
        threshold: 0.4,
        keys: searchKeys
    });
    
    let results =
        fuse.search(searchTerm);

    console.log(
    "Actual Board Names:",
    [...new Set(allData.map(x => x.boardName))]
    );
    
    console.log("First Result Board:",
    allData[0].boardName
    );
    console.log("First Board:", results[0]?.item?.boardName);
    results =
        results =
            results.filter(result => {
        
                return selectedBoards.some(board =>
        
                    result.item.boardName.includes(board)
        
                );
        
            });

    unfilteredResults = [...results];

    console.log("Active Filter:", activeBoardFilter);

            if (activeBoardFilter === "Other Affiliate(s)") {

    const boardCounts = {};

let summaryResults = fuse.search(searchTerm);
console.log("Summary Results:", summaryResults.length);
console.log("Display Results:", results.length);
                
summaryResults = summaryResults.filter(result =>
    getSelectedBoards().some(board =>
        result.item.boardName.includes(board)
    )
);

unfilteredResults.forEach(result => {

    const board = result.item.boardName;

    boardCounts[board] =
        (boardCounts[board] || 0) + 1;

});


    const topBoards =
        Object.entries(boardCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([board]) => board);

    results =
        results.filter(result =>
            !topBoards.includes(result.item.boardName)
        );

}
else if (activeBoardFilter) {

    results =
        results.filter(result =>
            result.item.boardName.includes(activeBoardFilter)
        );

}

    currentSearchResults = [...results];

const startResult =
    ((currentPage - 1) * RESULTS_PER_PAGE) + 1;

const endResult =
    Math.min(
        currentPage * RESULTS_PER_PAGE,
        results.length
    );

document
    .getElementById("resultCount")
    .innerHTML =
    `
    ${results.length.toLocaleString()} matching work package(s) found across ${new Set(results.map(r => r.item.boardName)).size} affiliate(s)

    <div class="page-range">
        Showing ${startResult}-${endResult} of ${results.length.toLocaleString()}
    </div>
    `;

renderResults(results, searchTerm);

}

function renderResults(results, searchTerm) {

    const container =
        document.getElementById("results");

    container.innerHTML = "";

    if (activeBoardFilter) {

        container.innerHTML += `
            <div class="active-filter">
                Active Board Filter:
                <span
                    class="active-filter-pill"
                    onclick="clearBoardFilter()"
                >
                    ${activeBoardFilter} ✕
                </span>
            </div>
        `;
    
    }

    const boardCounts = {};

unfilteredResults.forEach(result => {

    const board = result.item.boardName;

    boardCounts[board] =
        (boardCounts[board] || 0) + 1;

});

        
        const sortedBoards = Object.entries(boardCounts)
    .sort((a, b) => b[1] - a[1]);

const topBoards = sortedBoards.slice(0, 10);

const otherBoards = sortedBoards.slice(10);

const otherBoardsCount =
    otherBoards.reduce(
        (sum, [, count]) => sum + count,
        0
    );

const boardSummary = topBoards
    .map(([board, count]) => {

        const shortBoard =
            board
                .replace(" Work Package Overview", "")
                .replace(" WP Portfolio Overview", "")
                .replace(" Work Packages Overview", "");

        return `
            <span
                class="board-summary-pill"
                onclick="filterBoard(this.dataset.board)"
                data-board="${board}"
            >
                ${shortBoard} (${count})
            </span>
        `;
    })
    .join("");

   let otherBoardsPill = "";

        if (
            otherBoards.length > 0 &&
            activeBoardFilter !== "Other Affiliate(s)"
        ) {
        
            otherBoardsPill = `
                <span
                    class="board-summary-pill"
                    onclick="filterOtherBoards()"
                >
                    Other Affiliates (${otherBoardsCount})
                </span>
            `;
        
        }
        
        container.innerHTML += `
    <div class="board-summary">
        ${boardSummary}
        ${otherBoardsPill}
    </div>
`;

    const totalPages =
    Math.ceil(
        results.length / RESULTS_PER_PAGE
    );

const startIndex =
    (currentPage - 1) * RESULTS_PER_PAGE;

const endIndex =
    startIndex + RESULTS_PER_PAGE;

const pagedResults =
    results.slice(startIndex, endIndex);

    let paginationHtml = "";

if (totalPages > 1) {

    paginationHtml = `
        <div class="pagination">
            <button
                ${currentPage === 1 ? "disabled" : ""}
                onclick="goToPage(${currentPage - 1})"
            >
                ◀ Previous
            </button>
    `;

    for (let i = 1; i <= totalPages; i++) {

        paginationHtml += `
            <button
                onclick="goToPage(${i})"
                class="${i === currentPage ? 'active-page' : ''}"
            >
                ${i}
            </button>
        `;

    }

    paginationHtml += `
            <button
                ${currentPage === totalPages ? "disabled" : ""}
                onclick="goToPage(${currentPage + 1})"
            >
                Next ▶
            </button>
        </div>
    `;
}

container.innerHTML += paginationHtml;
pagedResults.forEach(result => {

        const item =
            result.item;
        console.log(item);

        const percentage =
            Math.round(
                (1 - result.score) * 100
            );

        let scoreColor = "#ef4444";

            if (percentage >= 90) {
                scoreColor = "#22c55e";
            }
            else if (percentage >= 75) {
                scoreColor = "#0073ea";
            }
            else if (percentage >= 60) {
                scoreColor = "#f59e0b";
            }


        const snippet =
            buildSnippet(
                item.description,
                searchTerm
            );

    const selectedSearchFields =
    getSelectedSearchFields();

    let matchLocation = "SIMILAR MATCH";
    
    const matchWords =
        searchTerm
            .toLowerCase()
            .split(" ")
            .filter(word =>
                word.trim().length > 3
            );
    
    if (
        selectedSearchFields.includes("itemName") &&
        matchWords.some(word =>
            item.itemName
                .toLowerCase()
                .includes(word)
        )
    ) {
        matchLocation = "WORK PACKAGE";
    }
    
    if (
        selectedSearchFields.includes("description") &&
        item.description &&
        matchWords.some(word =>
            item.description
                .toLowerCase()
                .includes(word)
        )
    ) {
        matchLocation = "DESCRIPTION";
    }
    
    if (
        selectedSearchFields.includes("learnings") &&
        item.learnings &&
        matchWords.some(word =>
            item.learnings
                .toLowerCase()
                .includes(word)
        )
    ) {
        matchLocation = "LEARNINGS";
    }
    
    if (
        selectedSearchFields.includes("realizedHWWK") &&
        item.realizedHWWK &&
        matchWords.some(word =>
            item.realizedHWWK
                .toLowerCase()
                .includes(word)
        )
    ) {
        matchLocation = "REALIZED HWWK";
    }
    
    if (
        selectedSearchFields.includes("diseaseArea") &&
        item.diseaseArea &&
        matchWords.some(word =>
            item.diseaseArea
                .toLowerCase()
                .includes(word)
        )
    ) {
        matchLocation = "DISEASE AREA";
    }
    
    if (
        selectedSearchFields.includes("product") &&
        item.product &&
        matchWords.some(word =>
            item.product
                .toLowerCase()
                .includes(word)
        )
    ) {
        matchLocation = "PRODUCT";
    }
    
    if (
        selectedSearchFields.includes("subitems") &&
        item.subitems &&
        item.subitems.some(subitem =>
            matchWords.some(word =>
                subitem
                    .toLowerCase()
                    .includes(word)
            )
        )
    ) {
        matchLocation = "SUBITEM";
    }

        
        const searchWords =
    searchTerm
        .toLowerCase()
        .split(" ")
        .filter(word => word.trim() !== "");

const matchingSubitems =
    (item.subitems || []).filter(subitem =>

        searchWords.some(word =>
            subitem
                .toLowerCase()
                .includes(word)
        )

    );

const subitemsHtml =
    matchingSubitems.length

        ? matchingSubitems
            .map(subitem => {

                let highlighted = subitem;

                searchWords.forEach(word => {

                    const regex =
                        new RegExp(`(${word})`, "gi");

                    highlighted =
                        highlighted.replace(
                            regex,
                            "<mark>$1</mark>"
                        );

                });

                return `
                    <div class="subitem-name">
                        ⭐ ${highlighted}
                    </div>
                `;

            })
            .join("")

        : "";

        const keywords = searchTerm
    .split(" ")
    .filter(word => word.trim() !== "")
    .map(word =>
        `<span class="keyword">${word}</span>`
    )
    .join("");

        container.innerHTML += `

            <div
                class="result-card"
                onclick="window.open('${item.url}', '_blank')"
            >

                <div class="result-header">

                    <div
                            class="match-score"
                            style="color:${scoreColor}"
                        >
                            ${percentage}% Match
                        </div>

                    <div class="match-type">
                        ${matchLocation}
                    </div>

                </div>

                <div class="section-label">
                    Board
                </div>

                <div class="board-name">
                    ${item.boardName}
                </div>

                <div class="section-label">
                    Work Package
                </div>

                <div class="work-package">
                    ${highlightText(item.itemName, searchTerm)}
                </div>

                <div class="section-label">
                    Keywords
                </div>

                <div class="keywords">
                    ${keywords}
                </div>

                ${item.description ? `
                <div class="section-label">
                    Description / Deliverables
                </div>
                <div>
                    ${highlightText(
                        item.description.length > 300
                            ? item.description.substring(0, 300) + "..."
                            : item.description,
                        searchTerm
                    )}
                </div>
                ` : ""}
                
                ${item.learnings ? `
                <div class="section-label">
                    Learnings
                </div>
                <div>
                    ${highlightText(
                        item.learnings.length > 300
                            ? item.learnings.substring(0, 300) + "..."
                            : item.learnings,
                        searchTerm
                    )}
                </div>
                ` : ""}
                
                ${item.realizedHWWK ? `
                <div class="section-label">
                    Realized HWWK?
                </div>
                <div>
                    ${highlightText(
                        item.realizedHWWK.length > 300
                            ? item.realizedHWWK.substring(0, 300) + "..."
                            : item.realizedHWWK,
                        searchTerm
                    )}
                </div>
                ` : ""}

                ${item.diseaseArea ? `
                <div class="section-label">
                    Disease Area
                </div>
                <div>
                    ${highlightText(item.diseaseArea, searchTerm)}
                </div>
                ` : ""}

                 ${item.product ? `
                <div class="section-label">
                    Product
                </div>
                <div>
                    ${highlightText(item.product, searchTerm)}
                </div>
                ` : ""}   

                ${subitemsHtml ? `
                <div class="section-label">
                    Matching Subitems
                </div>
            
                <div>
                    ${subitemsHtml}
                </div>
                ` : ""}
            
            </div>

        `;

    });

    container.innerHTML += paginationHtml;
    
    if (totalPages > 1) {

    let paginationHtml =
        `<div class="pagination">`;

    paginationHtml += `
        <button
            ${currentPage === 1 ? "disabled" : ""}
            onclick="goToPage(${currentPage - 1})"
        >
            Previous
        </button>
    `;

    for (let i = 1; i <= totalPages; i++) {

        paginationHtml += `
            <button
                onclick="goToPage(${i})"
                class="${i === currentPage ? 'active-page' : ''}"
            >
                ${i}
            </button>
        `;

    }

    paginationHtml += `
        <button
            ${currentPage === totalPages ? "disabled" : ""}
            onclick="goToPage(${currentPage + 1})"
        >
            Next
        </button>
    `;

    paginationHtml += `</div>`;


}
}
    
document.addEventListener("change", function (event) {

    if (event.target.id === "selectAllBoards") {

        const checked = event.target.checked;

        document
            .querySelectorAll(".region-checkbox")
            .forEach(box => {

                box.checked = checked;

            });

        runSearch();
    }

    if (event.target.classList.contains("region-checkbox")) {
        
        const allRegions =
            document.querySelectorAll(".region-checkbox");
    
        const checkedRegions =
            document.querySelectorAll(".region-checkbox:checked");
    
        document.getElementById("selectAllBoards").checked =
            allRegions.length === checkedRegions.length;
    
        runSearch();
    
    }

    if (event.target.classList.contains("search-field")) {

        runSearch();
    
    }

    if (event.target.id === "showSimilarMatches") {

        runSearch();
    
    }

});

function clearSearch() {

    document.getElementById("searchInput").value = "";

    document.getElementById("results").innerHTML = "";

    document.getElementById("resultCount").innerHTML = "";

    document.getElementById("searchInput").focus();

}

let activeBoardFilter = null;
let showOtherBoards = false;

function filterBoard(boardName) {

    currentPage = 1;

    showOtherBoards = false;

    activeBoardFilter = boardName;

    runSearch();
}

function filterOtherBoards() {

    currentPage = 1;

    activeBoardFilter = "Other Affiliate(s)";

    showOtherBoards = true;

    runSearch();

}

function clearBoardFilter() {
    currentPage = 1;
    activeBoardFilter = null;

    document
        .querySelectorAll(".board-checkbox")
        .forEach(box => {

            box.checked = true;

        });

    runSearch();

}

function goToPage(page) {

    currentPage = page;

    runSearch();

}


function exportAllData() {

    const rows =
        allData.map(item => ({
            Board: item.boardName,
            "Work Package": item.itemName,
            URL: item.url,
            Subitems:
                (item.subitems || [])
                    .join(" | ")
        }));

    downloadCsv(
        rows,
        "all-work-packages.csv"
    );

}

function exportSearchResults() {

    const rows =
        currentSearchResults.map(result => ({

            Board:
                result.item.boardName,

            "Work Package":
                result.item.itemName,

            URL:
                result.item.url,

            Subitems:
                (result.item.subitems || [])
                    .join(" | ")

        }));

    downloadCsv(
        rows,
        "search-results.csv"
    );

}

function downloadCsv(rows, filename) {

    if (!rows.length) {

        alert("No data to export");

        return;

    }

    const headers =
        Object.keys(rows[0]);

    const csv = [

        headers.join(","),

        ...rows.map(row =>
            headers
                .map(header =>
                    `"${String(
                        row[header]
                    ).replace(/"/g, '""')}"`
                )
                .join(",")
        )

    ].join("\n");

    const blob = new Blob(
        [csv],
        {
            type: "text/csv;charset=utf-8;"
        }
    );

    const link =
        document.createElement("a");

    link.href =
        URL.createObjectURL(blob);

    link.download =
        filename;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

}

console.log("Search.js loaded successfully");
console.log("Fuse type:", typeof Fuse);
