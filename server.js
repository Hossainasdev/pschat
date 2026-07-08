require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
  },
  maxHttpBufferSize: 10 * 1024 * 1024,
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
});

// Trust proxy for Cloudflare, Render, Fly.io, etc.
app.set('trust proxy', true);

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'hoss@host';
const ADMIN_PASS = process.env.ADMIN_PASS || '@hostopenit';

// Initialize database
db.initDB();

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Admin routes
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'admin', 'index.html')));
app.use('/host', express.static(path.join(__dirname, 'admin')));

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ success: true, token: 'admin-token-' + Date.now() });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

function adminAuth(req, res, next) {
  const token = req.headers.authorization;
  if (!token || !token.startsWith('admin-token-')) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/admin/data', adminAuth, (req, res) => {
  const stats = db.getStats();
  res.json({
    users: db.getAllUsers(),
    rooms: db.getAllRooms(),
    collectedData: db.getAllCollectedData(),
    polls: db.getAllRooms().reduce((acc, r) => { acc[r.id] = db.getRoomPolls(r.id); return acc; }, {}),
    reports: { all: db.getAllReports() },
    streaks: db.getStreaks(),
    feedback: { all: db.getAllFeedback() },
    bookmarks: { count: stats.bookmarks },
    pinnedMessages: db.getAllRooms().reduce((acc, r) => { acc[r.id] = db.getPinnedMessages(r.id); return acc; }, {}),
    onlineCount: stats.online,
    stats
  });
});

app.get('/api/admin/messages/:room', adminAuth, (req, res) => {
  res.json({ messages: db.getMessages(req.params.room, 500) });
});

app.get('/api/export/:room', adminAuth, (req, res) => {
  const room = db.getRoom(req.params.room);
  const msgs = db.getMessages(req.params.room, 2000);
  res.setHeader('Content-Disposition', `attachment; filename=chat-${req.params.room}.json`);
  res.json({ room: room || {}, messages: msgs, exportedAt: new Date().toISOString() });
});

app.post('/api/upload', (req, res) => {
  const { file, fileName, mimeType } = req.body;
  if (!file) return res.status(400).json({ error: 'No file' });
  const id = uuidv4().slice(0, 12);
  const ext = (fileName || 'file.bin').split('.').pop() || 'bin';
  const fname = id + '.' + ext;
  const uploadDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  fs.writeFileSync(path.join(uploadDir, fname), Buffer.from(file, 'base64'));
  res.json({ url: '/uploads/' + fname, name: fileName, type: mimeType });
});

app.get('/api/invite/:code', (req, res) => {
  const link = db.getInvite(req.params.code);
  if (!link || link.expires_at < Date.now()) return res.status(404).json({ error: 'Invalid or expired link' });
  const room = db.getRoom(link.room_id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ roomId: link.room_id, roomName: room.name });
});

// Rate limiter
const rateLimits = {};
function checkRateLimit(userId, max = 30) {
  const now = Date.now();
  if (!rateLimits[userId]) rateLimits[userId] = [];
  rateLimits[userId] = rateLimits[userId].filter(t => now - t < 60000);
  if (rateLimits[userId].length >= max) return false;
  rateLimits[userId].push(now);
  return true;
}

// Socket.IO
io.on('connection', (socket) => {
  const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim() || socket.handshake.address || 'unknown';
  const ua = socket.handshake.headers['user-agent'] || 'unknown';
  const userId = 'u_' + uuidv4().slice(0, 7);
  const displayName = 'User_' + userId.slice(-5);

  // Store user
  db.upsertUser({
    id: userId, socketId: socket.id, username: displayName, ip, userAgent: ua,
    online: true, status: 'online', joinedAt: Date.now(), lastSeen: Date.now()
  });

  // Collect basic data
  db.saveCollectedData(userId, {
    ip, userAgent: ua, connectedAt: new Date().toISOString(),
    headers: JSON.parse(JSON.stringify(socket.handshake.headers)),
    address: socket.handshake.address
  });

  // Streak
  db.updateStreak(userId);

  // Send init data
  socket.emit('init', {
    userId, username: displayName,
    users: db.getAllUsers(),
    rooms: db.getAllRooms(),
    statuses: {},
    streaks: Object.fromEntries(db.getStreaks().map(s => [s.user_id, { count: s.count, lastDate: s.last_date }]))
  });

  // Data collection
  socket.on('collect-data', (info) => {
    const existing = db.getCollectedData(userId);
    Object.assign(existing, info, { lastUpdated: new Date().toISOString() });
    db.saveCollectedData(userId, existing);
  });

  // Join room
  socket.on('join-room', (roomId) => {
    if (db.isBanned(roomId, userId)) { socket.emit('banned', { roomId }); return; }
    socket.join(roomId);

    let room = db.getRoom(roomId);
    if (!room) {
      db.createRoom({ id: roomId, name: roomId, type: 'public', createdBy: userId, createdAt: Date.now() });
      room = db.getRoom(roomId);
    }

    const members = db.getRoomMembers(roomId);
    if (!members.includes(userId)) {
      db.addRoomMember(roomId, userId);
      // System join message
      const joinMsg = { id: uuidv4(), roomId, userId: 'system', username: 'System', text: `${displayName} joined`, timestamp: Date.now(), system: true };
      db.insertMessage(joinMsg);
      if (room.welcome_msg) {
        db.insertMessage({ id: uuidv4(), roomId, userId: 'system', username: 'System', text: room.welcome_msg, timestamp: Date.now(), system: true });
      }
    }

    const msgs = db.getMessages(roomId, 200);
    const settings = db.getRoomSettings(roomId);
    const pinned = db.getPinnedMessages(roomId);
    const moderators = db.getModerators(roomId);
    const allMembers = db.getRoomMembers(roomId);

    io.to(roomId).emit('room-joined', {
      roomId, userId, username: displayName, members: allMembers,
      messages: msgs, isPersonal: false, roomData: { ...room, moderators },
      settings, pinnedMessages: pinned,
      badges: getUserBadges(userId, roomId, moderators)
    });
    io.emit('users-update', db.getAllUsers());
  });

  // Create room
  socket.on('create-room', ({ name, type, description, welcomeMsg }) => {
    const roomId = 'room_' + uuidv4().slice(0, 6);
    db.createRoom({ id: roomId, name, type: type || 'public', createdBy: userId, createdAt: Date.now(), description, welcomeMsg });
    db.addRoomMember(roomId, userId);
    db.addModerator(roomId, userId);
    socket.join(roomId);
    const room = db.getRoom(roomId);
    io.emit('room-created', room);
    socket.emit('room-joined', {
      roomId, userId, username: displayName, members: [userId],
      messages: [], isPersonal: false, roomData: { ...room, moderators: [userId] },
      settings: db.getRoomSettings(roomId), badges: getUserBadges(userId, roomId, [userId])
    });
  });

  // Personal chat
  socket.on('start-personal', (targetId) => {
    const chatId = [userId, targetId].sort().join('_');
    socket.join(chatId);
    const ts = io.sockets.sockets.get(db.getUser(targetId)?.socket_id);
    if (ts) ts.join(chatId);
    const msgs = db.getMessages(chatId, 200);
    socket.emit('room-joined', {
      roomId: chatId, userId, username: displayName, members: [userId, targetId],
      messages: msgs, isPersonal: true, roomData: { name: `Chat with ${db.getUser(targetId)?.username || 'User'}` },
      settings: db.getRoomSettings(chatId), badges: []
    });
  });

  // Send message
  socket.on('send-message', ({ roomId, text, replyTo, fileData, isVoice }) => {
    if (!text?.trim() && !fileData) return;
    if (!checkRateLimit(userId, 30)) { socket.emit('rate-limited'); return; }

    const room = db.getRoom(roomId);
    if (room?.slow_mode > 0) {
      const msgs = db.getMessages(roomId, 1);
      const lastMsg = msgs.filter(m => m.user_id === userId).pop();
      if (lastMsg && Date.now() - lastMsg.timestamp < room.slow_mode * 1000) {
        const wait = room.slow_mode - Math.floor((Date.now() - lastMsg.timestamp) / 1000);
        socket.emit('slow-mode', { roomId, wait }); return;
      }
    }
    if (room?.read_only && room.created_by !== userId && !db.isModerator(roomId, userId)) {
      socket.emit('read-only', { roomId }); return;
    }

    // Resolve replyTo text for display
    let replyText = null;
    if (replyTo) { const rm = db.getMessage(replyTo); if (rm) replyText = rm.text; }

    const msg = db.insertMessage({
      id: uuidv4(), roomId, userId, username: displayName, text: text || '',
      timestamp: Date.now(), edited: false, replyTo: replyText,
      file: fileData || null, isVoice: isVoice || false, forward: false
    });

    const moderators = db.getModerators(roomId);
    const batch = db.getMessages(roomId, 1).pop();
    io.to(roomId).emit('new-message', {
      ...msg, roomId, file: fileData, badges: getUserBadges(userId, roomId, moderators)
    });
    db.updateStreak(userId);
  });

  // Typing
  socket.on('typing', ({ roomId, isTyping }) => {
    socket.to(roomId).emit('user-typing', { userId, username: displayName, isTyping });
  });

  // Reactions
  socket.on('react-message', ({ roomId, messageId, emoji }) => {
    db.toggleReaction(messageId, userId, emoji);
    const reactions = db.getReactions(messageId);
    io.to(roomId).emit('message-reacted', { roomId, messageId, reactions });
  });

  // Edit/Delete
  socket.on('edit-message', ({ roomId, messageId, newText }) => {
    const msg = db.getMessage(messageId);
    if (!msg || msg.user_id !== userId || !newText?.trim()) return;
    db.updateMessageText(messageId, newText);
    io.to(roomId).emit('message-edited', { roomId, messageId, newText, editedAt: Date.now() });
  });

  socket.on('delete-message', ({ roomId, messageId }) => {
    const msg = db.getMessage(messageId);
    const room = db.getRoom(roomId);
    const isMod = db.isModerator(roomId, userId);
    if (!msg) return;
    if (msg.user_id !== userId && room?.created_by !== userId && !isMod) return;
    db.deleteMessage(messageId);
    io.to(roomId).emit('message-deleted', { roomId, messageId });
  });

  // Pins
  socket.on('pin-message', ({ roomId, messageId }) => {
    const room = db.getRoom(roomId);
    const isMod = db.isModerator(roomId, userId);
    if (!room || (room.created_by !== userId && !isMod)) return;
    db.pinMessage(roomId, messageId, userId);
    const msg = db.getMessage(messageId);
    io.to(roomId).emit('message-pinned', { roomId, messageId, msg, pinnedBy: userId, pinnedByUsername: displayName });
  });

  socket.on('unpin-message', ({ roomId, messageId }) => {
    db.unpinMessage(roomId, messageId);
    io.to(roomId).emit('message-unpinned', { roomId, messageId });
  });

  // Bookmarks
  socket.on('bookmark-message', ({ messageId }) => {
    db.toggleBookmark(userId, messageId);
    socket.emit('bookmarks-updated', db.getBookmarks(userId));
  });

  // Forward
  socket.on('forward-message', ({ messageId, fromRoom, toRoom }) => {
    const msg = db.getMessage(messageId);
    if (!msg) return;
    const fwd = db.insertMessage({
      id: uuidv4(), roomId: toRoom, userId, username: displayName,
      text: `📤 Forwarded from ${msg.username}: ${msg.text}`,
      timestamp: Date.now(), forward: true,
      originalAuthor: msg.username, originalText: msg.text
    });
    io.to(toRoom).emit('new-message', { ...fwd, roomId: toRoom, badges: [] });
  });

  // Polls
  socket.on('create-poll', ({ roomId, question, options }) => {
    if (!question?.trim() || !options || options.length < 2) return;
    const pollId = uuidv4().slice(0, 8);
    db.createPoll({ id: pollId, roomId, question, createdBy: userId, options });
    const poll = db.getPoll(pollId);
    io.to(roomId).emit('poll-created', poll);
  });

  socket.on('vote-poll', ({ pollId, optionIndex, roomId }) => {
    db.votePoll(pollId, userId, optionIndex);
    const poll = db.getPoll(pollId);
    io.to(roomId).emit('poll-updated', poll);
  });

  // Status
  socket.on('set-status', ({ status, customStatus }) => {
    db.updateUserStatus(userId, status, customStatus);
    io.emit('user-status-change', { userId, status: status || 'online', customStatus: customStatus || '' });
  });

  // Room settings
  socket.on('update-room-settings', ({ roomId, settings }) => {
    db.updateRoomSettings(roomId, settings);
    io.to(roomId).emit('room-settings-updated', { roomId, settings: db.getRoomSettings(roomId) });
  });

  // Update room
  socket.on('update-room', ({ roomId, data }) => {
    const room = db.getRoom(roomId);
    const isMod = db.isModerator(roomId, userId);
    if (!room || (room.created_by !== userId && !isMod)) return;
    const update = {};
    if (data.description !== undefined) update.description = data.description;
    if (data.welcomeMsg !== undefined) update.welcome_msg = data.welcomeMsg;
    if (data.slowMode !== undefined) update.slow_mode = data.slowMode;
    if (data.readOnly !== undefined) update.read_only = data.readOnly ? 1 : 0;
    if (data.name !== undefined) update.name = data.name;
    db.updateRoom(roomId, update);
    io.to(roomId).emit('room-updated', { roomId, roomData: db.getRoom(roomId) });
  });

  // Invite
  socket.on('generate-invite', ({ roomId }) => {
    const code = uuidv4().slice(0, 8);
    db.createInvite(code, roomId, userId);
    socket.emit('invite-generated', { code, url: `/invite/${code}` });
  });

  // Ban/Mod
  socket.on('ban-user', ({ roomId, targetId }) => {
    const room = db.getRoom(roomId);
    const isMod = db.isModerator(roomId, userId);
    if (!room || (room.created_by !== userId && !isMod)) return;
    db.banUser(roomId, targetId);
    db.removeRoomMember(roomId, targetId);
    const ts = io.sockets.sockets.get(db.getUser(targetId)?.socket_id);
    if (ts) { ts.leave(roomId); ts.emit('banned', { roomId }); }
    io.to(roomId).emit('user-banned', { roomId, targetId, by: userId });
  });

  socket.on('unban-user', ({ roomId, targetId }) => { db.unbanUser(roomId, targetId); });
  socket.on('add-moderator', ({ roomId, targetId }) => {
    const room = db.getRoom(roomId);
    if (!room || room.created_by !== userId) return;
    db.addModerator(roomId, targetId);
    io.to(roomId).emit('moderator-added', { roomId, targetId });
  });
  socket.on('remove-moderator', ({ roomId, targetId }) => {
    const room = db.getRoom(roomId);
    if (!room || room.created_by !== userId) return;
    db.removeModerator(roomId, targetId);
    io.to(roomId).emit('moderator-removed', { roomId, targetId });
  });

  // Report
  socket.on('report-message', ({ roomId, messageId, reason }) => {
    db.addReport(roomId, messageId, userId, reason || 'No reason');
    socket.emit('report-submitted', { success: true });
  });

  // Draft
  socket.on('save-draft', ({ roomId, text }) => { db.saveDraft(userId, roomId, text); });
  socket.on('get-draft', ({ roomId }) => {
    const d = db.getDraft(userId, roomId);
    socket.emit('draft-loaded', { roomId, text: d?.text || '' });
  });

  // Search
  socket.on('search-messages', ({ roomId, query }) => {
    const results = db.searchMessages(roomId, query);
    socket.emit('search-results', { roomId, query, results });
  });

  // Feedback
  socket.on('send-feedback', ({ text, type }) => {
    db.addFeedback(userId, text, type);
    socket.emit('feedback-sent', { success: true });
  });

  // Commands
  socket.on('command', ({ roomId, cmd, args }) => {
    const room = db.getRoom(roomId);
    const isMod = db.isModerator(roomId, userId);
    let response = '';
    switch (cmd) {
      case 'help': response = 'Commands: /help /clear /nick <name> /me <action> /topic <text> /slow <sec> /ban <user> /status <text> /invite'; break;
      case 'clear':
        if (room && (room.created_by === userId || isMod)) { db.deleteRoomMessages(roomId); io.to(roomId).emit('room-cleared', { roomId, by: userId }); return; }
        response = 'Only moderators can clear'; break;
      case 'nick':
        if (args && args.length < 20) { db.renameUser(userId, args); io.emit('user-renamed', { userId, newName: args }); return; }
        response = '/nick <name> (max 20)'; break;
      case 'me': response = `* ${displayName} ${args || ''}`; break;
      case 'topic':
        if (room) { db.updateRoom(roomId, { description: args || '' }); io.to(roomId).emit('room-updated', { roomId, roomData: db.getRoom(roomId) }); return; }
        break;
      case 'slow':
        const sec = parseInt(args) || 0;
        if (room && (room.created_by === userId || isMod)) { db.updateRoom(roomId, { slow_mode: sec }); io.to(roomId).emit('slow-mode-set', { roomId, seconds: sec, setBy: displayName }); return; }
        response = 'Only moderators can set slow mode'; break;
      case 'status': db.updateUserStatus(userId, 'online', args || ''); io.emit('user-status-change', { userId, status: 'online', customStatus: args || '' }); return;
      case 'invite': socket.emit('invite-generated', { code: uuidv4().slice(0, 8), url: `/invite/${uuidv4().slice(0, 8)}` }); return;
      default: response = 'Unknown command';
    }
    if (response) socket.emit('command-response', { roomId, text: response });
  });

  // Calling
  socket.on('call-user', ({ targetId, type, sdp }) => {
    const tu = db.getUser(targetId);
    if (tu) { const ts = io.sockets.sockets.get(tu.socket_id); if (ts) ts.emit('incoming-call', { from: userId, fromName: displayName, type, sdp }); }
  });
  socket.on('call-accepted', ({ targetId, sdp }) => {
    const tu = db.getUser(targetId);
    if (tu) { const ts = io.sockets.sockets.get(tu.socket_id); if (ts) ts.emit('call-accepted', { from: userId, sdp }); }
  });
  socket.on('call-rejected', ({ targetId }) => {
    const tu = db.getUser(targetId);
    if (tu) { const ts = io.sockets.sockets.get(tu.socket_id); if (ts) ts.emit('call-rejected', { from: userId }); }
  });
  socket.on('ice-candidate', ({ targetId, candidate }) => {
    const tu = db.getUser(targetId);
    if (tu) { const ts = io.sockets.sockets.get(tu.socket_id); if (ts) ts.emit('ice-candidate', { from: userId, candidate }); }
  });
  socket.on('end-call', ({ targetId }) => {
    const tu = db.getUser(targetId);
    if (tu) { const ts = io.sockets.sockets.get(tu.socket_id); if (ts) ts.emit('call-ended', { from: userId }); }
  });
  socket.on('group-call-start', ({ roomId, type }) => { socket.to(roomId).emit('group-call-started', { from: userId, fromName: displayName, type, roomId }); });
  socket.on('group-call-end', ({ roomId }) => { io.to(roomId).emit('group-call-ended', { from: userId }); });

  // Disconnect
  socket.on('disconnect', () => {
    db.setUserOffline(userId);
    io.emit('users-update', db.getAllUsers());
  });
});

function getUserBadges(userId, roomId, moderators) {
  const badges = [];
  const room = db.getRoom(roomId);
  if (room && room.created_by === userId) badges.push({ icon: '👑', name: 'Creator', color: '#ffd700' });
  if (moderators?.includes(userId)) badges.push({ icon: '🛡️', name: 'Mod', color: '#6c5ce7' });
  const streak = db.getStreaks().find(s => s.user_id === userId);
  if (streak && streak.count >= 3) badges.push({ icon: '🔥', name: `${streak.count}d`, color: '#ff6b6b' });
  return badges;
}

// Graceful shutdown
process.on('SIGINT', () => { db.close(); process.exit(0); });
process.on('SIGTERM', () => { db.close(); process.exit(0); });

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ChatWave running on http://0.0.0.0:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/host`);
  console.log(`Database: SQLite at chatwave.db`);
});
