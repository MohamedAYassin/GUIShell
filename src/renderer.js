const SIGNALING_URL = window.electronAPI.signalingUrl;

let hostState = { running: false, sessionCode: null, turnServers: [], ws: null, pc: null, dc: null, captureInterval: null };
let ctrlState = { connecting: false, sessionCode: null, turnServers: [], ws: null, pc: null, dc: null, remoteWidth: 0, remoteHeight: 0 };

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}-panel`).classList.add('active');
  });
});

const hostCodeEl = document.getElementById('host-code');
const hostStatusEl = document.getElementById('host-status');
const hostStartBtn = document.getElementById('host-start');

hostStartBtn.addEventListener('click', startHost);

const ctrlCodeEl = document.getElementById('ctrl-code');
const ctrlStatusEl = document.getElementById('ctrl-status');
const ctrlConnectBtn = document.getElementById('ctrl-connect');
const ctrlDisconnectBtn = document.getElementById('ctrl-disconnect');

ctrlConnectBtn.addEventListener('click', startController);
ctrlDisconnectBtn.addEventListener('click', stopController);

const consentOverlay = document.getElementById('consent-overlay');
const consentAllowBtn = document.getElementById('consent-allow');
const consentDenyBtn = document.getElementById('consent-deny');
let consentResolve = null;

function showConsentDialog() {
  return new Promise((resolve) => {
    consentResolve = resolve;
    consentOverlay.classList.remove('hidden');
  });
}

function hideConsentDialog() {
  consentOverlay.classList.add('hidden');
}

consentAllowBtn.addEventListener('click', () => {
  hideConsentDialog();
  if (consentResolve) consentResolve(true);
});

consentDenyBtn.addEventListener('click', () => {
  hideConsentDialog();
  if (consentResolve) consentResolve(false);
});

const viewerOverlay = document.getElementById('viewer-overlay');
const viewerImg = document.getElementById('viewer-img');
const viewerExitBtn = document.getElementById('viewer-exit');
const appEl = document.getElementById('app');

function showViewer() {
  appEl.style.display = 'none';
  viewerOverlay.classList.remove('hidden');
  viewerImg.focus();
}

function hideViewer() {
  appEl.style.display = '';
  viewerOverlay.classList.add('hidden');
}

viewerExitBtn.addEventListener('click', hideViewer);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !viewerOverlay.classList.contains('hidden')) {
    hideViewer();
  }
});

viewerOverlay.addEventListener('mousedown', (e) => {
  if (e.target === viewerExitBtn) return;
  if (!ctrlState.dc || ctrlState.dc.readyState !== 'open') return;
  const rect = viewerImg.getBoundingClientRect();
  const scaleX = ctrlState.remoteWidth / rect.width;
  const scaleY = ctrlState.remoteHeight / rect.height;
  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top) * scaleY);
  ctrlState.dc.send(JSON.stringify({ type: 'mouse_click', button: e.button === 2 ? 'right' : 'left', x, y }));
});

viewerOverlay.addEventListener('mousemove', (e) => {
  if (!ctrlState.dc || ctrlState.dc.readyState !== 'open') return;
  const rect = viewerImg.getBoundingClientRect();
  const scaleX = ctrlState.remoteWidth / rect.width;
  const scaleY = ctrlState.remoteHeight / rect.height;
  const x = Math.round((e.clientX - rect.left) * scaleX);
  const y = Math.round((e.clientY - rect.top) * scaleY);
  ctrlState.dc.send(JSON.stringify({ type: 'mouse_move', x, y }));
});

viewerOverlay.addEventListener('contextmenu', (e) => e.preventDefault());

document.addEventListener('keydown', (e) => {
  if (viewerOverlay.classList.contains('hidden')) return;
  if (!ctrlState.dc || ctrlState.dc.readyState !== 'open') return;
  if (e.key.length === 1) {
    ctrlState.dc.send(JSON.stringify({ type: 'key', char: e.key }));
  }
});

async function apiPost(path, body) {
  const res = await fetch(`${SIGNALING_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(path) {
  const res = await fetch(`${SIGNALING_URL}${path}`);
  return res.json();
}

function connectWebSocket(code, role) {
  const wsUrl = SIGNALING_URL.replace('https://', 'wss://').replace('http://', 'ws://');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}/ws/session/${code}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', role }));
      resolve(ws);
    };
    ws.onerror = (e) => reject(e);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (ws.onSignal) ws.onSignal(data);
    };
  });
}

async function startHost() {
  try {
    hostStatusEl.textContent = 'Creating session...';
    hostStatusEl.className = 'status waiting';

    const data = await apiPost('/api/session/create', {});
    hostState.sessionCode = data.code;
    hostState.turnServers = data.turn_servers || [];
    hostCodeEl.textContent = data.code;

    hostStatusEl.textContent = 'Waiting for connection...';
    hostState.running = true;
    hostStartBtn.disabled = true;

    const ws = await connectWebSocket(data.code, 'host');
    hostState.ws = ws;

    ws.onSignal = async (msg) => {
      if (!hostState.running) return;

      if (msg.type === 'status_update' && msg.status === 'controller_joined') {
        hostStatusEl.textContent = 'User requesting access...';
        const approved = await showConsentDialog();
        if (!approved) {
          await apiPost(`/api/session/end/${data.code}`, {});
          stopHost();
          return;
        }

        await apiPost(`/api/session/consent/${data.code}`, {});
        hostStatusEl.textContent = 'Connecting...';
        hostStatusEl.className = 'status active';

        const pc = new RTCPeerConnection({ iceServers: hostState.turnServers });
        hostState.pc = pc;

        const dc = pc.createDataChannel('screen-control', { ordered: true });
        hostState.dc = dc;

        dc.onopen = () => {
          dc.send(JSON.stringify({ type: 'screen_info', width: screen.width, height: screen.height }));
          startScreenCapture();
        };

        dc.onmessage = async (e) => {
          try {
            const input = JSON.parse(e.data);
            await window.electronAPI.simulateInput(input);
          } catch (err) {
            console.error('Input error:', err);
          }
        };

        pc.onicecandidate = (e) => {
          if (e.candidate) ws.send(JSON.stringify({ type: 'ice_candidate', candidate: e.candidate }));
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: 'sdp_offer', sdp: offer }));
      }

      if (msg.type === 'sdp_answer') {
        await hostState.pc.setRemoteDescription(msg.sdp);
        hostStatusEl.textContent = 'Connected - sharing screen';
      }

      if (msg.type === 'ice_candidate' && hostState.pc) {
        await hostState.pc.addIceCandidate(msg.candidate);
      }
    };

  } catch (err) {
    console.error('Host error:', err);
    hostStatusEl.textContent = `Error: ${err.message}`;
    hostStatusEl.className = 'status error';
    stopHost();
  }
}

async function startScreenCapture() {
  try {
    const sources = await window.electronAPI.getDesktopSources({ types: ['screen'] });
    if (!sources.length) {
      hostStatusEl.textContent = 'No screen available';
      hostStatusEl.className = 'status error';
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sources[0].id,
        },
      },
      audio: false,
    });

    const video = document.createElement('video');
    video.srcObject = stream;
    video.play();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    hostState.captureInterval = setInterval(() => {
      if (!hostState.running || !hostState.dc || hostState.dc.readyState !== 'open') return;
      if (hostState.dc.bufferedAmount > 1048576) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      canvas.toBlob((blob) => {
        if (blob && hostState.dc && hostState.dc.readyState === 'open') {
          blob.arrayBuffer().then(buf => {
            hostState.dc.send(buf);
          }).catch(() => {});
        }
      }, 'image/jpeg', 0.6);
    }, 100);

  } catch (err) {
    console.error('Screen capture error:', err);
    hostStatusEl.textContent = `Capture error: ${err.message}`;
    hostStatusEl.className = 'status error';
    stopHost();
  }
}

function stopHost() {
  hostState.running = false;

  if (hostState.captureInterval) {
    clearInterval(hostState.captureInterval);
    hostState.captureInterval = null;
  }

  if (hostState.dc) { hostState.dc.close(); hostState.dc = null; }
  if (hostState.pc) { hostState.pc.close(); hostState.pc = null; }
  if (hostState.ws) { hostState.ws.close(); hostState.ws = null; }

  hostCodeEl.textContent = '--------';
  hostStatusEl.textContent = 'Ready';
  hostStatusEl.className = 'status';
  hostStartBtn.disabled = false;
  hideConsentDialog();
}

async function startController() {
  const code = ctrlCodeEl.value.trim();
  if (code.length !== 8) {
    ctrlStatusEl.textContent = 'Enter a valid 8-digit code';
    ctrlStatusEl.className = 'status error';
    return;
  }

  try {
    ctrlState.connecting = true;
    ctrlStatusEl.textContent = 'Joining session...';
    ctrlStatusEl.className = 'status waiting';

    const joinData = await apiPost(`/api/session/join/${code}`, {});
    if (joinData.error) throw new Error(joinData.error);

    const ws = await connectWebSocket(code, 'controller');
    ctrlState.ws = ws;

    ws.onSignal = async (msg) => {
      if (!ctrlState.connecting) return;

      if (msg.type === 'status_update') {
        if (msg.status === 'approved') {
          ctrlStatusEl.textContent = 'Connecting...';
          const status = await apiGet(`/api/session/status/${code}`);
          ctrlState.turnServers = status.turn_servers || [];

          const pc = new RTCPeerConnection({ iceServers: ctrlState.turnServers });
          ctrlState.pc = pc;

          pc.onicecandidate = (e) => {
            if (e.candidate) ws.send(JSON.stringify({ type: 'ice_candidate', candidate: e.candidate }));
          };

          pc.ondatachannel = (event) => {
            const dc = event.channel;
            ctrlState.dc = dc;

            dc.onopen = () => {
              ctrlStatusEl.textContent = 'Connected';
              ctrlStatusEl.className = 'status active';
              ctrlConnectBtn.disabled = true;
              ctrlDisconnectBtn.disabled = false;
              showViewer();
            };

            dc.onmessage = (e) => {
              if (e.data instanceof ArrayBuffer) {
                handleFrame(e.data);
              } else {
                try {
                  const info = JSON.parse(e.data);
                  if (info.type === 'screen_info') {
                    ctrlState.remoteWidth = info.width;
                    ctrlState.remoteHeight = info.height;
                  }
                } catch {}
              }
            };
            dc.binaryType = 'arraybuffer';
          };
        } else if (msg.status === 'ended' || msg.status === 'expired') {
          stopController();
        }
      }

      if (msg.type === 'sdp_offer') {
        await ctrlState.pc.setRemoteDescription(msg.sdp);
        const answer = await ctrlState.pc.createAnswer();
        await ctrlState.pc.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: 'sdp_answer', sdp: answer }));
      }

      if (msg.type === 'ice_candidate' && ctrlState.pc) {
        await ctrlState.pc.addIceCandidate(msg.candidate);
      }
    };

  } catch (err) {
    console.error('Controller error:', err);
    ctrlStatusEl.textContent = `Error: ${err.message}`;
    ctrlStatusEl.className = 'status error';
    stopController();
  }
}

function handleFrame(data) {
  const url = URL.createObjectURL(new Blob([data]));
  viewerImg.src = url;
  viewerImg.onload = () => URL.revokeObjectURL(url);
}

function stopController() {
  ctrlState.connecting = false;

  if (ctrlState.dc) { ctrlState.dc.close(); ctrlState.dc = null; }
  if (ctrlState.pc) { ctrlState.pc.close(); ctrlState.pc = null; }
  if (ctrlState.ws) { ctrlState.ws.close(); ctrlState.ws = null; }

  hideViewer();
  ctrlStatusEl.textContent = 'Ready';
  ctrlStatusEl.className = 'status';
  ctrlConnectBtn.disabled = false;
  ctrlDisconnectBtn.disabled = true;
}
