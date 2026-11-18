// POST /api/sessions {pin, mission}            -> recent calls for that mission's agent
// POST /api/sessions {pin, mission, sessionId} -> transcript of one call
const MISSIONS = require("../missions.json");
const FISH = "https://api.fish.audio/v1/agent/sessions";
const auth = () => ({ Authorization: `Bearer ${process.env.FISH_API_KEY}` });

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method" });
  if (!process.env.FISH_API_KEY || !process.env.JUDGE_PIN) return res.status(500).json({ error: "not_configured" });
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};
  if (String(b.pin || "") !== String(process.env.JUDGE_PIN)) return res.status(401).json({ error: "pin" });
  const m = MISSIONS[Number(b.mission)];
  if (!m || !m.agent) return res.status(400).json({ error: "input" });
  try {
    if (!b.sessionId) {
      const since = b.since && !isNaN(Date.parse(b.since)) ? `&created_after=${encodeURIComponent(new Date(b.since).toISOString())}` : "";
      const r = await fetch(`${FISH}?agent_id=${m.agent}&status=completed,active&page_size=30${since}`, { headers: auth() });
      if (!r.ok) return res.status(502).json({ error: "fish_" + r.status });
      const j = await r.json();
      return res.status(200).json({ sessions: (j.sessions || []).map(s => ({ id: s.session_id, status: s.status, started: s.started_at, seconds: s.duration_seconds, student: s.end_user_id || (s.metadata && s.metadata.student) || "" })) });
    }
    const r = await fetch(`${FISH}/${encodeURIComponent(b.sessionId)}`, { headers: auth() });
    if (!r.ok) return res.status(502).json({ error: "fish_" + r.status });
    const s = await r.json();
    if (s.agent_id && s.agent_id !== m.agent) return res.status(400).json({ error: "wrong_mission" });
    const lines = (s.items || []).filter(i => i.type === "message" && i.content)
      .map(i => `${i.role === "user" ? "Student" : "Partner"}: ${i.content}`);
    res.status(200).json({ transcript: lines.join("\n"), status: s.status });
  } catch (e) { console.error("sessions", e); res.status(502).json({ error: "fish" }); }
};
