// GET /api/config
// Hands the browser the public Supabase address and anon key. Both are safe to expose.
// Data is protected by the row level security rules in supabase/schema.sql.

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    url: process.env.SUPABASE_URL || '',
    anon: process.env.SUPABASE_ANON_KEY || '',
  });
};
