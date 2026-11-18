// Vercel serverless function: POST /api/judge  {mission, transcript, pin}
const MISSIONS = require("../missions.json");
function buildPrompt(c, tx) {
  const list = c.items.map((it,i)=>`${i+1}. ${it[0]}` + (c.type==="attendant" && it[2] ? ` — if A: ${it[1]}; if B: ${it[2]}` : (it[1] ? ` (${it[1]})` : ""))).join("\n");
  let ctx;
  if (c.type === "attendant") ctx = `The student talks to a subway station attendant.
The student starts at: ${c.start}
Situation: ${c.problem}
The student had to choose one destination and mention their personal situation ("${c.condition}").
Destinations and correct routes:
${c.routes.map((o,i)=>`${"AB"[i]}. ${o[0]} (${o[1]}): ${o[2]}`).join("\n")}
Decide which destination (A or B) the student chose, and judge the route items using that destination's answers.`;
  else if (c.type === "chat") ctx = `The student is on a phone call with an American friend, ${c.friend}. This is small talk.
Mission: ${c.front}
The student should: ${c.options.join(" ")} Goal: ${c.condition}
Judge the student's side only. Count an item as reached if the student did it at least once, in any words.`;
  else ctx = `The student is ordering food at McDonald's from a crew member.
Mission: ${c.front}
The student should: ${c.options.join(" ")} ${c.condition}
Judge the student's side only. Count an item as reached if it clearly happened in the conversation, in any words.`;
  return `You are judging a short English conversation by a Korean student practicing English.

${ctx}

Checklist:
${list}

Conversation:
${tx}

Tasks:
1. For each of the ${c.items.length} checklist items, decide whether it was clearly reached. Ignore grammar. Accept other natural wording.
2. result is "SUCCESS" if all items are reached, otherwise "NOT YET".
3. The transcript comes from speech recognition, which may already fix small grammar errors, so do not point out grammar mistakes. Instead, pick at most two things the student said and show another natural way a native speaker might say them (a richer or more casual expression). Return an empty list if nothing fits.

Return only JSON: {"choice":"A"|"B"|"","items":[true,false,...],"result":"SUCCESS"|"NOT YET","tips":[{"original":"...","better":"..."}]}`;
}


const ENDPOINTS = ["https://opencode.ai/zen/v1/chat/completions", "https://opencode.ai/zen/go/v1/chat/completions"];
const MODEL = process.env.JUDGE_MODEL || "deepseek-v4.1-flash";

async function callLLM(prompt) {
  let last;
  const session = require("crypto").randomUUID();
  for (const url of ENDPOINTS) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.OPENCODE_API_KEY}`, "x-opencode-session": session, "User-Agent": "speaking-missions-judge/1.0" },
      body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: 800,
        messages: [{ role: "system", content: "You are a fair English-speaking-task judge. Reply with JSON only." }, { role: "user", content: prompt }] })
    });
    if ([401, 402, 403, 404].includes(r.status)) { last = r.status; continue; }
    if (!r.ok) { const t = await r.text(); throw new Error("llm_" + r.status + " " + t.slice(0, 300)); }
    const j = await r.json();
    const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("bad_json " + JSON.stringify({ finish: j.choices && j.choices[0] && j.choices[0].finish_reason, content: text.slice(0, 200), keys: Object.keys((j.choices && j.choices[0] && j.choices[0].message) || {}), usage: j.usage }));
    return JSON.parse(m[0]);
  }
  throw new Error("auth_" + last);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!process.env.OPENCODE_API_KEY || !process.env.JUDGE_PIN) return res.status(500).json({ error: "not_configured" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const { mission, transcript, pin } = body || {};
  if (String(pin || "") !== String(process.env.JUDGE_PIN)) return res.status(401).json({ error: "pin" });
  const c = MISSIONS[Number(mission)];
  const tx = String(transcript || "").slice(0, 8000).trim();
  if (!c || !tx) return res.status(400).json({ error: "input" });
  try { res.status(200).json(await callLLM(buildPrompt(c, tx))); }
  catch (e) { res.status(502).json({ error: String(e.message || e) }); }
};
