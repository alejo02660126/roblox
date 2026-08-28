/*
 * Proxy CORS para las APIs de Roblox.
 *
 * Hace falta porque users.roblox.com y thumbnails.roblox.com NO mandan
 * cabeceras Access-Control-Allow-Origin, asi que el navegador bloquea
 * cualquier fetch hecho desde la pagina.
 *
 * COMO DESPLEGARLO (gratis, 100.000 peticiones/dia):
 *   1. Entra en https://dash.cloudflare.com  ->  Workers & Pages
 *   2. Create  ->  Start with Hello World!  ->  Deploy
 *   3. Edit code, borra todo, pega este archivo y Deploy otra vez
 *   4. Copia la URL que te da (algo tipo
 *      https://mi-worker.TU-USUARIO.workers.dev)
 *   5. En index.html pon esa URL en WORKER_PROXY, con /?url= al final:
 *      const WORKER_PROXY = 'https://mi-worker.TU-USUARIO.workers.dev/?url=';
 */

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) {
      return new Response('Falta el parametro ?url=', { status: 400, headers: cors });
    }

    // Solo dejamos pasar Roblox, para que nadie use tu worker
    // como proxy abierto y te gaste la cuota.
    let host;
    try {
      host = new URL(target).hostname;
    } catch {
      return new Response('URL invalida', { status: 400, headers: cors });
    }
    if (host !== 'roblox.com' && !host.endsWith('.roblox.com')) {
      return new Response('Host no permitido', { status: 403, headers: cors });
    }

    const upstream = await fetch(target, {
      method: request.method,
      headers: { 'Accept': 'application/json' },
      body: request.method === 'POST' ? await request.text() : undefined,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  },
};
