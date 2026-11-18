const ALLOWED_HOSTS = [
  'www.siamzone.com',
  'siamzone.com',
  'music.163.com',
  'html.duckduckgo.com',
  'www.bing.com'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('Missing url parameter', { status: 400, headers: CORS });
    let parsed;
    try {
      parsed = new URL(target);
    } catch (e) {
      return new Response('Invalid url', { status: 400, headers: CORS });
    }
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return new Response('Host not allowed', { status: 403, headers: CORS });
    }
    const upstream = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'th,en;q=0.8' },
      redirect: 'follow'
    });
    const headers = new Headers(upstream.headers);
    for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
    headers.delete('content-encoding');
    return new Response(upstream.body, { status: upstream.status, headers });
  }
};
