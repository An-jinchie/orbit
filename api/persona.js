// GET /api/persona
// Returns the owner's personal teaching style to the account whose email matches OWNER_EMAIL.
// Everyone else gets an empty string and starts from the neutral default in the app.

const OWNER_STYLE = require('./_owner.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const SU = process.env.SUPABASE_URL;
  const AK = process.env.SUPABASE_ANON_KEY;
  const owner = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!SU || !AK) return res.status(500).json({ error: 'not_configured' });
  const auth = req.headers.authorization || '';
  if (!/^Bearer\s+\S+/.test(auth)) return res.status(401).json({ error: 'session_expired' });
  try {
    const u = await fetch(SU + '/auth/v1/user', { headers: { apikey: AK, Authorization: auth } });
    if (!u.ok) return res.status(401).json({ error: 'session_expired' });
    const me = await u.json();
    const mine = !!owner && String(me.email || '').toLowerCase() === owner;
    return res.status(200).json({ style: mine ? OWNER_STYLE : '' });
  } catch (e) {
    return res.status(500).json({ error: 'upstream_error' });
  }
};
