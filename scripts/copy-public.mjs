import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const src = join(process.cwd(), 'public');
const dest = join(process.cwd(), 'dist', 'public');

if (!existsSync(src)) {
  console.error('public/ not found');
  process.exit(1);
}

cpSync(src, dest, { recursive: true });
console.log('Copied public/ to dist/public/');
