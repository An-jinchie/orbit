// POST /api/ai
// Checks the caller is a signed-in Orbit user, applies a daily limit, then asks Gemini.
// The Gemini key never leaves the server.

const { systemFor, clean } = require('./_persona.js');

// Tried in order. The first one that works is used. Set GEMINI_MODEL to put your own choice first.
const MODELS = [process.env.GEMINI_MODEL, 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.1-flash-lite']
  .filter(Boolean)
  .filter((m, i, a) => a.indexOf(m) === i);
const DAILY = parseInt(process.env.AI_DAILY_LIMIT || '120', 10);
const MIMES = ['image/jpeg', 'image/png', 'image/webp'];

function send(res, code, obj) {
  res.status(code).json(obj);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });

  const SU = process.env.SUPABASE_URL;
  const AK = process.env.SUPABASE_ANON_KEY;
  const GK = process.env.GEMINI_API_KEY;
  if (!SU || !AK || !GK) return send(res, 500, { error: 'not_configured' });

  const auth = req.headers.authorization || '';
  if (!/^Bearer\s+\S+/.test(auth)) return send(res, 401, { error: 'session_expired' });

  try {
    // 1. Who is calling?
    const who = await fetch(SU + '/auth/v1/user', { headers: { apikey: AK, Authorization: auth } });
    if (!who.ok) return send(res, 401, { error: 'session_expired' });

    // 2. Validate the request.
    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b);
    b = b || {};
    const json = b.mode === 'json';
    const msgs = Array.isArray(b.messages) ? b.messages : [];
    if (!msgs.length || msgs.length > 40) return send(res, 400, { error: 'invalid_request' });
    let total = 0;
    const contents = [];
    for (const m of msgs) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) {
        return send(res, 400, { error: 'invalid_request' });
      }
      total += m.content.length;
      const role = m.role === 'assistant' ? 'model' : 'user';
      const last = contents[contents.length - 1];
      if (last && last.role === role) last.parts[0].text += '\n\n' + m.content;
      else contents.push({ role, parts: [{ text: m.content }] });
    }
    if (total > 150000) return send(res, 413, { error: 'prompt_too_large' });
    if (contents[0].role !== 'user' || contents[contents.length - 1].role !== 'user') {
      return send(res, 400, { error: 'invalid_request' });
    }
    if (b.image) {
      const im = b.image;
      if (!MIMES.includes(im.mime) || typeof im.data !== 'string' || im.data.length > 3000000) {
        return send(res, 400, { error: 'image_rejected' });
      }
      contents[contents.length - 1].parts.push({ inlineData: { mimeType: im.mime, data: im.data } });
    }

    // 3. Daily limit, counted in the caller's own Supabase account.
    const bump = await fetch(SU + '/rest/v1/rpc/bump_ai_usage', {
      method: 'POST',
      headers: { apikey: AK, Authorization: auth, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!bump.ok) {
      console.error('bump_ai_usage failed', bump.status);
      return send(res, 500, { error: 'upstream_error' });
    }
    const used = Number(await bump.json());
    if (used > DAILY) return send(res, 429, { error: 'rate_limited' });

    // 4. Ask Gemini.
    const system = systemFor(b.persona, b.profile, json);
    const payload = JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: Object.assign(
        { temperature: json ? 0.4 : 0.7, maxOutputTokens: json ? 16384 : 8192 },
        json ? { responseMimeType: 'application/json' } : {}
      ),
    });
    let g = null;
    let lastDetail = '';
    let sawBusy = false;
    for (const model of MODELS) {
      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GK }, body: payload }
      );
      if (r.ok) { g = r; break; }
      const t = (await r.text()).slice(0, 400);
      console.error('gemini error', model, r.status, t);
      let msg = '';
      try { msg = JSON.parse(t).error.message || ''; } catch (e) { msg = t; }
      lastDetail = (model + ': ' + r.status + ' ' + msg).replace(/key=\S+/g, '').slice(0, 220);
      if (r.status === 429) { sawBusy = true; continue; }
      if (r.status === 400 && /api key/i.test(msg)) return send(res, 502, { error: 'bad_key', detail: lastDetail });
      continue; // not found, no access, or a hiccup: try the next model
    }
    if (!g) {
      if (sawBusy) return send(res, 429, { error: 'provider_busy', detail: lastDetail });
      return send(res, 502, { error: 'upstream_error', detail: lastDetail });
    }
    const d = await g.json();
    const cand = d.candidates && d.candidates[0];
    if (!cand || !cand.content) return send(res, 422, { error: 'refused' });
    const text = (cand.content.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) return send(res, 502, { error: 'empty_completion' });
    return send(res, 200, { text, truncated: cand.finishReason === 'MAX_TOKENS' });
  } catch (e) {
    console.error('ai handler', e && e.message);
    return send(res, 500, { error: 'upstream_error' });
  }
};
