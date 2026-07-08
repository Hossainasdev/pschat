/**
 * ChatWave Cloudflare Workers API
 * Handles REST endpoints + WebSocket upgrade for real-time chat
 * 
 * Architecture:
 * - Cloudflare Pages serves static frontend
 * - This Worker handles API routes and WebSocket connections
 * - D1 database for persistent storage
 * - R2 bucket for file uploads
 * - For full Socket.io support, the Docker backend runs alongside
 */

// WebSocket connections store
let wsConnections = {};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // WebSocket upgrade for real-time chat (fallback when Docker backend is used)
    if (path === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      return handleWebSocket(request, env);
    }

    // API Routes
    const headers = { ...corsHeaders, 'Content-Type': 'application/json' };

    // Admin login
    if (path === '/api/admin/login' && request.method === 'POST') {
      const body = await request.json();
      if (body.username === env.ADMIN_USER && body.password === env.ADMIN_PASS) {
        return new Response(JSON.stringify({ success: true, token: 'admin-token-' + Date.now() }), { headers });
      }
      return new Response(JSON.stringify({ success: false, error: 'Invalid credentials' }), { status: 401, headers });
    }

    // Admin data
    if (path === '/api/admin/data' && request.method === 'GET') {
      const auth = request.headers.get('Authorization');
      if (!auth?.startsWith('admin-token-')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
      }
      try {
        const users = await env.DB.prepare('SELECT * FROM users ORDER BY last_seen DESC').all();
        const rooms = await env.DB.prepare('SELECT * FROM rooms ORDER BY created_at DESC').all();
        const stats = {
          users: users.results?.length || 0,
          online: users.results?.filter(u => u.online).length || 0,
          rooms: rooms.results?.length || 0,
        };
        return new Response(JSON.stringify({
          users: users.results || [],
          rooms: rooms.results || [],
          messages: {},
          collectedData: {},
          onlineCount: stats.online,
          stats
        }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, users: [], rooms: [], onlineCount: 0 }), { headers });
      }
    }

    // Messages for a room
    if (path.startsWith('/api/admin/messages/') && request.method === 'GET') {
      const auth = request.headers.get('Authorization');
      if (!auth?.startsWith('admin-token-')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers });
      }
      const roomId = path.replace('/api/admin/messages/', '');
      try {
        const msgs = await env.DB.prepare('SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT 500').bind(roomId).all();
        return new Response(JSON.stringify({ messages: (msgs.results || []).reverse() }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ messages: [] }), { headers });
      }
    }

    // File upload to R2
    if (path === '/api/upload' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { file, fileName, mimeType } = body;
        if (!file) return new Response(JSON.stringify({ error: 'No file' }), { status: 400, headers });

        const id = crypto.randomUUID().slice(0, 12);
        const ext = (fileName || 'file.bin').split('.').pop() || 'bin';
        const key = `uploads/${id}.${ext}`;

        // Store in R2
        const buffer = Uint8Array.from(atob(file), c => c.charCodeAt(0));
        await env.UPLOADS.put(key, buffer, {
          httpMetadata: { contentType: mimeType || 'application/octet-stream' }
        });

        const url = `/uploads/${id}.${ext}`;
        return new Response(JSON.stringify({ url, name: fileName, type: mimeType }), { headers });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
      }
    }

    // Serve uploaded files from R2
    if (path.startsWith('/uploads/')) {
      const key = path.slice(1);
      try {
        const obj = await env.UPLOADS.get(key);
        if (obj === null) return new Response('Not Found', { status: 404 });
        return new Response(obj.body, {
          headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000' }
        });
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    }

    // Health check
    if (path === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), { headers });
    }

    // Fallback: try to serve static files from Pages or pass through to Docker backend
    return new Response(JSON.stringify({ error: 'Not found', path }), { status: 404, headers });
  }
};

// WebSocket handler for real-time communication fallback
async function handleWebSocket(request, env) {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  server.addEventListener('message', async (event) => {
    try {
      const data = JSON.parse(event.data);
      // Handle different message types
      switch (data.type) {
        case 'ping':
          server.send(JSON.stringify({ type: 'pong' }));
          break;
        case 'init':
          server.send(JSON.stringify({ type: 'init', userId: data.userId || 'anon' }));
          break;
        default:
          server.send(JSON.stringify({ type: 'echo', data: data.payload }));
      }
    } catch (e) {
      server.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  server.addEventListener('close', () => {});
  server.addEventListener('error', () => {});

  return new Response(null, { status: 101, webSocket: client });
}
