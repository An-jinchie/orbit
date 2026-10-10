// POST /api/tts
// Turns a short piece of script into natural speech with Gemini text-to-speech.
// Same sign-in check and daily limit as /api/ai. The Gemini key never leaves the server.

const { clean } = require('./_persona.js');

const MODELS = [process.env.GEMINI_TTS_MODEL, 'gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-2.5-pro-preview-tts']
  .filter(Boolean)
  .filter((m, i, a) => a.indexOf(m) === i);
const DAILY = parseInt(process.env.AI_DAILY_LIMIT || '120', 10);
const VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Sulafat', 'Achird', 'Aoede', 'Leda', 'Orus', 'Fenrir', 'Gacrux', 'Vindemiatrix', 'Sadaltager', 'Algieba'];
const MAX_CHARS = 800; // keeps each reply under Vercel's 4.5 MB response limit

function send(res, code, obj) {
  res.status(code).json(obj);
}

// Gemini sometimes returns raw 16-bit PCM instead of a finished WAV file. Wrap it so any browser can play it.
function toWav(buf, mime) {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF') return buf;
  const m = /rate=(\d+)/i.exec(mime || '');
  const rate = m ? parseInt(m[1], 10) : 24000;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  return Buffer.concat([h, buf]);
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
    const who = await fetch(SU + '/auth/v1/user', { headers: { apikey: AK, Authorization: auth } });
    if (!who.ok) return send(res, 401, { error: 'session_expired' });

    let b = req.body;
    if (typeof b === 'string') b = JSON.parse(b);
    b = b || {};

    let text;
    let speechConfig;
    let ix; // the same request, shaped for Google's newer Interactions API
    if (b.mode === 'duo') {
      const lines = Array.isArray(b.lines) ? b.lines : [];
      if (!lines.length || lines.length > 12) return send(res, 400, { error: 'invalid_request' });
      const out = [];
      for (const l of lines) {
        const t = clean(l && l.text, MAX_CHARS);
        if (!t) return send(res, 400, { error: 'invalid_request' });
        out.push((l.who === 'B' ? 'Sam' : 'Alex') + ': ' + t);
        (ix = ix || { lines: [] }).lines.push({ speaker: l.who === 'B' ? 'Sam' : 'Alex', text: t });
      }
      text = 'Read this conversation between two friendly hosts of a study podcast, naturally and warmly:\n' + out.join('\n');
      const va = VOICES.includes(b.voiceA) ? b.voiceA : 'Sulafat';
      const vb = VOICES.includes(b.voiceB) ? b.voiceB : 'Puck';
      ix.va = va; ix.vb = vb;
      speechConfig = {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: 'Alex', voiceConfig: { prebuiltVoiceConfig: { voiceName: va } } },
            { speaker: 'Sam', voiceConfig: { prebuiltVoiceConfig: { voiceName: vb } } },
          ],
        },
      };
    } else {
      const t = clean(b.text, MAX_CHARS);
      if (!t) return send(res, 400, { error: 'invalid_request' });
      text = 'Say this in a warm, clear, unhurried teacher voice, like explaining to a friend:\n' + t;
      const v = VOICES.includes(b.voice) ? b.voice : 'Sulafat';
      ix = { single: t, voice: v };
      speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: v } } };
    }
    if (text.length > MAX_CHARS * 2 + 400) return send(res, 413, { error: 'prompt_too_large' });

    const bump = await fetch(SU + '/rest/v1/rpc/bump_ai_usage', {
      method: 'POST',
      headers: { apikey: AK, Authorization: auth, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!bump.ok) return send(res, 500, { error: 'upstream_error' });
    if (Number(await bump.json()) > DAILY) return send(res, 429, { error: 'rate_limited' });

    const payload = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig },
    });
    let lastDetail = '';
    let sawBusy = false;
    for (const model of MODELS) {
      const r = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GK }, body: payload }
      );
      if (!r.ok) {
        const t = (await r.text()).slice(0, 400);
        console.error('tts error', model, r.status, t);
        let msg = '';
        try { msg = JSON.parse(t).error.message || ''; } catch (e) { msg = t; }
        lastDetail = (model + ': ' + r.status + ' ' + msg).slice(0, 220);
        if (r.status === 429) sawBusy = true;
        continue;
      }
      const d = await r.json();
      const part = d.candidates && d.candidates[0] && d.candidates[0].content && (d.candidates[0].content.parts || []).find((p) => p.inlineData && p.inlineData.data);
      if (!part) { lastDetail = model + ': no audio returned'; continue; }
      const wav = toWav(Buffer.from(part.inlineData.data, 'base64'), part.inlineData.mimeType);
      return send(res, 200, { audio: wav.toString('base64'), mime: 'audio/wav' });
    }
    // Fallback: Google's newer Interactions API, in case these models are not offered through generateContent.
    if (!sawBusy) {
      const body = ix.single !== undefined
        ? {
            input: [{ type: 'user_input', content: [{ type: 'text', text: ix.single, annotations: [{ type: 'speech_metadata', style: 'warm, clear and unhurried, like a friendly teacher' }] }] }],
            response_format: { type: 'audio' },
            generation_config: { speech_config: [{ voice: ix.voice }] },
          }
        : {
            input: [{ type: 'user_input', content: ix.lines.map((l) => ({ type: 'text', text: l.text, annotations: [{ type: 'speech_metadata', speaker: l.speaker }] })) }],
            response_format: { type: 'audio' },
            generation_config: { speech_config: { mode: 'conversational', speakers: [{ speaker: 'Alex', voice: ix.va }, { speaker: 'Sam', voice: ix.vb }] } },
          };
      for (const model of MODELS.slice(0, 2)) {
        const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GK },
          body: JSON.stringify(Object.assign({ model }, body)),
        });
        if (!r.ok) {
          const t = (await r.text()).slice(0, 300);
          console.error('tts interactions error', model, r.status, t);
          let msg = '';
          try { msg = JSON.parse(t).error.message || ''; } catch (e) { msg = t; }
          lastDetail = (model + ' (interactions): ' + r.status + ' ' + msg).slice(0, 220);
          if (r.status === 429) sawBusy = true;
          continue;
        }
        const d = await r.json();
        let hit = null;
        for (const st of d.steps || []) for (const c of st.content || []) if (c && c.data && (c.type === 'audio' || /audio/.test(c.mime_type || ''))) hit = c;
        if (!hit) { lastDetail = model + ' (interactions): no audio returned'; continue; }
        const wav = toWav(Buffer.from(hit.data, 'base64'), hit.mime_type);
        return send(res, 200, { audio: wav.toString('base64'), mime: 'audio/wav' });
      }
    }
    if (sawBusy) return send(res, 429, { error: 'provider_busy', detail: lastDetail });
    return send(res, 502, { error: 'tts_unavailable', detail: lastDetail });
  } catch (e) {
    console.error('tts handler', e && e.message);
    return send(res, 500, { error: 'upstream_error' });
  }
};
module.exports.toWav = toWav;
