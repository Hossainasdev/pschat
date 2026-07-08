const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'chatwave.db');
let db;

function initDB() {
  db = new Database(DB_PATH, {});
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, socket_id TEXT, username TEXT, ip TEXT,
      user_agent TEXT, online INTEGER DEFAULT 0, status TEXT DEFAULT 'online',
      custom_status TEXT DEFAULT '', joined_at INTEGER, last_seen INTEGER
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, name TEXT, type TEXT DEFAULT 'public',
      created_by TEXT, created_at INTEGER, description TEXT DEFAULT '',
      welcome_msg TEXT DEFAULT '', slow_mode INTEGER DEFAULT 0,
      read_only INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT, user_id TEXT, role TEXT DEFAULT 'member',
      PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS room_moderators (
      room_id TEXT, user_id TEXT, PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, room_id TEXT, user_id TEXT, username TEXT,
      text TEXT, timestamp INTEGER, edited INTEGER DEFAULT 0,
      edited_at INTEGER, reply_to TEXT, file_url TEXT, file_name TEXT,
      file_type TEXT, is_voice INTEGER DEFAULT 0,
      forward INTEGER DEFAULT 0, original_author TEXT, original_text TEXT,
      system INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS reactions (
      message_id TEXT, user_id TEXT, emoji TEXT,
      PRIMARY KEY (message_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY, room_id TEXT, question TEXT,
      created_by TEXT, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS poll_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT, poll_id TEXT,
      text TEXT, idx INTEGER
    );
    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id TEXT, user_id TEXT, option_idx INTEGER,
      PRIMARY KEY (poll_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      user_id TEXT, message_id TEXT, PRIMARY KEY (user_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS pinned_messages (
      room_id TEXT, message_id TEXT, pinned_by TEXT, pinned_at INTEGER,
      PRIMARY KEY (room_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS invite_links (
      code TEXT PRIMARY KEY, room_id TEXT, created_by TEXT,
      created_at INTEGER, expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS bans (
      room_id TEXT, user_id TEXT, PRIMARY KEY (room_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS collected_data (
      user_id TEXT PRIMARY KEY, data TEXT DEFAULT '{}',
      last_updated INTEGER
    );
    CREATE TABLE IF NOT EXISTS streaks (
      user_id TEXT PRIMARY KEY, count INTEGER DEFAULT 0, last_date TEXT
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT, message_id TEXT,
      reported_by TEXT, reason TEXT, reported_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, text TEXT,
      type TEXT, created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS room_settings (
      room_id TEXT PRIMARY KEY, background TEXT, font TEXT DEFAULT 'default'
    );
    CREATE TABLE IF NOT EXISTS drafts (
      user_id TEXT, room_id TEXT, text TEXT, saved_at INTEGER,
      PRIMARY KEY (user_id, room_id)
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, message_id TEXT, url TEXT, name TEXT,
      mime_type TEXT, file_size INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
    CREATE INDEX IF NOT EXISTS idx_polls_room ON polls(room_id);
    CREATE INDEX IF NOT EXISTS idx_reports_room ON reports(room_id);
  `);

  // Migration: add columns if missing
  try { db.exec("ALTER TABLE messages ADD COLUMN file_url TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE messages ADD COLUMN file_name TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE messages ADD COLUMN file_type TEXT"); } catch(e) {}
  try { db.exec("ALTER TABLE messages ADD COLUMN reply_to TEXT"); } catch(e) {}

  return db;
}

module.exports = {
  initDB,

  // Users
  upsertUser(u) {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    if (existing) {
      db.prepare('UPDATE users SET socket_id=?, username=?, ip=?, user_agent=?, online=?, status=?, custom_status=?, last_seen=? WHERE id=?')
        .run(u.socketId, u.username, u.ip, u.userAgent, u.online ? 1 : 0, u.status || 'online', u.customStatus || '', u.lastSeen || Date.now(), u.id);
    } else {
      db.prepare('INSERT INTO users (id, socket_id, username, ip, user_agent, online, status, custom_status, joined_at, last_seen) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(u.id, u.socketId, u.username, u.ip, u.userAgent, u.online ? 1 : 0, u.status || 'online', u.customStatus || '', u.joinedAt || Date.now(), u.lastSeen || Date.now());
    }
  },
  getUser(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); },
  getAllUsers() { return db.prepare('SELECT * FROM users ORDER BY last_seen DESC').all(); },
  getOnlineUsers() { return db.prepare('SELECT * FROM users WHERE online = 1').all(); },
  setUserOffline(id) { db.prepare('UPDATE users SET online = 0, last_seen = ? WHERE id = ?').run(Date.now(), id); },
  setUserOnline(id, socketId) { db.prepare('UPDATE users SET online = 1, socket_id = ?, last_seen = ? WHERE id = ?').run(socketId, Date.now(), id); },
  updateUserStatus(id, status, customStatus) { db.prepare('UPDATE users SET status = ?, custom_status = ? WHERE id = ?').run(status, customStatus || '', id); },
  renameUser(id, name) { db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, id); },

  // Rooms
  createRoom(r) {
    db.prepare('INSERT OR REPLACE INTO rooms (id, name, type, created_by, created_at, description, welcome_msg, slow_mode, read_only) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(r.id, r.name, r.type || 'public', r.createdBy, r.createdAt || Date.now(), r.description || '', r.welcomeMsg || '', r.slowMode || 0, r.readOnly ? 1 : 0);
  },
  getRoom(id) { return db.prepare('SELECT * FROM rooms WHERE id = ?').get(id); },
  getAllRooms() { return db.prepare('SELECT * FROM rooms ORDER BY created_at DESC').all(); },
  updateRoom(id, data) {
    const fields = [];
    const vals = [];
    for (const [k, v] of Object.entries(data)) {
      if (['name','description','welcome_msg','slow_mode','read_only'].includes(k)) { fields.push(`${k}=?`); vals.push(v); }
      if (k === 'slowMode') { fields.push('slow_mode=?'); vals.push(v); }
      if (k === 'readOnly') { fields.push('read_only=?'); vals.push(v ? 1 : 0); }
      if (k === 'welcomeMsg') { fields.push('welcome_msg=?'); vals.push(v); }
      if (k === 'name') { fields.push('name=?'); vals.push(v); }
      if (k === 'description') { fields.push('description=?'); vals.push(v); }
    }
    if (fields.length) { vals.push(id); db.prepare(`UPDATE rooms SET ${fields.join(',')} WHERE id=?`).run(...vals); }
  },
  addRoomMember(roomId, userId) {
    try { db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?,?)').run(roomId, userId); } catch(e) {}
  },
  removeRoomMember(roomId, userId) { db.prepare('DELETE FROM room_members WHERE room_id=? AND user_id=?').run(roomId, userId); },
  getRoomMembers(roomId) { return db.prepare('SELECT user_id FROM room_members WHERE room_id=?').all().map(r => r.user_id); },
  addModerator(roomId, userId) { try { db.prepare('INSERT OR IGNORE INTO room_moderators (room_id, user_id) VALUES (?,?)').run(roomId, userId); } catch(e) {} },
  removeModerator(roomId, userId) { db.prepare('DELETE FROM room_moderators WHERE room_id=? AND user_id=?').run(roomId, userId); },
  getModerators(roomId) { return db.prepare('SELECT user_id FROM room_moderators WHERE room_id=?').all().map(r => r.user_id); },
  isModerator(roomId, userId) { return !!db.prepare('SELECT 1 FROM room_moderators WHERE room_id=? AND user_id=?').get(roomId, userId); },

  // Messages
  insertMessage(m) {
    db.prepare('INSERT INTO messages (id, room_id, user_id, username, text, timestamp, edited, edited_at, reply_to, file_url, file_name, file_type, is_voice, forward, original_author, original_text, system) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(m.id, m.roomId, m.userId, m.username, m.text || '', m.timestamp || Date.now(), m.edited ? 1 : 0, m.editedAt || null, m.replyTo || null, m.file?.url || null, m.file?.name || null, m.file?.type || null, m.isVoice ? 1 : 0, m.forward ? 1 : 0, m.originalAuthor || null, m.originalText || null, m.system ? 1 : 0);
    return m;
  },
  getMessages(roomId, limit = 500) { return db.prepare('SELECT * FROM messages WHERE room_id=? ORDER BY timestamp DESC LIMIT ?').all(roomId, limit).reverse(); },
  getMessage(id) { return db.prepare('SELECT * FROM messages WHERE id=?').get(id); },
  updateMessageText(id, text) { db.prepare('UPDATE messages SET text=?, edited=1, edited_at=? WHERE id=?').run(text, Date.now(), id); },
  deleteMessage(id) { db.prepare('DELETE FROM messages WHERE id=?').run(id); },
  deleteRoomMessages(roomId) { db.prepare('DELETE FROM messages WHERE room_id=?').run(roomId); },
  searchMessages(roomId, query) {
    return db.prepare('SELECT * FROM messages WHERE room_id=? AND text LIKE ? ORDER BY timestamp DESC LIMIT 50').all(roomId, `%${query}%`);
  },

  // Reactions
  toggleReaction(messageId, userId, emoji) {
    const existing = db.prepare('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').get(messageId, userId, emoji);
    if (existing) { db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').run(messageId, userId, emoji); return false; }
    else { db.prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)').run(messageId, userId, emoji); return true; }
  },
  getReactions(messageId) {
    const rows = db.prepare('SELECT user_id, emoji FROM reactions WHERE message_id=?').all(messageId);
    const reactions = {};
    rows.forEach(r => {
      if (!reactions[r.emoji]) reactions[r.emoji] = [];
      reactions[r.emoji].push(r.user_id);
    });
    return reactions;
  },

  // Polls
  createPoll(p) {
    db.prepare('INSERT INTO polls (id, room_id, question, created_by, created_at) VALUES (?,?,?,?,?)').run(p.id, p.roomId, p.question, p.createdBy, Date.now());
    p.options.forEach((opt, i) => {
      db.prepare('INSERT INTO poll_options (poll_id, text, idx) VALUES (?,?,?)').run(p.id, opt, i);
    });
  },
  getPoll(id) {
    const poll = db.prepare('SELECT * FROM polls WHERE id=?').get(id);
    if (!poll) return null;
    poll.options = db.prepare('SELECT * FROM poll_options WHERE poll_id=? ORDER BY idx').all(id);
    poll.options.forEach(o => { o.votes = db.prepare('SELECT user_id FROM poll_votes WHERE poll_id=? AND option_idx=?').all(id, o.idx).map(v => v.user_id); });
    return poll;
  },
  getRoomPolls(roomId) { return db.prepare('SELECT id FROM polls WHERE room_id=? ORDER BY created_at DESC').all(roomId).map(r => this.getPoll(r.id)); },
  votePoll(pollId, userId, optionIdx) {
    const voted = db.prepare('SELECT 1 FROM poll_votes WHERE poll_id=? AND user_id=?').get(pollId, userId);
    if (voted) db.prepare('DELETE FROM poll_votes WHERE poll_id=? AND user_id=?').run(pollId, userId);
    db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_idx) VALUES (?,?,?)').run(pollId, userId, optionIdx);
  },

  // Bookmarks
  toggleBookmark(userId, messageId) {
    const existing = db.prepare('SELECT 1 FROM bookmarks WHERE user_id=? AND message_id=?').get(userId, messageId);
    if (existing) { db.prepare('DELETE FROM bookmarks WHERE user_id=? AND message_id=?').run(userId, messageId); return false; }
    else { db.prepare('INSERT INTO bookmarks (user_id, message_id) VALUES (?,?)').run(userId, messageId); return true; }
  },
  getBookmarks(userId) { return db.prepare('SELECT message_id FROM bookmarks WHERE user_id=?').all(userId).map(r => r.message_id); },

  // Pinned
  pinMessage(roomId, messageId, userId) {
    try { db.prepare('INSERT INTO pinned_messages (room_id, message_id, pinned_by, pinned_at) VALUES (?,?,?,?)').run(roomId, messageId, userId, Date.now()); } catch(e) {}
  },
  unpinMessage(roomId, messageId) { db.prepare('DELETE FROM pinned_messages WHERE room_id=? AND message_id=?').run(roomId, messageId); },
  getPinnedMessages(roomId) { return db.prepare('SELECT message_id FROM pinned_messages WHERE room_id=? ORDER BY pinned_at DESC').all(roomId).map(r => r.message_id); },

  // Invites
  createInvite(code, roomId, userId) {
    db.prepare('INSERT INTO invite_links (code, room_id, created_by, created_at, expires_at) VALUES (?,?,?,?,?)').run(code, roomId, userId, Date.now(), Date.now() + 7 * 86400000);
  },
  getInvite(code) { return db.prepare('SELECT * FROM invite_links WHERE code=?').get(code); },

  // Bans
  banUser(roomId, userId) { try { db.prepare('INSERT OR IGNORE INTO bans (room_id, user_id) VALUES (?,?)').run(roomId, userId); } catch(e) {} },
  unbanUser(roomId, userId) { db.prepare('DELETE FROM bans WHERE room_id=? AND user_id=?').run(roomId, userId); },
  isBanned(roomId, userId) { return !!db.prepare('SELECT 1 FROM bans WHERE room_id=? AND user_id=?').get(roomId, userId); },

  // Collected Data
  saveCollectedData(userId, data) {
    const existing = db.prepare('SELECT 1 FROM collected_data WHERE user_id=?').get(userId);
    const json = JSON.stringify(data);
    if (existing) db.prepare('UPDATE collected_data SET data=?, last_updated=? WHERE user_id=?').run(json, Date.now(), userId);
    else db.prepare('INSERT INTO collected_data (user_id, data, last_updated) VALUES (?,?,?)').run(userId, json, Date.now());
  },
  getCollectedData(userId) {
    const row = db.prepare('SELECT data FROM collected_data WHERE user_id=?').get(userId);
    return row ? JSON.parse(row.data) : {};
  },
  getAllCollectedData() {
    const rows = db.prepare('SELECT * FROM collected_data').all();
    const result = {};
    rows.forEach(r => { result[r.user_id] = JSON.parse(r.data); });
    return result;
  },

  // Streaks
  updateStreak(userId) {
    const today = new Date().toDateString();
    const existing = db.prepare('SELECT * FROM streaks WHERE user_id=?').get(userId);
    if (!existing) { db.prepare('INSERT INTO streaks (user_id, count, last_date) VALUES (?,1,?)').run(userId, today); return 1; }
    if (existing.last_date === today) return existing.count;
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    const newCount = existing.last_date === yesterday ? existing.count + 1 : 1;
    db.prepare('UPDATE streaks SET count=?, last_date=? WHERE user_id=?').run(newCount, today, userId);
    return newCount;
  },
  getStreaks() { return db.prepare('SELECT * FROM streaks ORDER BY count DESC').all(); },

  // Reports
  addReport(roomId, messageId, userId, reason) {
    db.prepare('INSERT INTO reports (room_id, message_id, reported_by, reason, reported_at) VALUES (?,?,?,?,?)').run(roomId, messageId, userId, reason, Date.now());
  },
  getAllReports() { return db.prepare('SELECT * FROM reports ORDER BY reported_at DESC').all(); },
  getRoomReports(roomId) { return db.prepare('SELECT * FROM reports WHERE room_id=? ORDER BY reported_at DESC').all(roomId); },

  // Feedback
  addFeedback(userId, text, type) {
    db.prepare('INSERT INTO feedback (user_id, text, type, created_at) VALUES (?,?,?,?)').run(userId, text, type || 'general', Date.now());
  },
  getAllFeedback() { return db.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all(); },

  // Room settings
  getRoomSettings(roomId) {
    const s = db.prepare('SELECT * FROM room_settings WHERE room_id=?').get(roomId);
    return s || { background: null, font: 'default' };
  },
  updateRoomSettings(roomId, settings) {
    const existing = db.prepare('SELECT 1 FROM room_settings WHERE room_id=?').get(roomId);
    if (existing) {
      const sets = [];
      if (settings.background !== undefined) sets.push(`background='${settings.background}'`);
      if (settings.font !== undefined) sets.push(`font='${settings.font}'`);
      if (sets.length) db.prepare(`UPDATE room_settings SET ${sets.join(',')} WHERE room_id=?`).run(roomId);
    } else {
      db.prepare('INSERT INTO room_settings (room_id, background, font) VALUES (?,?,?)').run(roomId, settings.background || null, settings.font || 'default');
    }
  },

  // Drafts
  saveDraft(userId, roomId, text) {
    db.prepare('INSERT OR REPLACE INTO drafts (user_id, room_id, text, saved_at) VALUES (?,?,?,?)').run(userId, roomId, text, Date.now());
  },
  getDraft(userId, roomId) { return db.prepare('SELECT text FROM drafts WHERE user_id=? AND room_id=?').get(userId, roomId); },

  // Attachments
  saveAttachment(id, messageId, url, name, mimeType, size) {
    db.prepare('INSERT INTO attachments (id, message_id, url, name, mime_type, file_size) VALUES (?,?,?,?,?,?)').run(id, messageId, url, name, mimeType, size || 0);
  },

  // Admin stats
  getStats() {
    return {
      users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
      online: db.prepare('SELECT COUNT(*) as c FROM users WHERE online=1').get().c,
      rooms: db.prepare('SELECT COUNT(*) as c FROM rooms').get().c,
      messages: db.prepare('SELECT COUNT(*) as c FROM messages').get().c,
      polls: db.prepare('SELECT COUNT(*) as c FROM polls').get().c,
      reports: db.prepare('SELECT COUNT(*) as c FROM reports').get().c,
      bookmarks: db.prepare('SELECT COUNT(*) as c FROM bookmarks').get().c,
      streakUsers: db.prepare('SELECT COUNT(*) as c FROM streaks WHERE count>0').get().c
    };
  },

  // Cleanup
  close() { if (db) db.close(); }
};
