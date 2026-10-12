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
            keys: [
                {
                    name: "itemName",
                    weight: 0.5
                },
                                {
                    name: "subitems",
                    weight: 0.2
                }
            ]
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
        IPS: "🔬 IPS"

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

    console.log("Active Filter:", activeBoardFilter);

            if (activeBoardFilter) {
            
                results =
                    results.filter(result =>
                        result.item.boardName.includes(activeBoardFilter)
                    );
            
            }

    if (otherAffiliatesFilter) {

    const sortedBoards =
        Object.entries(
            results.reduce((acc, result) => {

                const board =
                    result.item.boardName;

                acc[board] =
                    (acc[board] || 0) + 1;

                return acc;

            }, {})
        )
        .sort((a, b) => b[1] - a[1]);

    const topBoards =
        sortedBoards
            .slice(0, 10)
            .map(([board]) => board);

    results =
        results.filter(result =>
            !topBoards.includes(
                result.item.boardName
            )
        );

}
    
    document
        .getElementById("resultCount")
        .innerHTML =
        `${results.length.toLocaleString()} matching work package(s) found across ${new Set(results.map(r => r.item.boardName)).size} affiliate(s)`;
    
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

    results.forEach(result => {
    
            const board =
                result.item.boardName;
        
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
        
        const otherBoardsPill =
    otherBoards.length > 0

        ? `
            <span
                class="board-summary-pill"
                onclick="filterOtherBoards()"
            >
                Other Affiliates (${otherBoardsCount})
            </span>
        `

        : "";

container.innerHTML += `
    <div class="board-summary">
        ${boardSummary}
        ${otherBoardsPill}
    </div>
`;

    results.forEach(result => {

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

        let matchLocation = "WORK PACKAGE";

            if (
                item.subitems &&
                item.subitems.some(subitem =>
                    subitem
                        .toLowerCase()
                        .includes(searchTerm.toLowerCase())
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

});

function clearSearch() {

    document.getElementById("searchInput").value = "";

    document.getElementById("results").innerHTML = "";

    document.getElementById("resultCount").innerHTML = "";

    document.getElementById("searchInput").focus();

}

let activeBoardFilter = null;

function filterBoard(boardName) {

    activeBoardFilter = boardName;

    runSearch();

}

let otherAffiliatesFilter = false;

function filterOtherBoards() {

    otherAffiliatesFilter = true;

    activeBoardFilter = null;

    runSearch();

}

function clearBoardFilter() {

    activeBoardFilter = null;
    otherAffiliatesFilter = false;

    document
        .querySelectorAll(".region-checkbox")
        .forEach(box => {

            box.checked = true;

        });

    runSearch();

}

console.log("Search.js loaded successfully");
console.log("Fuse type:", typeof Fuse);
