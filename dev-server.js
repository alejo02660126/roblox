/*
 * Servidor de pruebas local. Hace en tu PC lo mismo que hara el Worker
 * de Cloudflare, para que puedas probar la pagina antes de desplegarlo.
 *
 *   node dev-server.js
 *   y abres http://localhost:8080
 *
 * Sirve los archivos de esta carpeta y ademas expone /proxy?url=... que
 * reenvia a las APIs de Roblox. Como el proxy vive en el mismo origen
 * que la pagina, no hay CORS que valga y funciona sin instalar nada.
 *
 * Al servir index.html sustituye WORKER_PROXY al vuelo, asi que NO hay
 * que tocar ni revertir nada en el archivo.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const DIR = __dirname;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── El proxy, igual de restringido que el Worker ──
  if (url.pathname === '/proxy') {
    const target = url.searchParams.get('url');
    if (!target) return res.writeHead(400).end('Falta ?url=');

    let host;
    try { host = new URL(target).hostname; }
    catch { return res.writeHead(400).end('URL invalida'); }

    if (host !== 'roblox.com' && !host.endsWith('.roblox.com')) {
      return res.writeHead(403).end('Host no permitido');
    }

    try {
      // Igual que el Worker: reenvia el metodo y el cuerpo tal cual,
      // que la busqueda por nombre exacto va por POST.
      let entrada;
      if (req.method === 'POST') {
        entrada = await new Promise((ok) => {
          let d = '';
          req.on('data', (c) => (d += c));
          req.on('end', () => ok(d));
        });
      }
      const r = await fetch(target, {
        method: req.method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: entrada,
      });
      const cuerpo = await r.text();
      console.log(`  proxy ${r.status}  ${req.method}  ${target.slice(0, 80)}`);
      res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(cuerpo);
    } catch (e) {
      console.log(`  proxy ERROR  ${e.message}`);
      res.writeHead(502).end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Archivos estaticos ──
  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  const archivo = path.join(DIR, rel);
  if (!archivo.startsWith(DIR)) return res.writeHead(403).end('Fuera de la carpeta');

  fs.readFile(archivo, (err, datos) => {
    if (err) return res.writeHead(404).end('No encontrado: ' + rel);

    if (archivo.endsWith('index.html')) {
      // Apuntamos la pagina al proxy local sin tocar el archivo en disco,
      // valga lo que valga WORKER_PROXY (vacio o ya con el Worker puesto).
      datos = Buffer.from(
        datos.toString('utf8').replace(
          /^const WORKER_PROXY = .*$/m,
          "const WORKER_PROXY = '/proxy?url=';"
        ),
        'utf8'
      );
    }

    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' })
       .end(datos);
  });
});

servidor.listen(PORT, () => {
  console.log(`\n  Pagina de pruebas en  http://localhost:${PORT}`);
  console.log(`  Proxy local activo en /proxy?url=...`);
  console.log(`  Ctrl+C para parar\n`);
});
