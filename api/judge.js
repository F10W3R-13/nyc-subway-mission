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
1. For each of the ${c.items.length} checklist items, decide whether it was clearly reached. Ignore grammar and accept any natural wording. Give the student's own words that show it (or "" if none) and a short reason in Korean.
2. The transcript comes from speech recognition, which may already fix small grammar errors, so do not point out grammar mistakes.
3. Write feedback for a Korean student who just finished high school, in friendly, encouraging Korean (English examples stay in English):
   - summary: 2 sentences on how the conversation went overall.
   - strengths: up to 2 things the student did well, each with the student's quote and why it worked.
   - tips: up to 3 things the student said, each with a more natural way a native speaker might say it and a short Korean explanation of when or why to use it.
   - next: one concrete thing to try in the next conversation, with an English example sentence.

Return only JSON:
{"choice":"A"|"B"|"","items":[{"done":true,"evidence":"...","note":"..."}],"summary":"...","strengths":[{"quote":"...","why":"..."}],"tips":[{"original":"...","better":"...","why":"..."}],"next":"..."}`;
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
      body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 32000, reasoning_effort: "low",
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
  try {
    const prompt = buildPrompt(c, tx), N = 3;
    const runs = (await Promise.allSettled(Array.from({ length: N }, () => callLLM(prompt))))
      .filter(x => x.status === "fulfilled" && Array.isArray(x.value.items)).map(x => x.value);
    if (!runs.length) throw new Error("no_runs");
    const done = r => c.items.map((_, i) => !!(r.items[i] && (r.items[i].done ?? r.items[i])));
    const votes = c.items.map((_, i) => runs.filter(r => done(r)[i]).length);
    const majority = votes.map(v => v * 2 > runs.length);
    const ch = {}; runs.forEach(r => { ch[r.choice || ""] = (ch[r.choice || ""] || 0) + 1; });
    const choice = Object.keys(ch).sort((x, y) => ch[y] - ch[x])[0];
    const best = runs.map(r => ({ r, agree: done(r).filter((d, i) => d === majority[i]).length })).sort((x, y) => y.agree - x.agree)[0].r;
    res.status(200).json({ ...best, choice, runs: runs.length,
      items: c.items.map((_, i) => ({ ...(typeof best.items[i] === "object" ? best.items[i] : {}), done: majority[i], votes: votes[i] })),
      result: majority.every(Boolean) ? "SUCCESS" : "NOT YET" });
  }
  catch (e) { res.status(502).json({ error: String(e.message || e) }); }
};
