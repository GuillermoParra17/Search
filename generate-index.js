const fs = require("fs");

const API_TOKEN = process.env.MONDAY_API_TOKEN;

const BOARD_IDS = [
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
  5088557063
];

async function mondayQuery(query) {
  const response = await fetch(
    "https://api.monday.com/v2",
    {
      method: "POST",
      headers: {
        Authorization: API_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    }
  );

  return response.json();
}

async function getBoard(boardId) {

  console.log(`Processing board ${boardId}`);

  const query = `
  {
    boards(ids:${boardId}) {
      id
      name

      items_page(limit:500) {
        items {
          id
          name

          column_values {
            id
            text
          }

          subitems {
            id
            name
          }
        }
      }
    }
  }
  `;

  const result =
    await mondayQuery(query);

  return result.data.boards[0];
}

async function buildIndex() {

  const items = [];

  for (const boardId of BOARD_IDS) {

    try {

      const board =
        await getBoard(boardId);

      if (!board) continue;

      for (const item of board.items_page.items) {

        const descriptionColumn =
          item.column_values.find(
            col => col.id === "long_text_1"
          );

        items.push({

          boardId: board.id,

          boardName: board.name,

          itemId: item.id,

          itemName: item.name,

          description:
            descriptionColumn?.text || "",

          subitems:
            (item.subitems || [])
              .map(sub => sub.name),

          url:
            `https://globalroche.monday.com/boards/${board.id}`

        });

      }

    } catch (error) {

      console.error(
        `Board failed: ${boardId}`,
        error
      );

    }

  }

  const output = {

    generatedAt:
      new Date().toISOString(),

    boards:
      BOARD_IDS.length,

    items

  };

  fs.writeFileSync(
    "data.json",
    JSON.stringify(
      output,
      null,
      2
    )
  );

  console.log(
    `Indexed ${items.length} records`
  );

}

buildIndex();
