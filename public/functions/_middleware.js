/**
 * ChatWave Cloudflare Pages Functions Middleware
 * 
 * Architecture:
 * - Static files served by Cloudflare Pages (HTML, CSS, JS, assets)
 * - API requests (/api/*) proxied to the backend Node.js server
 * - WebSocket (/socket.io/*) proxied to the backend
 * - Admin panel (/host/*) served as static SPA from Pages
 * 
 * This middleware handles CORS and route rewriting.
 */

const BACKEND_URL = 'http://app:3000'; // Docker internal network
const BACKEND_PUBLIC_URL = ''; // Set via env SOCKET_SERVER_URL

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Allow-Credentials': 'true',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // API proxy to backend
  if (path.startsWith('/api/') || path.startsWith('/socket.io/')) {
    const backendUrl = env.SOCKET_SERVER_URL || BACKEND_PUBLIC_URL;
    if (backendUrl) {
      // Forward to external backend
      const targetUrl = backendUrl + path + url.search;
      const proxyReq = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' ? request.body : undefined,
      });
      return fetch(proxyReq);
    }
    // Fallback: try internal Docker network
    const internalUrl = `http://localhost:3000${path}${url.search}`;
    const proxyReq = new Request(internalUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });
    try {
      const response = await fetch(proxyReq);
      const respHeaders = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([k, v]) => respHeaders.set(k, v));
      return new Response(response.body, { status: response.status, headers: respHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Backend unavailable', path }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }

  // Serve static files normally
  const response = await next();
  const respHeaders = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => respHeaders.set(k, v));
  return new Response(response.body, { status: response.status, headers: respHeaders });
}
