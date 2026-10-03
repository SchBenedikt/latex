function isolated(response) {
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/engine/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      const assetPath = url.pathname.slice('/engine/'.length);
      if (!assetPath || assetPath.split('/').includes('..') || !/^[a-zA-Z0-9_./-]+$/.test(assetPath)) {
        return new Response('Invalid compiler asset path', { status: 400 });
      }
      const manifestResponse = await env.ASSETS.fetch(new URL('/engine-data/manifest.json', url.origin));
      if (!manifestResponse.ok) return new Response('Compiler runtime manifest not found', { status: 503 });
      const manifest = await manifestResponse.json();
      const asset = manifest.assets.find((entry) => `tl2025/${entry.asset}` === assetPath);
      if (!asset) return new Response('Compiler asset not found', { status: 404 });
      const parts = Array.from({ length: asset.chunks }, (_, index) => ({ index, size: Math.min(20 * 1024 * 1024, asset.size - index * 20 * 1024 * 1024) }));
      const fullSize = asset.size;

      const rangeHeader = request.headers.get('range');
      let start = 0;
      let end = fullSize - 1;
      let status = 200;
      if (rangeHeader) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
        if (!match) return new Response('Unsupported byte range', { status: 416, headers: { 'Content-Range': `bytes */${fullSize}` } });
        start = Number(match[1]);
        if (match[2]) end = Number(match[2]);
        if (start > end || end >= fullSize) return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${fullSize}` } });
        status = 206;
      }
      const chunks = [];
      let offset = 0;
      for (const part of parts) {
        const partStart = offset;
        const partEnd = offset + part.size - 1;
        offset += part.size;
        if (partEnd < start || partStart > end) continue;
        const partUrl = new URL(`/engine-data/${assetPath}.part${String(part.index).padStart(3, '0')}`, url.origin);
        const from = Math.max(0, start - partStart);
        const to = Math.min(part.size, end - partStart + 1);
        const partHeaders = new Headers();
        if (status === 206) partHeaders.set('range', `bytes=${from}-${to - 1}`);
        const response = await env.ASSETS.fetch(new Request(partUrl, { headers: partHeaders }));
        if (!response.ok) return new Response('Compiler asset chunk could not be read', { status: 502 });
        const data = new Uint8Array(await response.arrayBuffer());
        // Static asset bindings honor Range. Keep a safe fallback for local/older
        // runtimes that return a whole chunk despite the range request.
        chunks.push(response.status === 206 ? data : data.subarray(from, to));
      }
      const responseHeaders = new Headers({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'Content-Length': String(end - start + 1),
        'Content-Type': assetPath.endsWith('.wasm') ? 'application/wasm' : assetPath.endsWith('.json') ? 'application/json' : assetPath.endsWith('.js') ? 'application/javascript' : 'application/octet-stream',
      });
      if (status === 206) responseHeaders.set('Content-Range', `bytes ${start}-${end}/${fullSize}`);
      responseHeaders.set('Cross-Origin-Resource-Policy', 'same-origin');
      return new Response(request.method === 'HEAD' ? null : new Blob(chunks), { status, headers: responseHeaders });
    }
    return isolated(await env.ASSETS.fetch(request));
  },
};
