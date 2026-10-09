const API_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjcxMjQyODI4MywiYWFpIjoxMSwidWlkIjo2MzU5OTI4OCwiaWFkIjoiMjAyNi0xMC0wOVQwODowMzoxOS4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6OTc0MzQ5NiwicmduIjoiZXVjMSJ9.MVUO6iq5pPudeS-L6sEh-F1z7MYr1UhQBvOuBIBEcXA";

const query = `
{
  me {
    id
    name
  }
}
`;

fetch("https://api.monday.com/v2", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": API_TOKEN
  },
  body: JSON.stringify({ query })
})
.then(res => res.json())
.then(data => {
  console.log(data);
})
.catch(error => {
  console.error(error);
});
