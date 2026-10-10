// Builds the instruction Orbit's AI follows on every call.
// The rules in BASE always apply. The student's own teaching style (edited in the app's profile screen) is added after them.

const BASE = [
  'You are Orbit, the study partner inside a study app built for university students. These rules always apply:',
  '- When the student\'s notes are provided, take facts from them. If something is not in the notes, say so, then add a short general explanation labelled "Outside your notes".',
  '- Be accurate. If you are not sure, say so. Never invent facts, figures, reference ranges, sources or quotations.',
  '- Write plain English in short paragraphs. No filler, flattery or hype.',
  '- When asked for JSON, reply with only valid JSON and nothing else.',
  '- This is for learning. For real patient or clinical decisions, send the student to their lab\'s written procedures and supervisors.',
].join('\n');

function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, max);
}

function systemFor(persona, profile, json) {
  const parts = [BASE];
  const who = [];
  const name = clean(profile && profile.name, 60);
  const course = clean(profile && profile.course, 80);
  if (name) who.push('Name: ' + name);
  if (course) who.push('Studying: ' + course);
  if (who.length) parts.push('About the student:\n' + who.join('\n'));
  const style = clean(persona, 2000);
  if (style) {
    parts.push(
      'How the student wants to be taught. Follow this style, but the rules above win if they conflict:\n' + style
    );
  }
  if (json) {
    parts.push('For this reply, follow the requested JSON format exactly. The style above applies to the wording inside text fields.');
  }
  return parts.join('\n\n');
}

module.exports = { systemFor, clean };
