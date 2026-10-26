/** Inspect tracked content only; never print matching credentials. */
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const issues = [];
const blocked = /(^|\/)(?:\.env(?:\..*)?|\.vercel|\.codegraph|\.cursor|\.agents|\.codex|\.mcp\.json|node_modules|\.next|generated)(?:\/|$)|^(?:backups|uploads|exports|screenshots|test-results)\/|\.(?:sqlite\w*|db|dump|backup|pem|key|p12|pfx|har|log|pdf)$/i;
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['provider credential', /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|sb_secret_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{24,})\b/],
  ['literal PostgreSQL credentials', /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@[^\s"'`]+/],
  ['personal home path', /(?:\/Users\/|\/home\/)[a-z][a-z0-9_.-]{1,}\//i],
  ['literal database row export', /^(?:COPY .+ FROM stdin;|INSERT INTO .+ VALUES\s*\()/mi],
];
for (const file of files) {
  if (file !== '.env.example' && blocked.test(file)) issues.push([file, 'private file type or generated directory']);
  if (lstatSync(file).isSymbolicLink()) { issues.push([file, 'symlink']); continue; }
  const buffer = readFileSync(file);
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');
  for (const [label, pattern] of rules) if (pattern.test(text)) issues.push([file, label]);
}
// Optional exact-match audit against a private environment, without echoing values.
// This environment file is never copied into the repository or uploaded.
const privateEnvIndex = process.argv.indexOf('--private-env');
if (privateEnvIndex >= 0) {
  const contents = readFileSync(process.argv[privateEnvIndex + 1], 'utf8');
  const sensitive = new Set();
  for (const line of contents.split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || !/(?:SECRET|KEY|PASSWORD|TOKEN|DATABASE_URL|POSTGRES.*URL|SUPABASE_URL|APP_URL|WEB_PUSH_SUBJECT)/.test(match[1])) continue;
    const value = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (value.length >= 12) sensitive.add(value);
    try {
      const url = new URL(value);
      if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && /(?:postgres|supabase|APP_URL|SUBJECT)/i.test(match[1])) {
        sensitive.add(url.hostname);
        if (url.password.length >= 8) sensitive.add(decodeURIComponent(url.password));
        if (url.username.includes('.')) sensitive.add(url.username.split('.').at(-1));
      }
    } catch { /* not a URL */ }
  }
  for (const file of files) {
    const buffer = readFileSync(file); if (buffer.includes(0)) continue;
    if ([...sensitive].some(value => value.length >= 8 && buffer.toString('utf8').includes(value))) issues.push([file, 'private environment value']);
  }
}
if (issues.length) {
  console.error('Release check failed (values redacted):');
  for (const [file, reason] of issues) console.error(`${file}: ${reason}`);
  process.exitCode = 1;
} else console.log(`Release privacy check passed: ${files.length} tracked files; no private file types or matching credentials.`);
