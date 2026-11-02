import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const write = (path, value) => writeFile(new URL(path, root), value);
const source = await read('public/index.html');
const html = source.replace('<head>', '<head>\n<meta name="vibe-runtime" content="pages">')
  .replaceAll('href="/favicon.svg"', 'href="./public/favicon.svg"')
  .replaceAll('href="/style.css"', 'href="./public/style.css"')
  .replaceAll('src="/app.js"', 'src="./public/app.js"')
  .replaceAll('href="/"', 'href="./"')
  .replaceAll('href="/admin"', 'href="./admin/"');
await write('index.html', html);
await mkdir(new URL('admin/', root), { recursive: true });
const admin = (await read('public/admin.html'))
  .replace('<head>', '<head><meta name="vibe-runtime" content="pages">')
  .replaceAll('href="/favicon.svg"', 'href="../public/favicon.svg"')
  .replaceAll('href="/style.css"', 'href="../public/style.css"')
  .replaceAll('src="/admin.js"', 'src="../public/admin.js"')
  .replaceAll('href="/"', 'href="../"');
await write('admin/index.html', admin);
console.log(`GitHub Pages entry generated at ${fileURLToPath(new URL('index.html', root))}`);
