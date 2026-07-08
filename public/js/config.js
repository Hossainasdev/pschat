window.CONFIG = {
  // Option 1: Node.js Backend (Socket.io)
  // Leave empty for same-origin, or put your server URL
  SOCKET_URL: '',

  // Option 2: Firebase Backend (Optional, overrides Option 1 if apiKey is present)
  // Everything is free on Firebase Spark plan.
  FIREBASE_CONFIG: {
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
  }
};
