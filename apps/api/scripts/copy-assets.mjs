// Copies non-TypeScript runtime assets (Lua scripts, SQL migrations) next to the compiled output.
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const dir of ['src/lua', 'src/db/migrations']) {
  if (existsSync(`${root}/${dir}`))
    cpSync(`${root}/${dir}`, `${root}/dist/${dir}`, { recursive: true });
}
