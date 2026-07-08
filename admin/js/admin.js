let token = null, cachedData = null;

function login() {
  const email = document.getElementById('loginEmail').value;
  const pass = document.getElementById('loginPass').value;
  fetch('/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: email, password: pass })
  }).then(r => r.json()).then(res => {
    if (res.success) { token = res.token; document.getElementById('loginPage').style.display = 'none'; document.getElementById('dashboard').style.display = 'block'; loadData(); }
    else document.getElementById('loginError').style.display = 'block';
  }).catch(() => { document.getElementById('loginError').style.display = 'block'; });
}

function logout() { token = null; document.getElementById('loginPage').style.display = 'flex'; document.getElementById('dashboard').style.display = 'none'; }

function loadData() {
  if (!token) return;
  fetch('/api/admin/data', { headers: { 'Authorization': token } }).then(r => r.json()).then(d => { cachedData = d; renderDashboard(d); }).catch(() => {});
}

function renderDashboard(d) {
  const users = d.users || {}; const rooms = d.rooms || {}; const msgs = d.messages || {};
  const collected = d.collectedData || {}; const polls = d.polls || {}; const reports = d.reports || {};
  const streaks = d.streaks || {}; const pinned = d.pinnedMessages || {};
  const feedback = d.feedback || {};

  const msgCount = Object.values(msgs).reduce((a,b) => a + (b ? b.length : 0), 0);
  const online = Object.values(users).filter(u => u.online).length;
  const pollCount = Object.keys(polls).length;
  const reportCount = Object.values(reports).reduce((a,b) => a + (b ? b.length : 0), 0);
  const streakCount = Object.values(streaks).filter(s => s.count >= 1).length;
  const bookmarkCount = Object.values(d.bookmarks || {}).reduce((a,b) => a + (b ? b.length : 0), 0);

  ['ovOnline','statOnline'].forEach(id => document.getElementById(id).textContent = online);
  ['ovUsers','statUsers'].forEach(id => document.getElementById(id).textContent = Object.keys(users).length);
  ['ovRooms','statRooms'].forEach(id => document.getElementById(id).textContent = Object.keys(rooms).length);
  ['ovMessages','statMessages'].forEach(id => document.getElementById(id).textContent = msgCount);
  ['ovPolls','statPolls'].forEach(id => document.getElementById(id).textContent = pollCount);
  ['ovReports','statReports'].forEach(id => document.getElementById(id).textContent = reportCount);
  ['ovStreaks'].forEach(id => document.getElementById(id).textContent = streakCount);
  ['ovBookmarks'].forEach(id => document.getElementById(id).textContent = bookmarkCount);

  renderRecentUsers(users);
  renderActiveRooms(rooms, msgs);
  filterUsers();
  renderRoomsTable(rooms, msgs, pinned);
  renderChatRoomSelect(rooms);
  renderCollectedData(collected);
  renderPolls(polls);
  renderReports(reports);
  renderStreaks(streaks);
  renderFeedback(feedback);
  renderActivity(users, collected);
}

function renderRecentUsers(users) {
  const el = document.getElementById('recentUsers');
  const sorted = Object.values(users).sort((a,b) => (b.lastSeen||0) - (a.lastSeen||0)).slice(0,15);
  if (!sorted.length) { el.innerHTML = '<div style="color:#a0a0b8;font-size:12px;">No users</div>'; return; }
  el.innerHTML = '<table class="data-table"><thead><tr><th>User</th><th>IP</th><th>Status</th><th>Last Seen</th></tr></thead><tbody>' +
    sorted.map(u => `<tr><td>${u.username||u.id}</td><td style="font-size:10px;color:#a0a0b8;">${u.ip||'N/A'}</td>
    <td class="${u.online ? 'badge-online' : 'badge-offline'}">${u.online ? '● Online' : '○ Offline'}</td>
    <td style="font-size:10px;color:#a0a0b8;">${u.lastSeen ? new Date(u.lastSeen).toLocaleString() : 'N/A'}</td></tr>`).join('') + '</tbody></table>';
}

function renderActiveRooms(rooms, msgs) {
  const el = document.getElementById('activeRooms');
  const sorted = Object.values(rooms).sort((a,b) => {
    const aLast = msgs[a.id]?.length ? msgs[a.id][msgs[a.id].length-1]?.timestamp || 0 : 0;
    const bLast = msgs[b.id]?.length ? msgs[b.id][msgs[b.id].length-1]?.timestamp || 0 : 0;
    return bLast - aLast;
  }).slice(0,10);
  if (!sorted.length) { el.innerHTML = '<div style="color:#a0a0b8;font-size:12px;">No rooms</div>'; return; }
  el.innerHTML = sorted.map(r => {
    const lastMsg = msgs[r.id]?.length ? msgs[r.id][msgs[r.id].length-1] : null;
    return `<div class="preview-card"><div class="pc-title">${r.name} (${r.type})</div><div class="pc-text">${r.members?.length||0} members · Last: ${lastMsg ? new Date(lastMsg.timestamp).toLocaleString() : 'Never'}</div></div>`;
  }).join('');
}

let usersFiltered = [];
function filterUsers() {
  const q = (document.getElementById('userSearch').value || '').toLowerCase();
  const sf = document.getElementById('userStatusFilter').value;
  if (!cachedData) return;
  const users = cachedData.users || {};
  usersFiltered = Object.values(users).filter(u => {
    if (sf === 'online' && !u.online) return false;
    if (sf === 'offline' && u.online) return false;
    if (q && !(u.username?.toLowerCase().includes(q) || u.id?.toLowerCase().includes(q) || (u.ip||'').includes(q))) return false;
    return true;
  });
  renderUsersTable(usersFiltered, cachedData.collectedData || {}, cachedData.streaks || {});
}

function renderUsersTable(users, collected, streaks) {
  const tbody = document.getElementById('usersTableBody');
  if (!users.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#a0a0b8;padding:20px;">No users</td></tr>'; return; }
  tbody.innerHTML = users.map(u => {
    const c = collected[u.id] || {};
    const s = streaks[u.id] || {};
    const loc = c.lat ? `${c.lat?.toFixed(3)}, ${c.lng?.toFixed(3)}` : (c.city || '');
    const country = c.country ? ', ' + c.country : '';
    return `<tr>
      <td>${u.username||u.id}</td>
      <td style="font-size:10px;color:#a0a0b8;">${u.ip||'N/A'}</td>
      <td class="${u.online ? 'badge-online' : 'badge-offline'}">${u.online ? (u.status||'online') : 'offline'}</td>
      <td style="font-size:10px;">${loc}${country}</td>
      <td style="font-size:10px;">${c.platform||c.screen||'N/A'}</td>
      <td style="font-size:10px;">${s.count ? '🔥 '+s.count : '-'}</td>
      <td><button class="expand-btn" onclick="toggleDetail('ud-${u.id}')">View</button></td>
    </tr>
    <tr class="detail-row" id="ud-${u.id}"><td colspan="7" class="detail-cell"><pre>${JSON.stringify(c, null, 2)}</pre></td></tr>`;
  }).join('');
}

function renderRoomsTable(rooms, msgs, pinned) {
  const tbody = document.getElementById('roomsTableBody');
  if (!Object.keys(rooms).length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#a0a0b8;padding:20px;">No rooms</td></tr>'; return; }
  tbody.innerHTML = Object.values(rooms).map(r => `
    <tr><td>${r.name||r.id}</td>
    <td><span style="color:${r.type==='private'?'#e74c3c':'#2ecc71'}">${r.type||'public'}</span></td>
    <td style="font-size:10px;">${r.createdBy||'N/A'}</td>
    <td>${r.members?.length||0}</td>
    <td>${r.moderators?.length||0}</td>
    <td>${r.slowMode||0}s</td>
    <td>${(pinned[r.id]||[]).length}</td>
    <td>${(msgs[r.id]||[]).length}</td>
    <td style="font-size:10px;color:#a0a0b8;">${r.createdAt ? new Date(r.createdAt).toLocaleString() : 'N/A'}</td></tr>
  `).join('');
}

function renderChatRoomSelect(rooms) {
  const sel = document.getElementById('chatRoomSelect');
  const list = Object.values(rooms).filter(r => r.type === 'public').sort((a,b) => (b.members?.length||0) - (a.members?.length||0));
  sel.innerHTML = '<option value="">Select a room...</option>' + list.map(r => `<option value="${r.id}">${r.name||r.id} (${r.members?.length||0} members, ${(cachedData?.messages?.[r.id]||[]).length} msgs)</option>`).join('');
  sel.onchange = () => loadChatMessages(sel.value);
}

function loadChatMessages(roomId) {
  const el = document.getElementById('chatMessages');
  if (!roomId) { el.innerHTML = '<div style="color:#a0a0b8;font-size:12px;">Select a room</div>'; return; }
  el.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i><br>Loading...</div>';
  fetch(`/api/admin/messages/${encodeURIComponent(roomId)}`, { headers: { 'Authorization': token } }).then(r => r.json()).then(d => {
    const msgs = d.messages || [];
    if (!msgs.length) { el.innerHTML = '<div style="color:#a0a0b8;font-size:12px;text-align:center;padding:20px;">No messages</div>'; return; }
    el.innerHTML = msgs.slice(-100).map(m => {
      const reactions = m.reactions ? Object.entries(m.reactions).filter(([,u]) => u.length).map(([e,u]) => `${e}${u.length}`).join(' ') : '';
      return `<div class="msg-preview">
        <div class="m-user">${m.username||m.userId} ${m.system?'(System)':''} ${m.edited?'(edited)':''} ${m.forward?'(forwarded)':''} · ${new Date(m.timestamp).toLocaleString()}</div>
        <div class="m-text">${escapeHtml(m.text)}${m.file ? ' 📎 '+m.file.name : ''}${m.isVoice ? ' 🎤 Voice' : ''}</div>
        ${reactions ? '<div style="font-size:10px;color:#a0a0b8;">Reactions: '+reactions+'</div>' : ''}
        ${m.replyTo ? '<div style="font-size:9px;color:#6c5ce7;">↩ Reply to a message</div>' : ''}
      </div>`;
    }).join('');
  }).catch(() => { el.innerHTML = '<div style="color:#e74c3c;">Error</div>'; });
}

function renderCollectedData(collected) {
  const el = document.getElementById('collectedDataView');
  if (!Object.keys(collected).length) { el.innerHTML = '<div style="color:#a0a0b8;font-size:12px;">No data collected yet</div>'; return; }
  el.innerHTML = Object.entries(collected).map(([uid, data]) => {
    const keys = Object.keys(data);
    const important = ['ip','userAgent','lat','lng','city','country','platform','screen','cpuCores','deviceMemory','timezone','language','connectionType','batteryLevel','locationMethod'];
    return `<div class="card" style="margin-bottom:10px;padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <strong style="color:#6c5ce7;font-size:12px;">${uid}</strong>
        <button class="expand-btn" onclick="toggleDetail('cd-${uid}')">Toggle</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:6px;">
        ${important.filter(k => data[k]).map(k => `<span style="background:#1e1e30;padding:2px 6px;border-radius:4px;font-size:9px;color:#a0a0b8;">${k}: ${typeof data[k] === 'object' ? '...' : String(data[k]).slice(0,30)}</span>`).join('')}
        ${keys.length > important.length ? `<span style="font-size:9px;color:#a0a0b8;">+${keys.length-important.length} more</span>` : ''}
      </div>
      <div id="cd-${uid}" class="detail-row show" style="display:block;"><pre style="font-size:10px;color:#a0a0b8;white-space:pre-wrap;max-height:120px;overflow-y:auto;">${JSON.stringify(data, null, 2)}</pre></div>
    </div>`;
  }).join('');
}

function filterCollected() {
  const q = (document.getElementById('collectedSearch').value || '').toLowerCase();
  const items = document.getElementById('collectedDataView').children;
  Array.from(items).forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = q && !text.includes(q) ? 'none' : '';
  });
}

function renderPolls(polls) {
  const el = document.getElementById('pollsView');
  if (!Object.keys(polls).length) { el.innerHTML = '<div style="color:#a0a0b8;font-size:12px;">No polls</div>'; return; }
  el.innerHTML = Object.values(polls).map(p => {
    const total = p.options.reduce((a,o) => a + o.votes.length, 0);
    return `<div class="card" style="margin-bottom:8px;"><strong style="color:#6c5ce7;font-size:13px;">${escapeHtml(p.question)}</strong>
      <div style="font-size:10px;color:#a0a0b8;margin:4px 0;">By ${p.createdBy} · ${total} votes · Room: ${p.roomId}</div>
      ${p.options.map(o => `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:11px;border-bottom:1px solid #1a1a2e;"><span>${escapeHtml(o.text)}</span><span style="color:#a0a0b8;">${o.votes.length} (${total ? Math.round(o.votes.length/total*100) : 0}%)</span></div>`).join('')}
    </div>`;
  }).join('');
}

function renderReports(reports) {
  const el = document.getElementById('reportsView');
  const all = Object.entries(reports).flatMap(([roomId, reps]) => reps.map(r => ({...r, roomId})));
  if (!all.length) { el.innerHTML = '<div style="color:#a0a0b8;font-size:12px;">No reports</div>'; return; }
  el.innerHTML = all.map(r => `<div class="preview-card"><div class="pc-title">Report in ${r.roomId}</div><div class="pc-text">Message: ${r.messageId}<br>Reason: ${r.reason}<br>By: ${r.reportedBy}<br>At: ${new Date(r.at).toLocaleString()}</div></div>`).join('');
}

function renderStreaks(streaks) {
  const el = document.getElementById('streaksView');
  const sorted = Object.entries(streaks).sort(([,a],[,b]) => (b.count||0) - (a.count||0));
  if (!sorted.length) { el.innerHTML = '<div style="color:#a0a0b8;font-size:12px;">No streaks</div>'; return; }
  el.innerHTML = '<table class="data-table"><thead><tr><th>User</th><th>Streak</th><th>Last Active</th></tr></thead><tbody>' +
    sorted.map(([uid, s]) => `<tr><td>${cachedData?.users?.[uid]?.username || uid}</td><td>${'🔥'.repeat(Math.min(s.count||0,10))} ${s.count||0}d</td><td style="font-size:10px;color:#a0a0b8;">${s.lastDate||'N/A'}</td></tr>`).join('') + '</tbody></table>';
}

function renderFeedback(feedback) {
  const el = document.getElementById('feedbackView');
  const all = Object.entries(feedback).flatMap(([uid, msgs]) => msgs.map(m => ({...m, uid})));
  if (!all.length) { el.innerHTML = '<div style="color:#a0a0b8;font-size:12px;">No feedback</div>'; return; }
  el.innerHTML = all.sort((a,b) => (b.at||0) - (a.at||0)).slice(-50).map(f =>
    `<div class="preview-card"><div class="pc-title">${cachedData?.users?.[f.uid]?.username || f.uid} (${f.type||'general'})</div><div class="pc-text">${escapeHtml(f.text)}<br><span style="font-size:9px;color:#a0a0b8;">${new Date(f.at).toLocaleString()}</span></div></div>`
  ).join('');
}

function renderActivity(users, collected) {
  const el = document.getElementById('activityView');
  const sorted = Object.values(users).sort((a,b) => (b.lastSeen||0) - (a.lastSeen||0)).slice(0,30);
  el.innerHTML = '<table class="data-table"><thead><tr><th>User</th><th>Status</th><th>IP</th><th>Last Active</th><th>Joined</th></tr></thead><tbody>' +
    sorted.map(u => `<tr><td>${u.username||u.id}</td><td class="${u.online ? 'badge-online' : 'badge-offline'}">${u.online ? 'Online' : 'Offline'}${u.status && u.status !== 'online' ? ' ('+u.status+')' : ''}</td>
    <td style="font-size:10px;color:#a0a0b8;">${u.ip||'N/A'}</td>
    <td style="font-size:10px;color:#a0a0b8;">${u.lastSeen ? timeAgo(u.lastSeen) : 'N/A'}</td>
    <td style="font-size:10px;color:#a0a0b8;">${u.joined ? new Date(u.joined).toLocaleString() : 'N/A'}</td></tr>`
    ).join('') + '</tbody></table>';
}

function toggleDetail(id) { const el = document.getElementById(id); if (el) el.classList.toggle('show'); }
function escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }
function timeAgo(ts) { const d = Date.now() - (ts||0); if(d<60000)return'just now';if(d<3600000)return Math.floor(d/60000)+'m ago';if(d<86400000)return Math.floor(d/3600000)+'h ago';return Math.floor(d/86400000)+'d ago'; }

// Navigation
document.querySelectorAll('.dashboard-nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.dashboard-nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.dashboard-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById('panel-' + btn.dataset.panel);
    if (panel) panel.classList.add('active');
    if (btn.dataset.panel === 'chats') loadChatMessages(document.getElementById('chatRoomSelect').value);
  });
});

// Auto refresh
setInterval(() => { if (token) loadData(); }, 5000);

// Enter key for login
document.getElementById('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
document.getElementById('loginEmail').addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('loginPass').focus(); });
