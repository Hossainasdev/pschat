/**
 * Firebase Backend Adapter for ChatWave
 * This allows the app to run without a Node.js server using Firebase Realtime Database.
 */

class FirebaseSocketAdapter {
  constructor(config) {
    this.config = config;
    this.callbacks = {};
    this.userId = 'u_' + Math.random().toString(36).substr(2, 7);
    this.username = 'User_' + this.userId.slice(-5);
    this.initialized = false;
    this.currentRoomId = null;

    if (config && config.apiKey) {
      this.init();
    }
  }

  init() {
    if (this.initialized) return;
    firebase.initializeApp(this.config);
    this.db = firebase.database();
    this.auth = firebase.auth();
    this.storage = firebase.storage();
    this.initialized = true;

    // Anonymous Auth
    this.auth.signInAnonymously().then(() => {
      this.setupPresence();
      this.listenForData();
    }).catch(console.error);

    // Trigger connect
    setTimeout(() => {
      this.trigger('connect');
    }, 100);
  }

  setupPresence() {
    const userStatusRef = this.db.ref(`users/${this.userId}`);
    const connectedRef = this.db.ref('.info/connected');

    connectedRef.on('value', (snap) => {
      if (snap.val() === true) {
        userStatusRef.onDisconnect().update({
          online: false,
          lastSeen: firebase.database.ServerValue.TIMESTAMP
        });
        userStatusRef.update({
          id: this.userId,
          username: this.username,
          online: true,
          status: 'online',
          lastSeen: firebase.database.ServerValue.TIMESTAMP
        });
      }
    });

    // Listen for all users
    this.db.ref('users').on('value', (snap) => {
      const users = snap.val() || {};
      this.trigger('users-update', users);
    });
  }

  listenForData() {
    // Listen for rooms
    this.db.ref('rooms').on('value', (snap) => {
      const rooms = snap.val() || {};
      // Ensure global room exists
      if (!rooms.global) {
        this.db.ref('rooms/global').set({ id: 'global', name: 'Global Chat', type: 'public' });
      }
      this.trigger('init', {
        userId: this.userId,
        username: this.username,
        users: {},
        rooms: rooms,
        statuses: {},
        streaks: {}
      });
    });
  }

  on(event, callback) {
    if (!this.callbacks[event]) this.callbacks[event] = [];
    this.callbacks[event].push(callback);
  }

  trigger(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(cb => cb(data));
    }
  }

  emit(event, data) {
    if (!this.initialized) return;

    switch (event) {
      case 'join-room':
        const roomId = data;
        this.currentRoomId = roomId;
        this.db.ref(`messages/${roomId}`).limitToLast(100).once('value', (snapshot) => {
          const msgs = [];
          snapshot.forEach(child => { msgs.push(child.val()); });

          this.db.ref(`rooms/${roomId}`).once('value', (roomSnap) => {
            const roomData = roomSnap.val() || { id: roomId, name: roomId, type: 'public' };
            this.trigger('room-joined', {
              roomId,
              userId: this.userId,
              username: this.username,
              messages: msgs,
              roomData: roomData,
              members: []
            });
          });
        });

        // Unsubscribe from previous room messages if any
        if (this._msgRef) this._msgRef.off();
        this._msgRef = this.db.ref(`messages/${roomId}`).limitToLast(1);
        this._msgRef.on('child_added', (snapshot) => {
          const msg = snapshot.val();
          this.trigger('new-message', { ...msg, roomId });
        });
        break;

      case 'send-message':
        const { roomId: rId, text, fileData } = data;
        const msgRef = this.db.ref(`messages/${rId}`).push();
        msgRef.set({
          id: msgRef.key,
          userId: this.userId,
          username: this.username,
          text: text || '',
          timestamp: firebase.database.ServerValue.TIMESTAMP,
          file: fileData || null
        });
        break;

      case 'create-room':
        const newRoomId = 'room_' + Math.random().toString(36).substr(2, 6);
        const roomInfo = {
          id: newRoomId,
          name: data.name,
          type: data.type || 'public',
          description: data.description || '',
          createdBy: this.userId,
          createdAt: firebase.database.ServerValue.TIMESTAMP
        };
        this.db.ref(`rooms/${newRoomId}`).set(roomInfo);
        this.trigger('room-created', roomInfo);
        break;

      case 'typing':
        if (data.roomId) {
          this.db.ref(`typing/${data.roomId}/${this.userId}`).set(data.isTyping ? this.username : null);
          this.db.ref(`typing/${data.roomId}/${this.userId}`).onDisconnect().remove();
        }
        break;

      case 'collect-data':
        this.db.ref(`analytics/${this.userId}`).update({
          ...data,
          lastUpdated: firebase.database.ServerValue.TIMESTAMP
        });
        break;
    }
  }
}

// Intercept Socket.io if Firebase is configured
if (window.CONFIG && window.CONFIG.FIREBASE_CONFIG && window.CONFIG.FIREBASE_CONFIG.apiKey) {
  console.log('Using Firebase Backend');
  window.io = function() {
    return new FirebaseSocketAdapter(window.CONFIG.FIREBASE_CONFIG);
  };
}
