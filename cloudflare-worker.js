/*
 * Proxy CORS para las APIs de Roblox.
 *
 * Hace falta porque users.roblox.com y thumbnails.roblox.com NO mandan
 * cabeceras Access-Control-Allow-Origin, asi que el navegador bloquea
 * cualquier fetch hecho desde la pagina.
 *
 * Ademas Roblox estrangula las IPs de Cloudflare, que son compartidas por
 * muchisima gente, y devuelve 429 "Too many requests" a la segunda o
 * tercera peticion. Por eso el worker cachea las respuestas y reintenta
 * los 429 con espera creciente. La espera no gasta CPU, asi que no cuenta
 * para el limite de 10ms del plan gratuito.
 *
 * COMO DESPLEGARLO (gratis, 100.000 peticiones/dia):
 *   1. Entra en https://dash.cloudflare.com  ->  Compute (Workers)
 *   2. Create  ->  Start with Hello World!  ->  Deploy
 *   3. Edit code, borra todo, pega este archivo y Deploy otra vez
 *   4. Copia la URL que te da (algo tipo
 *      https://mi-worker.TU-USUARIO.workers.dev)
 *   5. En index.html pon esa URL en WORKER_PROXY, con /?url= al final:
 *      const WORKER_PROXY = 'https://mi-worker.TU-USUARIO.workers.dev/?url=';
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Cuantas veces reintentar un 429, y cuanto esperar entre intentos.
const REINTENTOS = 3;
const ESPERA_BASE = 300;   // 300ms, 600ms, 1200ms

// Cuanto guardamos una respuesta buena. Los nombres y avatares de Roblox
// no cambian de un minuto a otro, y cachear es lo que de verdad evita
// los 429: la mayoria de busquedas repetidas ni llegan a Roblox.
const CACHE_SEGUNDOS = 600;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedirARoblox(target, metodo, cuerpo) {
  let ultima;
  for (let intento = 0; intento <= REINTENTOS; intento++) {
    ultima = await fetch(target, {
      method: metodo,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: cuerpo || undefined,
    });
    if (ultima.status !== 429) return ultima;
    if (intento < REINTENTOS) await dormir(ESPERA_BASE * 2 ** intento);
  }
  return ultima;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const target = new URL(request.url).searchParams.get('url');
    if (!target) {
      return new Response('Falta el parametro ?url=', { status: 400, headers: CORS });
    }

    // Solo dejamos pasar Roblox, para que nadie use tu worker
    // como proxy abierto y te gaste la cuota.
    let host;
    try {
      host = new URL(target).hostname;
    } catch {
      return new Response('URL invalida', { status: 400, headers: CORS });
    }
    if (host !== 'roblox.com' && !host.endsWith('.roblox.com')) {
      return new Response('Host no permitido', { status: 403, headers: CORS });
    }

    const cuerpo = request.method === 'POST' ? await request.text() : '';

    // La clave incluye el cuerpo, porque en el POST de nombres el usuario
    // buscado va ahi y no en la URL.
    const cache = caches.default;
    const clave = new Request(
      'https://cache.interno/' + encodeURIComponent(target + '|' + cuerpo),
      { method: 'GET' }
    );

    const cacheada = await cache.match(clave);
    if (cacheada) {
      const r = new Response(cacheada.body, cacheada);
      r.headers.set('X-Cache', 'HIT');
      return r;
    }

    const upstream = await pedirARoblox(target, request.method, cuerpo);
    const texto = await upstream.text();

    const respuesta = new Response(texto, {
      status: upstream.status,
      headers: {
        ...CORS,
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_SEGUNDOS}`,
        'X-Cache': 'MISS',
      },
    });

    // Solo se cachea lo que salio bien: un 429 cacheado seria peor que nada.
    if (upstream.ok) {
      ctx.waitUntil(cache.put(clave, respuesta.clone()));
    }

    return respuesta;
  },
};
