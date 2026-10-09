let allData = [];
let fuse;

fetch("data.json")
    .then(response => response.json())
    .then(data => {

        allData = data.items;

        updateStats(data);

        buildBoardFilter();

        fuse = new Fuse(allData, {
            includeScore: true,
            threshold: 0.4,
            keys: [
                {
                    name: "itemName",
                    weight: 0.5
                },
                {
                    name: "description",
                    weight: 0.3
                },
                {
                    name: "subitems",
                    weight: 0.2
                }
            ]
        });

        document
            .getElementById("searchInput")
            .addEventListener("input", runSearch);

    })
    .catch(error => {

        console.error(error);

        document.getElementById("stats").innerHTML =
            "Error loading workspace data";

    });

function updateStats(data) {

    document.getElementById("stats").innerHTML =
        `${data.boards} Boards Indexed | ${data.items.length} Records Available`;

}

function buildBoardFilter() {

    const boardList =
        document.getElementById("boardList");

    boardList.innerHTML = "";

    const uniqueBoards =
        [...new Set(allData.map(item => item.boardName))]
            .sort();

    uniqueBoards.forEach(board => {

        const label =
            document.createElement("label");

        label.className = "board-option";

        label.innerHTML = `
            <input
                type="checkbox"
                class="board-checkbox"
                value="${board}"
                checked
            >
            ${board}
        `;

        boardList.appendChild(label);

    });

}

function getSelectedBoards() {

    const selected = [];

    document
        .querySelectorAll(".board-checkbox:checked")
        .forEach(box => {

            selected.push(box.value);

        });

    return selected;
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

    results =
        results.filter(result =>
            selectedBoards.includes(
                result.item.boardName
            )
        );

    document
        .getElementById("resultCount")
        .innerHTML =
        `${results.length} result(s) found`;

    renderResults(results, searchTerm);

}

function renderResults(results, searchTerm) {

    const container =
        document.getElementById("results");

    container.innerHTML = "";

    results.forEach(result => {

        const item =
            result.item;
        console.log(item);

        const percentage =
            Math.round(
                (1 - result.score) * 100
            );

        const snippet =
            buildSnippet(
                item.description,
                searchTerm
            );

        let matchLocation = "DESCRIPTION";

        if (
            item.itemName &&
            item.itemName
                .toLowerCase()
                .includes(searchTerm.toLowerCase())
        ) {
            matchLocation = "WORK PACKAGE";
        }
        
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

        : "<div class='subitem-name'>No matching subitems</div>";

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

                    <div class="match-score">
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
                    ${item.itemName}
                </div>

                <div class="section-label">
                    Keywords
                </div>

                <div class="keywords">
                    ${keywords}
                </div>

                <div class="section-label">
                    Matching Subitems
                </div>
                
                <div>
                    ${subitemsHtml}
                </div>
                
                <div class="section-label">
                    Description
                </div>
                <div class="snippet">
                    ${snippet}
                </div>

            </div>

        `;

    });

}
document.addEventListener("change", function (event) {

    if (event.target.id === "selectAllBoards") {

        const checked = event.target.checked;

        document
            .querySelectorAll(".board-checkbox")
            .forEach(box => {

                box.checked = checked;

            });

        runSearch();
    }

    if (event.target.classList.contains("board-checkbox")) {

        runSearch();

    }

});

console.log("Search.js loaded successfully");
console.log("Fuse type:", typeof Fuse);
