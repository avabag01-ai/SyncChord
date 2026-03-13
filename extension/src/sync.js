/**
 * SyncChord WebSocket Sync Client
 * Manages connection to sync server for multi-user metronome jam.
 */

class SyncClient {
  constructor() {
    this.ws = null;
    this.roomCode = null;
    this.userId = this._generateId();
    this.nickname = `User_${this.userId.slice(0, 4)}`;
    this.users = [];
    this.bpm = 120;
    this.isHost = false;
    this.onStateChange = null;
    this.onTick = null;
    this.serverUrl = 'ws://localhost:8765';
  }

  _generateId() {
    return Math.random().toString(36).substring(2, 10);
  }

  connect(roomCode, create = false) {
    this.roomCode = roomCode;

    this.ws = new WebSocket(this.serverUrl);

    this.ws.onopen = () => {
      const msg = {
        type: create ? 'create_room' : 'join_room',
        roomCode: this.roomCode,
        userId: this.userId,
        nickname: this.nickname,
      };
      this.ws.send(JSON.stringify(msg));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this._handleMessage(data);
    };

    this.ws.onerror = (err) => {
      console.warn('[SyncChord Sync] WebSocket error:', err);
    };

    this.ws.onclose = () => {
      console.log('[SyncChord Sync] Disconnected');
      if (this.onStateChange) {
        this.onStateChange({ connected: false, users: [], bpm: this.bpm });
      }
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.roomCode = null;
  }

  sendBpm(bpm) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'set_bpm',
      bpm,
      roomCode: this.roomCode,
      userId: this.userId,
    }));
  }

  _handleMessage(data) {
    switch (data.type) {
      case 'room_joined':
        this.isHost = data.isHost || false;
        this.users = data.users || [];
        this.bpm = data.bpm || 120;
        if (this.onStateChange) {
          this.onStateChange({
            connected: true,
            roomCode: this.roomCode,
            users: this.users,
            bpm: this.bpm,
            isHost: this.isHost,
          });
        }
        break;

      case 'user_joined':
      case 'user_left':
        this.users = data.users || [];
        if (this.onStateChange) {
          this.onStateChange({
            connected: true,
            roomCode: this.roomCode,
            users: this.users,
            bpm: this.bpm,
          });
        }
        break;

      case 'bpm_update':
        this.bpm = data.bpm;
        if (this.onStateChange) {
          this.onStateChange({ bpm: this.bpm, connected: true });
        }
        break;

      case 'tick':
        if (this.onTick) {
          this.onTick(data.beat, data.timestamp);
        }
        break;

      case 'error':
        console.warn('[SyncChord Sync] Server error:', data.message);
        break;
    }
  }
}

// Export for content script
if (typeof window !== 'undefined') {
  window.SyncChordClient = SyncClient;
}
