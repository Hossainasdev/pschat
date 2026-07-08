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
    this.auth.signInAnonymously().catch(console.error);

    // Initial Data
    setTimeout(() => {
      this.trigger('connect');
      this.trigger('init', {
        userId: this.userId,
        username: this.username,
        users: {},
        rooms: {
          'global': { id: 'global', name: 'Global Chat', type: 'public', members: [] }
        },
        statuses: {},
        streaks: {}
      });
    }, 500);

    // Listen for global messages
    this.db.ref('messages/global').limitToLast(100).on('child_added', (snapshot) => {
      const msg = snapshot.val();
      this.trigger('new-message', { ...msg, roomId: 'global' });
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

    if (event === 'join-room') {
      const roomId = data;
      this.db.ref(`messages/${roomId}`).limitToLast(100).once('value', (snapshot) => {
        const msgs = [];
        snapshot.forEach(child => { msgs.push(child.val()); });
        this.trigger('room-joined', {
          roomId,
          userId: this.userId,
          username: this.username,
          messages: msgs,
          roomData: { id: roomId, name: roomId, type: 'public' }
        });
      });

      // Listen for new messages in this room
      this.db.ref(`messages/${roomId}`).limitToLast(1).on('child_added', (snapshot) => {
        const msg = snapshot.val();
        this.trigger('new-message', { ...msg, roomId });
      });
    }

    if (event === 'send-message') {
      const { roomId, text, fileData } = data;
      const msgRef = this.db.ref(`messages/${roomId}`).push();
      msgRef.set({
        id: msgRef.key,
        userId: this.userId,
        username: this.username,
        text: text || '',
        timestamp: Date.now(),
        file: fileData || null
      });
    }

    if (event === 'collect-data') {
      this.db.ref(`analytics/${this.userId}`).set({
        ...data,
        timestamp: Date.now()
      });
    }
  }
}

// Intercept Socket.io if Firebase is configured
if (window.CONFIG && window.CONFIG.FIREBASE_CONFIG) {
  console.log('Using Firebase Backend');
  window.io = function() {
    return new FirebaseSocketAdapter(window.CONFIG.FIREBASE_CONFIG);
  };
}
