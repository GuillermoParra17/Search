// Builds data.json from the Monday boards below.
// Requires Node 18+ (built-in fetch) and the MONDAY_API_TOKEN environment variable.
// Optional: MONDAY_API_VERSION (e.g. "2024-10") to pin the Monday API version.

const fs = require("fs");

const API_URL = "https://api.monday.com/v2";
const API_TOKEN = process.env.MONDAY_API_TOKEN;
const API_VERSION = process.env.MONDAY_API_VERSION;

const OUTPUT_FILE = "data.json";
const ITEM_URL_BASE = "https://globalroche.monday.com/boards";
const PAGE_SIZE = 500;
const MAX_ATTEMPTS = 5;
const PAUSE_BETWEEN_BOARDS_MS = 250;

if (!API_TOKEN) {
  console.error("MONDAY_API_TOKEN environment variable is not set.");
  process.exit(1);
}

const BOARD_IDS = [...new Set([
  5095413574,
  5088511721,
  5088511419,
  5088511200,
  5088511333,
  5088511575,
  5088547379,
  1762431187,
  1762452699,
  2034429891,
  2034369384,
  5093877907,
  2034405853,
  2034398282,
  2034425268,
  2034380907,
  2034314243,
  2034336678,
  2034386119,
  2034435738,
  5043249432,
  5043271899,
  5043197383,
  5043246849,
  5043207451,
  5043258999,
  5043213080,
  5043255829,
  5043265659,
  5043237372,
  5043241195,
  1773051053,
  5043215351,
  5043220837,
  5088213822,
  5088381650,
  5057676945,
  5094013513,
  5057602641,
  5057674884,
  5057672751,
  5057605420,
  5057616717,
  5057609789,
  5057615633,
  1583188396,
  5057678016,
  5057669820,
  5057687454,
  5057612007,
  5057612955,
  5057671124,
  5057668084,
  1667970515,
  5057688864,
  5057690211,
  5057691950,
  5057692961,
  5057669183,
  5057694622,
  1952627070,
  5103931282,
  1880922043,
  1880902743,
  1880895075,
  1880890431,
  1843040726,
  1880884650,
  1880879834,
  1880773874,
  5011717935,
  2037926529,
  2037927803,
  2037931537,
  2037934175,
  2037935652,
  2037937555,
  2037942085,
  2037948070,
  5088556812,
  5088557063,
  5103936890,
  5101234509,
  5101234477,
  5101234446,
  5101234357,
  2000458200,
  5101234297,
  5101267071,
  5101234665,
  5101228134
])];

const ITEM_FIELDS = `
  id
  name
  column_values {
    id
    text
    type
    ... on BoardRelationValue {
      linked_items {
        id
        name
      }
    }
    column {
      title
    }
  }
  subitems {
    id
    name
  }
`;

const FIRST_PAGE_QUERY = `
  query ($boardId: [ID!]) {
    boards(ids: $boardId) {
      id
      name
      items_page(limit: ${PAGE_SIZE}) {
        cursor
        items { ${ITEM_FIELDS} }
      }
    }
  }
`;

const NEXT_PAGE_QUERY = `
  query ($cursor: String!) {
    next_items_page(limit: ${PAGE_SIZE}, cursor: $cursor) {
      cursor
      items { ${ITEM_FIELDS} }
    }
  }
`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Sends one GraphQL request; retries rate-limit / complexity / server errors with backoff.
async function mondayQuery(query, variables = {}) {

  const headers = {
    Authorization: API_TOKEN,
    "Content-Type": "application/json"
  };

  if (API_VERSION) headers["API-Version"] = API_VERSION;

  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {

    let waitMs = attempt * 2000;

    try {

      const response = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables })
      });

      if (response.status === 429 || response.status >= 500) {
        throw Object.assign(new Error(`HTTP ${response.status}`), { retryable: true });
      }

      const json = await response.json();

      if (json.errors?.length || json.error_message) {

        const details = JSON.stringify(json.errors || json.error_message);
        const retryIn = json.errors?.[0]?.extensions?.retry_in_seconds;

        if (retryIn) waitMs = (retryIn + 1) * 1000;

        throw Object.assign(new Error(details), {
          retryable: /complexity|rate.?limit|budget|timeout/i.test(details)
        });
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return json.data;

    } catch (error) {

      lastError = error;

      // network failures (TypeError from fetch) are worth retrying too
      const retryable = error.retryable || error instanceof TypeError;

      if (!retryable || attempt === MAX_ATTEMPTS) break;

      console.warn(`  retry ${attempt}/${MAX_ATTEMPTS - 1} in ${Math.round(waitMs / 1000)}s: ${error.message}`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

// Fetches a board with ALL of its items (follows the pagination cursor).
async function getBoard(boardId) {

  const first = await mondayQuery(FIRST_PAGE_QUERY, { boardId: [String(boardId)] });

  const board = first.boards?.[0];

  if (!board) {
    throw new Error("board not found or no access with this token");
  }

  const items = [...board.items_page.items];
  let cursor = board.items_page.cursor;

  while (cursor) {

    const next = await mondayQuery(NEXT_PAGE_QUERY, { cursor });

    items.push(...next.next_items_page.items);
    cursor = next.next_items_page.cursor;
  }

  return { id: board.id, name: board.name, items };
}

function toRecord(board, item) {

  // first column with a given title wins (same behaviour as before)
  const columns = new Map();

  for (const column of item.column_values || []) {
    const title = column.column?.title;
    if (title && !columns.has(title)) columns.set(title, column);
  }

  const text = title => columns.get(title)?.text || "";

  const linked = title =>
    (columns.get(title)?.linked_items || []).map(i => i.name).join(" | ");

  return {
    boardId: board.id,
    boardName: board.name,
    itemId: item.id,
    itemName: item.name,
    subitems: (item.subitems || []).map(sub => sub.name),
    description: text("Description / Deliverables"),
    learnings: text("Learnings"),
    realizedHWWK: text("Realized HWWK?"),
    diseaseArea: linked("Disease Area"),
    product: linked("Product"),
    url: `${ITEM_URL_BASE}/${board.id}/pulses/${item.id}`
  };
}

function loadPreviousItems() {

  try {
    return JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8")).items || [];
  } catch {
    return [];
  }
}

async function buildIndex() {

  const previousItems = loadPreviousItems();

  const items = [];
  const failedBoards = [];
  let indexedBoards = 0;

  for (const [position, boardId] of BOARD_IDS.entries()) {

    console.log(`[${position + 1}/${BOARD_IDS.length}] Processing board ${boardId}`);

    try {

      const board = await getBoard(boardId);

      if (board.items.length === 0) {
        console.warn(`  board ${boardId} (${board.name}) has no items`);
      }

      for (const item of board.items) {
        items.push(toRecord(board, item));
      }

      indexedBoards++;
      console.log(`  ${board.items.length} items`);

    } catch (error) {

      console.error(`  Board failed: ${boardId} - ${error.message}`);

      failedBoards.push(String(boardId));

      // keep the last known data for this board instead of silently dropping it
      const kept = previousItems.filter(item => String(item.boardId) === String(boardId));
      items.push(...kept);

      if (kept.length) {
        console.warn(`  kept ${kept.length} items from the previous data.json`);
      }
    }

    await sleep(PAUSE_BETWEEN_BOARDS_MS);
  }

  if (indexedBoards === 0) {
    console.error("No board could be read. data.json was NOT overwritten.");
    process.exit(1);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    boards: indexedBoards,
    boardsConfigured: BOARD_IDS.length,
    failedBoards,
    items
  };

  // write to a temp file first so a crash can't leave a half-written data.json
  const tempFile = `${OUTPUT_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(output, null, 2));
  fs.renameSync(tempFile, OUTPUT_FILE);

  console.log(`Indexed ${items.length} records from ${indexedBoards}/${BOARD_IDS.length} boards`);

  if (failedBoards.length) {
    console.warn(`Failed boards (${failedBoards.length}): ${failedBoards.join(", ")}`);
  }
}

buildIndex().catch(error => {
  console.error(error);
  process.exit(1);
});
