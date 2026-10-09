let allData = [];

fetch("data.json")
    .then(response => response.json())
    .then(data => {

        allData = data.items;

        updateStats(data);

        buildBoardFilter();

    })
    .catch(error => {

        console.error("Error loading data:", error);

        document.getElementById("stats").innerHTML =
            "Error loading workspace data";

    });

function updateStats(data) {

    document.getElementById("stats").innerHTML = `
        ${data.boards} Boards Indexed |
        ${data.items.length} Records Available
    `;

}

function buildBoardFilter() {

    const boardList =
        document.getElementById("boardList");

    boardList.innerHTML = "";

    const uniqueBoards = [

        ...new Set(
            allData.map(item => item.boardName)
        )

    ].sort();

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

console.log("Search.js loaded successfully");
console.log("Fuse type:", typeof Fuse);
