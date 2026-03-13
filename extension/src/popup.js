/**
 * SyncChord Popup Script
 * Controls analysis toggle + jam session UI.
 */

const $ = (id) => document.getElementById(id);

const toggleAnalysis = $('toggleAnalysis');
const chordEl = $('chord');
const bpmEl = $('bpm');
const confidenceEl = $('confidence');
const statusEl = $('status');
const joinBtn = $('joinRoom');
const createBtn = $('createRoom');
const roomInput = $('roomCode');

// ── Tab Communication ─────────────────────────────────────

function sendToTab(action, data = {}) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return resolve(null);
      chrome.tabs.sendMessage(tabs[0].id, { action, ...data }, resolve);
    });
  });
}

// ── State Polling ─────────────────────────────────────────

async function pollState() {
  const state = await sendToTab('getState');
  if (!state) {
    statusEl.textContent = 'YouTube 영상 페이지에서 사용하세요';
    return;
  }
  chordEl.textContent = state.chord || 'N/C';
  bpmEl.textContent = state.bpm > 0 ? `${Math.round(state.bpm)} BPM` : '— BPM';
  confidenceEl.textContent = `정확도 ${Math.round((state.confidence || 0) * 100)}%`;
  toggleAnalysis.checked = state.analyzing;
  statusEl.textContent = state.analyzing ? '분석 중...' : '대기 중';
}

// Poll every 500ms while popup is open
setInterval(pollState, 500);
pollState();

// ── Toggle ────────────────────────────────────────────────

toggleAnalysis.addEventListener('change', async () => {
  const action = toggleAnalysis.checked ? 'start' : 'stop';
  await sendToTab(action);
});

// ── Jam Session ───────────────────────────────────────────

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

createBtn.addEventListener('click', async () => {
  const code = generateRoomCode();
  roomInput.value = code;
  await sendToTab('joinSync', { roomCode: code, create: true });
  statusEl.textContent = `방 생성됨: ${code}`;
});

joinBtn.addEventListener('click', async () => {
  const code = roomInput.value.trim().toUpperCase();
  if (code.length !== 6) {
    statusEl.textContent = '6자리 코드를 입력하세요';
    return;
  }
  await sendToTab('joinSync', { roomCode: code });
  statusEl.textContent = `방 참가 중: ${code}`;
});
