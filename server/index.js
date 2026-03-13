/**
 * SyncChord WebSocket Sync Server
 * Manages jam rooms, BPM sync, and metronome broadcasting.
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8765;
const rooms = new Map(); // roomCode -> Room

class Room {
  constructor(code, hostId) {
    this.code = code;
    this.hostId = hostId;
    this.bpm = 120;
    this.users = new Map(); // userId -> { ws, nickname }
    this.tickInterval = null;
    this.beat = 0;
  }

  addUser(userId, ws, nickname) {
    this.users.set(userId, { ws, nickname });
    this._broadcast({
      type: 'user_joined',
      users: this._userList(),
      userId,
      nickname,
    });
  }

  removeUser(userId) {
    this.users.delete(userId);
    if (this.users.size === 0) {
      this.stopMetronome();
      rooms.delete(this.code);
      return;
    }
    // Transfer host if needed
    if (userId === this.hostId) {
      this.hostId = this.users.keys().next().value;
    }
    this._broadcast({
      type: 'user_left',
      users: this._userList(),
      userId,
    });
  }

  setBpm(bpm) {
    this.bpm = Math.max(30, Math.min(300, bpm));
    this._broadcast({ type: 'bpm_update', bpm: this.bpm });
    // Restart metronome with new BPM
    if (this.tickInterval) {
      this.startMetronome();
    }
  }

  startMetronome() {
    this.stopMetronome();
    this.beat = 0;
    const intervalMs = 60000 / this.bpm;
    this.tickInterval = setInterval(() => {
      this.beat = (this.beat % 4) + 1;
      this._broadcast({
        type: 'tick',
        beat: this.beat,
        timestamp: Date.now(),
      });
    }, intervalMs);
  }

  stopMetronome() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  _userList() {
    return Array.from(this.users.entries()).map(([id, u]) => ({
      userId: id,
      nickname: u.nickname,
      isHost: id === this.hostId,
    }));
  }

  _broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const [, user] of this.users) {
      if (user.ws.readyState === 1) {
        user.ws.send(payload);
      }
    }
  }
}

// ── WebSocket Server ──────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

// Track userId per connection
const connectionMap = new WeakMap(); // ws -> { userId, roomCode }

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    const { type, roomCode, userId, nickname } = msg;

    switch (type) {
      case 'create_room': {
        if (rooms.has(roomCode)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room already exists' }));
          return;
        }
        const room = new Room(roomCode, userId);
        rooms.set(roomCode, room);
        room.addUser(userId, ws, nickname || `User_${userId.slice(0, 4)}`);
        connectionMap.set(ws, { userId, roomCode });
        room.startMetronome();
        ws.send(JSON.stringify({
          type: 'room_joined',
          roomCode,
          isHost: true,
          bpm: room.bpm,
          users: room._userList(),
        }));
        break;
      }

      case 'join_room': {
        const room = rooms.get(roomCode);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
          return;
        }
        room.addUser(userId, ws, nickname || `User_${userId.slice(0, 4)}`);
        connectionMap.set(ws, { userId, roomCode });
        ws.send(JSON.stringify({
          type: 'room_joined',
          roomCode,
          isHost: false,
          bpm: room.bpm,
          users: room._userList(),
        }));
        break;
      }

      case 'set_bpm': {
        const room = rooms.get(roomCode);
        if (room) {
          room.setBpm(msg.bpm);
        }
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${type}` }));
    }
  });

  ws.on('close', () => {
    const info = connectionMap.get(ws);
    if (info) {
      const room = rooms.get(info.roomCode);
      if (room) room.removeUser(info.userId);
    }
  });
});

console.log(`[SyncChord Server] Running on ws://localhost:${PORT}`);
