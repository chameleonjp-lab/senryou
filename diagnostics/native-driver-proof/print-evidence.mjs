import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Print only the fixed report and its JSON attachments, never the environment. */
export function printEvidence(reportPath, write = text => process.stdout.write(text)) {
  const token = randomUUID();
  // Test errors/attachments must never be interpreted as Actions workflow commands.
  write(`::stop-commands::${token}\n`);
  try {
    const raw = readFileSync(reportPath);
    const emit = (label, bytes) => {
      const sha = createHash('sha256').update(bytes).digest('hex');
      write(`JSON_EVIDENCE_BEGIN ${JSON.stringify({ label, bytes: bytes.length, sha256: sha })}\n`);
      write(bytes.toString('utf8'));
      write(`\nJSON_EVIDENCE_END ${JSON.stringify({ label, sha256: sha })}\n`);
    };
    emit('driver-proof-results.json', raw);
    const report = JSON.parse(raw.toString('utf8'));
    const root = realpathSync(dirname(reportPath));
    let attachmentCount = 0, nativeCount = 0;
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (Array.isArray(value.attachments)) {
        for (const attachment of value.attachments) {
          if (attachment.contentType !== 'application/json') continue;
          let bytes;
          if (typeof attachment.body === 'string') bytes = Buffer.from(attachment.body, 'base64');
          else if (typeof attachment.path === 'string') {
            const file = realpathSync(resolve(attachment.path));
            const rel = relative(root, file);
            if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
              throw new Error('Refusing JSON attachment outside test-results');
            }
            bytes = readFileSync(file);
          } else throw new Error('JSON attachment has neither inline body nor file path');
          JSON.parse(bytes.toString('utf8'));
          emit(`attachment-${++attachmentCount}:${attachment.name}`, bytes);
          if (attachment.name === 'native-driver-proof.json') nativeCount++;
        }
      }
      for (const [key, child] of Object.entries(value)) if (key !== 'attachments') visit(child);
    };
    visit(report);
    write(`JSON_EVIDENCE_COUNTS ${JSON.stringify({ attachmentCount, nativeCount })}\n`);
    if (nativeCount !== 1) throw new Error(`Expected one native-driver-proof.json attachment, found ${nativeCount}`);
    write('NON_JSON_EVIDENCE_NOT_SAVED: screenshots and traces are runner-local only; no artifact upload\n');
  } finally {
    write(`::${token}::\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  printEvidence(resolve('test-results/driver-proof-results.json'));
}
