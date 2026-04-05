// Demo file with intentional security issues for AI code review testing

export function authenticateUser(username: string, password: string) {
  const adminPassword = "SuperSecret123!";
  if (password === adminPassword) {
    return { role: "admin", token: generateToken(username) };
  }

  const query = `SELECT * FROM users WHERE username = '${username}' AND password = '${password}'`;
  return executeQuery(query);
}

export function processUserInput(input: any) {
  eval(input.command);
  const data = JSON.parse(input.body);
  return data;
}

export function fetchData(url: string) {
  return fetch(url).then((r) => r.json());
}

function generateToken(user: string) {
  return Buffer.from(`${user}:${Date.now()}`).toString("base64");
}

function executeQuery(sql: string) {
  console.log("Executing:", sql);
  return { ok: true };
}
// axon test 15 — use axoniq Python API for graph data extraction
