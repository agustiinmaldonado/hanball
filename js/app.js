/* ── State ── */
let state = {
  scoreLeft: 0, scoreRight: 0,
  period: 1, periodMinutes: 30,
  timerRunning: false, timerSeconds: 30 * 60,
  ht1Left: 0, ht1Right: 0, ht2Left: 0, ht2Right: 0,
  penalties: { left: [], right: [] },
  arrow: 'none',
  currentLogoTarget: null,
  timeout: {
    left: { seconds: 60, running: false },
    right: { seconds: 60, running: false },
  },
  events: [],
};

/* ── Persistence ── */
const SAVE_KEY = 'handball_match_v1';

function saveState() {
  try {
    const snap = {
      state: JSON.parse(JSON.stringify(state)),
      tournamentName: document.getElementById('tournamentName')?.value || '',
      teamNameLeft: document.getElementById('teamNameLeft')?.value || '',
      teamNameRight: document.getElementById('teamNameRight')?.value || '',
      teamColorLeft: document.getElementById('teamColorLeft')?.value || '#F8F8F8',
      teamColorRight: document.getElementById('teamColorRight')?.value || '#F8F8F8',
      logoLeftHtml: document.getElementById('logoLeft')?.innerHTML || '',
      logoRightHtml: document.getElementById('logoRight')?.innerHTML || '',
    };
    // timerRunning always saves as false (can't restore a live timer)
    snap.state.timerRunning = false;
    snap.state.timeout.left.running = false;
    snap.state.timeout.right.running = false;
    localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
  } catch (e) { console.warn('saveState error', e); }
}

function loadState() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const snap = JSON.parse(raw);
    // Restore state object
    Object.assign(state, snap.state);
    // Restore DOM text fields
    document.getElementById('tournamentName').value = snap.tournamentName;
    document.getElementById('teamNameLeft').value = snap.teamNameLeft;
    document.getElementById('teamNameRight').value = snap.teamNameRight;
    document.getElementById('teamColorLeft').value = snap.teamColorLeft;
    document.getElementById('teamColorRight').value = snap.teamColorRight;
    updateTeamColor('left', snap.teamColorLeft);
    updateTeamColor('right', snap.teamColorRight);
    document.getElementById('logoLeft').innerHTML = snap.logoLeftHtml;
    document.getElementById('logoRight').innerHTML = snap.logoRightHtml;
    // Restore score display
    document.getElementById('scoreLeft').textContent = pad2(state.scoreLeft);
    document.getElementById('scoreRight').textContent = pad2(state.scoreRight);
    document.getElementById('periodNum').textContent = state.period;
    if (document.getElementById('ht1Left')) document.getElementById('ht1Left').textContent = state.ht1Left;
    if (document.getElementById('ht1Right')) document.getElementById('ht1Right').textContent = state.ht1Right;
    if (document.getElementById('ht2Left')) document.getElementById('ht2Left').textContent = state.ht2Left;
    if (document.getElementById('ht2Right')) document.getElementById('ht2Right').textContent = state.ht2Right;
    if (document.getElementById('ht2Block')) document.getElementById('ht2Block').style.display = state.period >= 2 ? '' : 'none';
    setArrow(state.arrow);
    renderTimer();
    renderPenalties('left');
    renderPenalties('right');
    renderTimeout('left');
    renderTimeout('right');
    return true;
  } catch (e) { console.warn('loadState error', e); return false; }
}

// --- Audio Context for Alerts ---
let audioCtx = null;
function initAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { console.log('Audio error', e); }
}
// Initialize on first click anywhere
document.addEventListener('click', initAudio, { once: true });
document.addEventListener('touchstart', initAudio, { once: true });

function logEvent(description) {
  const m = Math.floor(state.timerSeconds / 60);
  const s = state.timerSeconds % 60;
  const timeStr = `${pad2(m)}:${pad2(s)}`;
  const period = state.period;
  state.events.push({ timeStr, period, description });
}

let timerInterval = null;

/* ── Score ── */
function changeScore(side, delta) {
  const key = side === 'left' ? 'scoreLeft' : 'scoreRight';
  state[key] = Math.max(0, state[key] + delta);
  if (delta > 0) {
    const team = side === 'left' ? document.getElementById('teamNameLeft').value : document.getElementById('teamNameRight').value;
    logEvent(`GOL - ${team} (Marcador: ${state.scoreLeft} - ${state.scoreRight})`);
  }
  const el = document.getElementById(key);
  el.textContent = pad2(state[key]);
  el.style.color = '#fff';
  el.style.textShadow = '0 0 20px #fff, 0 0 40px #fff';
  setTimeout(() => { el.style.color = ''; el.style.textShadow = ''; }, 280);
}

function updateTeamColor(side, color) {
  document.documentElement.style.setProperty(`--team-color-${side}`, color);
  // Keep the circle button in sync
  const btn = document.getElementById('colorBtn' + side.charAt(0).toUpperCase() + side.slice(1));
  if (btn) { btn.style.background = color; btn.style.borderColor = color; btn.style.boxShadow = `0 0 8px ${color}`; }
  if (typeof isViewer !== 'undefined' && !isViewer) broadcastState();
}

function resetTeamColor(side) {
  const defaultColor = '#F8F8F8';
  const cap = side.charAt(0).toUpperCase() + side.slice(1);
  const inputEl = document.getElementById('teamColor' + cap);
  if (inputEl) inputEl.value = defaultColor;
  updateTeamColor(side, defaultColor);
  closeColorPicker(side);
}

function toggleColorPicker(side) {
  const cap = side.charAt(0).toUpperCase() + side.slice(1);
  const popover = document.getElementById('colorPopover' + cap);
  const otherCap = side === 'left' ? 'Right' : 'Left';
  document.getElementById('colorPopover' + otherCap).classList.remove('open');
  popover.classList.toggle('open');
}

function closeColorPicker(side) {
  const cap = side.charAt(0).toUpperCase() + side.slice(1);
  const popover = document.getElementById('colorPopover' + cap);
  if (popover) popover.classList.remove('open');
}

// Close popovers when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.color-picker-wrap')) {
    document.querySelectorAll('.color-picker-popover').forEach(p => p.classList.remove('open'));
  }
});

/* ── Timer ── */
function toggleTimer() {
  state.timerRunning ? pauseTimer() : startTimer();
}

function startTimer() {
  if (state.timerSeconds <= 0) return;
  state.timerRunning = true;
  const btn = document.getElementById('btnTimerStart');
  btn.textContent = '⏸ PAUSAR';
  btn.classList.remove('btn-green'); btn.classList.add('btn-red');
  setStatus('JUGANDO');
  timerInterval = setInterval(() => {
    if (state.timerSeconds > 0) {
      state.timerSeconds--;
      renderTimer();
      tickPenalties('left');
      tickPenalties('right');
      // broadcastState is handled by broadcastInterval every second
    } else {
      endPeriodTime();
      // broadcastState is handled by broadcastInterval every second
    }
  }, 1000);
}

function pauseTimer() {
  state.timerRunning = false;
  clearInterval(timerInterval); timerInterval = null;
  const btn = document.getElementById('btnTimerStart');
  btn.textContent = '▶ INICIAR';
  btn.classList.add('btn-green'); btn.classList.remove('btn-red');
  setStatus('PAUSADO');
}

function resetTimer() {
  pauseTimer();
  state.timerSeconds = state.periodMinutes * 60;
  renderTimer();
  document.getElementById('mainTimer').classList.remove('warning');
  setStatus('LISTO');
}

function endPeriodTime() {
  pauseTimer();
  state.timerSeconds = 0;
  renderTimer();
  setStatus('SE ACABÓ EL TIEMPO');
  const el = document.getElementById('mainTimer');
  el.classList.add('warning');
  setTimeout(() => el.classList.remove('warning'), 6000);
  playPenaltyAlert('center');
}

function renderTimer() {
  const m = Math.floor(state.timerSeconds / 60);
  const s = state.timerSeconds % 60;
  document.getElementById('mainTimer').textContent = `${pad2(m)}:${pad2(s)}`;
  const el = document.getElementById('mainTimer');
  if (state.timerSeconds <= 60 && state.timerRunning) el.classList.add('warning');
  else el.classList.remove('warning');
}

function addTime(sec) {
  state.timerSeconds = Math.max(0, Math.min(state.timerSeconds + sec, 5999));
  renderTimer();
}

function openTimerModal() {
  document.getElementById('setMin').value = state.periodMinutes;
  document.getElementById('setSec').value = 0;
  openModal('timerModal');
}

function quickTime(min) { document.getElementById('setMin').value = min; document.getElementById('setSec').value = 0; }

function applyTimer() {
  const m = parseInt(document.getElementById('setMin').value) || 0;
  const s = parseInt(document.getElementById('setSec').value) || 0;
  state.periodMinutes = m;
  state.timerSeconds = m * 60 + s;
  renderTimer();
  closeModal('timerModal');
  setStatus('LISTO');
}

/* ── Period ── */
function changePeriod(delta) {
  const isFullTime = (state.timerSeconds === state.periodMinutes * 60);
  const isZero = (state.timerSeconds === 0);

  if (state.timerRunning || (!isZero && !isFullTime)) {
    showAlert("El período solo se puede cambiar cuando el reloj llega a 00:00 o antes de que inicie el partido.");
    return;
  }

  state.period = Math.max(1, Math.min(state.period + delta, 9));
  document.getElementById('periodNum').textContent = state.period;
  resetTimer();
}

/* ── Halftime ── */
function saveHalftime() {
  if (state.period === 1) {
    state.ht1Left = state.scoreLeft; state.ht1Right = state.scoreRight;
    if (document.getElementById('ht1Left')) document.getElementById('ht1Left').textContent = state.ht1Left;
    if (document.getElementById('ht1Right')) document.getElementById('ht1Right').textContent = state.ht1Right;
    setStatus('PARCIAL 1° GUARDADO');
  } else {
    state.ht2Left = state.scoreLeft; state.ht2Right = state.scoreRight;
    if (document.getElementById('ht2Left')) document.getElementById('ht2Left').textContent = state.ht2Left;
    if (document.getElementById('ht2Right')) document.getElementById('ht2Right').textContent = state.ht2Right;
    if (document.getElementById('ht2Block')) document.getElementById('ht2Block').style.display = '';
    setStatus('PARCIAL 2° GUARDADO');
  }
}

/* ── Arrow ── */
function setArrow(side) {
  state.arrow = side;
  document.getElementById('arrowLeft').style.opacity = side === 'left' ? '1' : '0';
  document.getElementById('arrowRight').style.opacity = side === 'right' ? '1' : '0';
}

/* ── Penalties ── */
function addPenalty(side) {
  const id = Date.now();
  state.penalties[side].push({ id, seconds: 120, running: false, player: '??' });
  const team = side === 'left' ? document.getElementById('teamNameLeft').value : document.getElementById('teamNameRight').value;
  logEvent(`PENAL AGREGADO - ${team}`);
  renderPenalties(side);

  // Auto-focus on the player number input
  setTimeout(() => {
    const el = document.getElementById('penNum-' + id);
    if (el) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, 50);
}

function removePenalty(side, id) {
  state.penalties[side] = state.penalties[side].filter(p => p.id !== id);
  renderPenalties(side);
}

function togglePenaltyTimer(side, id) {
  const pen = state.penalties[side].find(p => p.id === id);
  if (pen) { pen.running = !pen.running; renderPenalties(side); }
}

function tickPenalties(side) {
  let changed = false;
  state.penalties[side].forEach(pen => {
    if (pen.running && pen.seconds > 0) {
      pen.seconds--; changed = true;
      if (pen.seconds === 0) {
        pen.running = false;
        playPenaltyAlert(side);
        setTimeout(() => removePenalty(side, pen.id), 3000);
      }
    }
  });
  if (changed) renderPenalties(side);
}

function playPenaltyAlert(side) {
  // Sonido (Beep) usando Web Audio API (no requiere archivos mp3 externos)
  try {
    if (!audioCtx) initAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // Nota alta
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime); // Volumen suave
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  } catch (e) { console.log('Audio no soportado o bloqueado', e); }

  // Alerta visual: Parpadeo verde en el panel del equipo o centro
  if (side === 'center') {
    const el = document.getElementById('mainTimer');
    if (el) {
      el.classList.add('flash-green');
      setTimeout(() => el.classList.remove('flash-green'), 1000);
    }
  } else {
    const panelId = side === 'left' ? 'teamPanelLeft' : 'teamPanelRight';
    const panel = document.getElementById(panelId) || document.body;
    panel.classList.add('flash-green');
    setTimeout(() => panel.classList.remove('flash-green'), 1000);
  }
}

function renderPenalties(side) {
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const container = document.getElementById('penalties' + cap(side));
  container.innerHTML = '';
  state.penalties[side].forEach(pen => {
    const m = Math.floor(pen.seconds / 60), s = pen.seconds % 60;
    const row = document.createElement('div');
    row.className = 'penalty-row';
    row.innerHTML = `
        <span class="penalty-num" contenteditable="true" id="penNum-${pen.id}"
          onblur="updatePlayer('${side}',${pen.id},this.textContent.trim())"
          title="Número jugador">${pen.player}</span>
        <span class="penalty-timer-display ${pen.running ? 'running' : ''}"
          onclick="togglePenaltyTimer('${side}',${pen.id})"
          title="Click iniciar/pausar">${pad2(m)}:${pad2(s)}</span>
        <button class="btn btn-red btn-sm" style="padding:1px 5px;font-size:11px;"
          onclick="removePenalty('${side}',${pen.id})">✖</button>`;
    container.appendChild(row);
  });
}

function updatePlayer(side, id, val) {
  const pen = state.penalties[side].find(p => p.id === id);
  if (pen) {
    pen.player = val || '??';
    const team = side === 'left' ? document.getElementById('teamNameLeft').value : document.getElementById('teamNameRight').value;
    logEvent(`JUGADOR PENADO - ${team} (Camiseta N° ${pen.player})`);
  }
}

/* ── Logo ── */
document.getElementById('logoLeft').addEventListener('click', () => handleLogoClick('logoLeft'));
document.getElementById('logoRight').addEventListener('click', () => handleLogoClick('logoRight'));

function handleLogoClick(targetId) {
  state.currentLogoTarget = targetId;
  const el = document.getElementById(targetId);
  const img = el.querySelector('img');

  if (img && img.src) {
    document.getElementById('viewerImage').src = img.src;
    // Get the corresponding team name
    const teamNameId = targetId === 'logoLeft' ? 'teamNameLeft' : 'teamNameRight';
    const teamName = document.getElementById(teamNameId).value || (targetId === 'logoLeft' ? 'LOCAL' : 'VISITANTE');
    const teamColor = document.getElementById(targetId === 'logoLeft' ? 'teamColorLeft' : 'teamColorRight')?.value || '#F8F8F8';

    const titleEl = document.getElementById('viewerTeamName');
    titleEl.textContent = teamName;
    titleEl.style.color = teamColor;
    titleEl.style.textShadow = `0 0 10px ${teamColor}88`;
    titleEl.style.borderColor = teamColor;
    document.getElementById('viewerImage').style.borderColor = teamColor;
    document.getElementById('viewerImage').style.boxShadow = `0 0 30px ${teamColor}88`;

    openModal('viewerModal');
  } else {
    if (typeof isViewer !== 'undefined' && isViewer) return;
    resetLogoModal();
    openModal('logoModal');
  }
}

function openLogoPickerFromViewer() {
  closeModal('viewerModal');
  resetLogoModal();
  openModal('logoModal');
}

function removeLogo() {
  if (!state.currentLogoTarget) return;
  const el = document.getElementById(state.currentLogoTarget);
  el.innerHTML = 'LOGO';
  closeModal('viewerModal');
  setStatus('LOGO ELIMINADO');
  if (typeof isViewer !== 'undefined' && !isViewer) broadcastState();
}

function resetLogoModal() {
  document.getElementById('logoUrlInput').value = '';
  const prev = document.getElementById('logoPreview');
  prev.src = ''; prev.classList.remove('visible');
}

function setLogoImage(src) {
  if (!state.currentLogoTarget || !src) return;
  const el = document.getElementById(state.currentLogoTarget);
  el.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='ERR'" />`;
  closeModal('logoModal');
  setStatus('LOGO ACTUALIZADO');
}

function triggerCamera() {
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    // En móvil: abre la cámara nativa
    document.getElementById('fileInputCamera').click();
  } else {
    // En PC: abre el modal con webcam
    openWebcamModal();
  }
}

let webcamStream = null;

function openWebcamModal() {
  closeModal('logoModal');
  const modal = document.getElementById('webcamModal');
  modal.classList.add('open');
  navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
      webcamStream = stream;
      const video = document.getElementById('webcamVideo');
      video.srcObject = stream;
      video.play();
    })
    .catch(() => {
      closeWebcamModal();
      openModal('logoModal');
      showAlert('No se pudo acceder a la cámara. Asegurate de dar permiso al navegador.');
    });
}

function closeWebcamModal() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  document.getElementById('webcamModal').classList.remove('open');
}

function captureWebcam() {
  const video = document.getElementById('webcamVideo');
  const canvas = document.createElement('canvas');
  const MAX = 160;
  let w = video.videoWidth || 320, h = video.videoHeight || 240;
  if (w > h) { h = Math.round(h * MAX / w); w = MAX; } else { w = Math.round(w * MAX / h); h = MAX; }
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  const src = canvas.toDataURL('image/jpeg', 0.7);
  closeWebcamModal();
  setLogoImage(src);
}

function triggerGallery() {
  document.getElementById('fileInputGallery').click();
}

/* ── Compress a Data URI to max WxH at JPEG quality q ── */
function compressImage(src, maxPx, quality, cb) {
  const img = new Image();
  img.onload = function () {
    let w = img.width, h = img.height;
    if (w > maxPx || h > maxPx) {
      if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
      else { w = Math.round(w * maxPx / h); h = maxPx; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    cb(c.toDataURL('image/jpeg', quality));
  };
  img.onerror = () => cb(src); // fallback: use original
  img.src = src;
}

// Store small thumbnails for broadcast (to keep payload small)
const logoBroadcastSrc = { left: '', right: '' };

function handleFileInput(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const original = e.target.result;
    // High quality for local display (400px, quality 0.92)
    compressImage(original, 400, 0.92, (hq) => {
      const prev = document.getElementById('logoPreview');
      prev.src = hq;
      prev.classList.add('visible');
      // Also generate a small thumbnail just for broadcast
      compressImage(original, 120, 0.65, (thumb) => {
        // Store thumbnail keyed to current logo target
        const side = state.currentLogoTarget === 'logoLeft' ? 'left' : 'right';
        logoBroadcastSrc[side] = thumb;
        setTimeout(() => setLogoImage(hq), 600);
      });
    });
  };
  reader.readAsDataURL(file);
}

document.getElementById('fileInputCamera').addEventListener('change', e => handleFileInput(e.target.files[0]));
document.getElementById('fileInputGallery').addEventListener('change', e => handleFileInput(e.target.files[0]));

function previewUrl(url) {
  const prev = document.getElementById('logoPreview');
  if (url.startsWith('http')) {
    prev.src = url;
    prev.classList.add('visible');
  } else {
    prev.classList.remove('visible');
  }
}

function applyLogoUrl() {
  const url = document.getElementById('logoUrlInput').value.trim();
  if (url) setLogoImage(url);
}

function cancelLogoModal() {
  document.getElementById('fileInputCamera').value = '';
  document.getElementById('fileInputGallery').value = '';
  closeModal('logoModal');
}

function applyLogo() {
  const url = document.getElementById('logoUrlInput').value.trim();
  if (url && state.currentLogoTarget) {
    const el = document.getElementById(state.currentLogoTarget);
    el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.textContent='ERR'" />`;
  }
  closeModal('logoModal');
}

/* ── Custom Confirm ── */
function showConfirm(msg, onOk) {
  document.getElementById('confirmMsg').textContent = msg;
  const okBtn = document.getElementById('confirmOk');
  okBtn.onclick = () => { closeModal('confirmModal'); onOk(); };
  openModal('confirmModal');
}

/* ── Game ── */
function startGame() {
  showConfirm('¿Iniciar nuevo partido?\nSe resetearán TODOS los datos y equipos (nombres, logos, colores).', fullReset);
}

function confirmReset() {
  showConfirm('¿Resetear marcador y tiempos?\nSe pondrá todo en 0, pero se CONSERVARÁN los equipos actuales (nombres, logos y colores).', softReset);
}

function softReset() {
  pauseTimer();

  // Reset periodMinutes to default 30 so the timer restores to 30:00
  state.periodMinutes = 30;

  Object.assign(state, {
    scoreLeft: 0, scoreRight: 0, period: 1,
    timerSeconds: 30 * 60,
    timerRunning: false,
    ht1Left: 0, ht1Right: 0, ht2Left: 0, ht2Right: 0,
    penalties: { left: [], right: [] }, arrow: 'none',
    events: [],
    timeout: { left: { seconds: 60, running: false }, right: { seconds: 60, running: false } }
  });

  // Reset score UI (do not reset logos/colors)
  ['scoreLeft', 'scoreRight'].forEach(id => document.getElementById(id).textContent = '00');
  document.getElementById('periodNum').textContent = '1';
  ['ht1Left', 'ht1Right'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });
  if (document.getElementById('ht2Block')) document.getElementById('ht2Block').style.display = 'none';
  document.getElementById('penaltiesLeft').innerHTML = '';
  document.getElementById('penaltiesRight').innerHTML = '';

  // Reset timer display properly (removes warning class too)
  document.getElementById('mainTimer').classList.remove('warning');
  document.getElementById('btnTimerStart').textContent = '▶ INICIAR';
  document.getElementById('btnTimerStart').classList.add('btn-green');
  document.getElementById('btnTimerStart').classList.remove('btn-red');

  setArrow('none');
  renderTimer();
  renderTimeout('left');
  renderTimeout('right');
  setStatus('MARCADOR REINICIADO');
  saveState();
  broadcastState();
}

function fullReset() {
  pauseTimer();

  // Reset periodMinutes to default 30 so the timer restores to 30:00
  state.periodMinutes = 30;

  Object.assign(state, {
    scoreLeft: 0, scoreRight: 0, period: 1,
    timerSeconds: 30 * 60,
    timerRunning: false,
    ht1Left: 0, ht1Right: 0, ht2Left: 0, ht2Right: 0,
    penalties: { left: [], right: [] }, arrow: 'none',
    events: [],
    timeout: { left: { seconds: 60, running: false }, right: { seconds: 60, running: false } }
  });

  // Reset inputs
  document.getElementById('tournamentName').value = 'NACIONAL 2026';
  document.getElementById('teamNameLeft').value = 'LOCAL';
  document.getElementById('teamNameRight').value = 'VISITANTE';

  // Reset logos
  document.getElementById('logoLeft').innerHTML = 'LOGO';
  document.getElementById('logoRight').innerHTML = 'LOGO';

  // Reset colors
  resetTeamColor('left');
  resetTeamColor('right');

  // Reset score UI
  ['scoreLeft', 'scoreRight'].forEach(id => document.getElementById(id).textContent = '00');
  document.getElementById('periodNum').textContent = '1';
  ['ht1Left', 'ht1Right'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });
  if (document.getElementById('ht2Block')) document.getElementById('ht2Block').style.display = 'none';
  document.getElementById('penaltiesLeft').innerHTML = '';
  document.getElementById('penaltiesRight').innerHTML = '';

  // Reset timer display properly (removes warning class too)
  document.getElementById('mainTimer').classList.remove('warning');
  document.getElementById('btnTimerStart').textContent = '▶ INICIAR';
  document.getElementById('btnTimerStart').classList.add('btn-green');
  document.getElementById('btnTimerStart').classList.remove('btn-red');

  setArrow('none');
  renderTimer();
  renderTimeout('left');
  renderTimeout('right');
  setStatus('NUEVO PARTIDO');
  localStorage.removeItem(SAVE_KEY);
  broadcastState();
}


/* ── Modals ── */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

/* ── Status ── */
function setStatus(msg) {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.style.color = 'var(--led-orange)';
  setTimeout(() => { el.style.color = ''; }, 3500);
}

/* ── Keyboard shortcuts ── */
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.contentEditable === 'true') return;
  if (isViewer) return;
  if (e.key === ' ') { e.preventDefault(); toggleTimer(); }
  // LOCAL: ↑ suma, ↓ resta
  else if (e.key === 'ArrowUp') { e.preventDefault(); changeScore('left', 1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); changeScore('left', -1); }
  // VISITANTE: ← suma, → resta
  else if (e.key === 'ArrowLeft') { e.preventDefault(); changeScore('right', 1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); changeScore('right', -1); }

  // P = pena LOCAL  |  Shift+P = pena VISITANTE
  else if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    addPenalty(e.shiftKey ? 'right' : 'left');
  }
  // T = tiempo muerto LOCAL  |  Shift+T = tiempo muerto VISITANTE
  else if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    toggleTimeout(e.shiftKey ? 'right' : 'left');
  }

  /* ── Botones de volumen (Android Chrome/Firefox) ── */
  else if (e.key === 'AudioVolumeUp' || e.keyCode === 175) { e.preventDefault(); changeScore('left', 1); }
  else if (e.key === 'AudioVolumeDown' || e.keyCode === 174) { e.preventDefault(); changeScore('right', 1); }
});

/* ── Helpers ── */
function pad2(n) { return String(n).padStart(2, '0'); }

/* ── Init ── */
renderTimer();

/* ── Networking (Supabase Realtime) ── */
const SUPABASE_URL = 'https://jwdqjfvvgpjdaobkrphx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_m1fsgAiavkgIMavKhLmUXQ_-FeIFgaN';
let supabaseClient = null;
let realtimeChannel = null;

const urlParams = new URLSearchParams(window.location.search);
const watchId = urlParams.get('watch');
const isViewer = !!watchId;

if (isViewer) {
  document.body.classList.add('viewer-mode');
  document.getElementById('loginOverlay').style.display = 'none';
  setStatus('ESPECTADOR - CONECTANDO...');

  // Make team names clickable for viewers to see the logo/name full screen
  ['Left', 'Right'].forEach(side => {
    const input = document.getElementById('teamName' + side);
    input.readOnly = true;
    input.style.pointerEvents = 'auto';
    input.style.cursor = 'zoom-in';
    input.addEventListener('click', () => handleLogoClick('logo' + side));
  });

  initViewer(watchId);
} else {
  if (sessionStorage.getItem('handball_admin') === 'true') {
    document.getElementById('loginOverlay').style.display = 'none';
    if (loadState()) { setStatus('PARTIDO RESTAURADO'); }
    // Iniciar peer automáticamente al restaurar sesión
    setTimeout(() => startAdminPeer(false), 300);
  } else {
    document.getElementById('loginPin').focus();
  }
}

async function checkLogin() {
  // --- Lockout check ---
  const LOCKOUT_KEY = 'handball_lockout';
  const ATTEMPTS_KEY = 'handball_attempts';
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

  const lockoutUntil = parseInt(localStorage.getItem(LOCKOUT_KEY) || '0');
  if (Date.now() < lockoutUntil) {
    const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
    const err = document.getElementById('loginError');
    err.textContent = `Demasiados intentos. Esperá ${remaining} seg.`;
    err.style.display = 'block';
    setTimeout(() => { err.style.display = 'none'; err.textContent = 'Contraseña incorrecta'; }, 3000);
    return;
  }

  // --- Hash the entered password and compare ---
  const CORRECT_HASH = '1a4238a50ca1f59987255be338305b87a74a86d2e526138b7b7ed3215408b782';
  const input = document.getElementById('loginPin').value;
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  if (hashHex === CORRECT_HASH) {
    // Success — clear attempts and unlock
    localStorage.removeItem(ATTEMPTS_KEY);
    localStorage.removeItem(LOCKOUT_KEY);
    document.getElementById('loginOverlay').style.display = 'none';
    sessionStorage.setItem('handball_admin', 'true');
    if (loadState()) { setStatus('PARTIDO RESTAURADO'); }
    setTimeout(() => startAdminPeer(false), 300);
  } else {
    // Failed attempt
    const attempts = parseInt(localStorage.getItem(ATTEMPTS_KEY) || '0') + 1;
    localStorage.setItem(ATTEMPTS_KEY, attempts);
    const err = document.getElementById('loginError');
    document.getElementById('loginPin').value = '';
    if (attempts >= MAX_ATTEMPTS) {
      localStorage.setItem(LOCKOUT_KEY, Date.now() + LOCKOUT_MS);
      localStorage.removeItem(ATTEMPTS_KEY);
      err.textContent = 'Demasiados intentos. Bloqueado por 5 minutos.';
    } else {
      err.textContent = `Contraseña incorrecta (${attempts}/${MAX_ATTEMPTS} intentos)`;
    }
    err.style.display = 'block';
    setTimeout(() => { err.style.display = 'none'; err.textContent = 'Contraseña incorrecta'; }, 3000);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   NETWORKING — Supabase Realtime
   ROOM_ID fijo → mismo link siempre.
   Admin: único Peer como host, broadcastInterval único.
   Viewer: Peer random, se conecta al host, receptor puro.
═══════════════════════════════════════════════════════════════════ */
const ROOM_ID = 'handball-frias-live';
let broadcastInterval = null;

/* ───── ADMIN ───── */

function startAdminPeer(showModal) {
  if (supabaseClient && realtimeChannel) {
    // Supabase already initialized — show modal if requested
    if (showModal) { openModal('shareModal'); fillShareModal(); }
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    realtimeChannel = supabaseClient.channel(ROOM_ID, {
      config: {
        broadcast: { self: false }
      }
    });

    realtimeChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        // Un solo intervalo, siempre activo mientras hay canal
        clearInterval(broadcastInterval);
        broadcastInterval = setInterval(broadcastState, 1000);
        if (showModal) { openModal('shareModal'); fillShareModal(); }
      } else {
        clearInterval(broadcastInterval);
      }
    });
  } catch (e) {
    console.error("Error al iniciar Supabase Admin:", e);
    if (showModal) {
      document.getElementById('shareStatus').textContent = 'Error al conectar. Reintentando...';
      document.getElementById('shareStatus').style.color = 'var(--led-red)';
    }
    setTimeout(() => startAdminPeer(false), 5000);
  }
}

function fillShareModal() {
  const shareUrl = window.location.href.split('?')[0] + '?watch=' + ROOM_ID;
  document.getElementById('shareStatus').textContent = '✔ EN VIVO — sala: ' + ROOM_ID;
  document.getElementById('shareStatus').style.color = '#00cc44';
  document.getElementById('shareLinkInput').value = shareUrl;
  const qr = document.getElementById('qrcode');
  qr.innerHTML = '';
  new QRCode(qr, {
    text: shareUrl, width: 160, height: 160,
    colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.L
  });
}

function initAdminNetwork() {
  openModal('shareModal');
  if (supabaseClient && realtimeChannel) { fillShareModal(); return; }
  document.getElementById('shareStatus').textContent = 'Conectando al servidor...';
  document.getElementById('shareStatus').style.color = 'var(--led-orange)';
  startAdminPeer(true);
}

function copyShareLink() {
  const input = document.getElementById('shareLinkInput');
  input.select(); document.execCommand('copy');
  setStatus('LINK COPIADO');
}

function broadcastState() {
  if (isViewer || !supabaseClient || !realtimeChannel) return;
  const s = state;
  const payload = {
    timerSeconds: s.timerSeconds,
    timerRunning: s.timerRunning,
    scoreLeft: s.scoreLeft,
    scoreRight: s.scoreRight,
    period: s.period,
    periodMinutes: s.periodMinutes,
    ht1Left: s.ht1Left, ht1Right: s.ht1Right,
    ht2Left: s.ht2Left, ht2Right: s.ht2Right,
    arrow: s.arrow,
    penalties: JSON.parse(JSON.stringify(s.penalties)),
    timeout: JSON.parse(JSON.stringify(s.timeout)),
    tournamentName: document.getElementById('tournamentName').value,
    teamNameLeft: document.getElementById('teamNameLeft').value,
    teamNameRight: document.getElementById('teamNameRight').value,
    teamColorLeft: document.getElementById('teamColorLeft').value,
    teamColorRight: document.getElementById('teamColorRight').value,
    logoLeftHtml: (() => {
      const side = 'left';
      if (logoBroadcastSrc[side]) {
        return `<img src="${logoBroadcastSrc[side]}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
      }
      return document.getElementById('logoLeft').innerHTML;
    })(),
    logoRightHtml: (() => {
      const side = 'right';
      if (logoBroadcastSrc[side]) {
        return `<img src="${logoBroadcastSrc[side]}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
      }
      return document.getElementById('logoRight').innerHTML;
    })(),
  };
  realtimeChannel.send({
    type: 'broadcast',
    event: 'match_state',
    payload: payload
  });
}

// Broadcast en cada acción del admin (goles, nombres, etc.)
document.addEventListener('click', () => { if (!isViewer) { setTimeout(broadcastState, 50); setTimeout(saveState, 100); } });
document.addEventListener('keyup', () => { if (!isViewer) { setTimeout(broadcastState, 50); setTimeout(saveState, 100); } });
setInterval(() => { if (!isViewer && state.timerRunning) saveState(); }, 5000);

/* ───── VIEWER ───── */

function initViewer(watchId) {
  let retryCount = 0;
  const MAX_RETRIES = 20;
  let noDataTimer = null;
  const NO_DATA_TIMEOUT = 7000; // 7 seconds without data = show offline msg

  let prevTimer = null;
  let prevTimeouts = { left: null, right: null };
  let prevPenalties = { left: [], right: [] };

  function showOffline() {
    setStatus('SIN TRANSMISIÓN — No hay partido en curso');
  }

  function applyData(d) {
    // Check for zero-crossings to play buzzer on spectator view
    if (prevTimer !== null && prevTimer > 0 && d.timerSeconds === 0 && !d.timerRunning) {
      playPenaltyAlert('center');
    }
    prevTimer = d.timerSeconds;

    ['left', 'right'].forEach(side => {
      // Timeouts
      const oldT = prevTimeouts[side];
      const curT = d.timeout[side];
      if (oldT !== null && oldT > 0 && curT.seconds === 0 && !curT.running) {
        playPenaltyAlert(side);
      }
      prevTimeouts[side] = curT.seconds;

      // Penalties
      d.penalties[side].forEach(pen => {
        const oldPen = prevPenalties[side].find(op => op.id === pen.id);
        if (oldPen && oldPen.seconds > 0 && pen.seconds === 0) {
          playPenaltyAlert(side);
        }
      });
      prevPenalties[side] = d.penalties[side].map(p => ({ id: p.id, seconds: p.seconds }));
    });

    // Aplicar todos los campos del estado recibido directamente
    state.timerSeconds = d.timerSeconds;
    state.timerRunning = d.timerRunning;
    state.scoreLeft = d.scoreLeft;
    state.scoreRight = d.scoreRight;
    state.period = d.period;
    state.periodMinutes = d.periodMinutes;
    state.ht1Left = d.ht1Left; state.ht1Right = d.ht1Right;
    state.ht2Left = d.ht2Left; state.ht2Right = d.ht2Right;
    state.arrow = d.arrow;
    state.penalties = d.penalties;
    state.timeout = d.timeout;

    // Nombres / colores / logos
    document.getElementById('tournamentName').value = d.tournamentName;
    document.getElementById('teamNameLeft').value = d.teamNameLeft;
    document.getElementById('teamNameRight').value = d.teamNameRight;
    document.getElementById('teamColorLeft').value = d.teamColorLeft;
    document.getElementById('teamColorRight').value = d.teamColorRight;
    updateTeamColor('left', d.teamColorLeft);
    updateTeamColor('right', d.teamColorRight);
    document.getElementById('logoLeft').innerHTML = d.logoLeftHtml;
    document.getElementById('logoRight').innerHTML = d.logoRightHtml;

    // Marcador
    document.getElementById('scoreLeft').textContent = pad2(state.scoreLeft);
    document.getElementById('scoreRight').textContent = pad2(state.scoreRight);

    // Período
    document.getElementById('periodNum').textContent = state.period;
    if (document.getElementById('ht1Left')) document.getElementById('ht1Left').textContent = state.ht1Left;
    if (document.getElementById('ht1Right')) document.getElementById('ht1Right').textContent = state.ht1Right;
    if (document.getElementById('ht2Left')) document.getElementById('ht2Left').textContent = state.ht2Left;
    if (document.getElementById('ht2Right')) document.getElementById('ht2Right').textContent = state.ht2Right;
    if (document.getElementById('ht2Block')) document.getElementById('ht2Block').style.display = state.period >= 2 ? '' : 'none';

    // Flecha y cronómetro
    setArrow(state.arrow);
    renderTimer();

    // Penalidades
    renderPenalties('left');
    renderPenalties('right');

    // Tiempos muertos
    ['left', 'right'].forEach(side => {
      const cap = side[0].toUpperCase() + side.slice(1);
      const el = document.getElementById('timeout' + cap);
      if (!el) return;
      const t = state.timeout[side];
      const m = Math.floor(t.seconds / 60), s2 = t.seconds % 60;
      el.textContent = pad2(m) + ':' + pad2(s2);
      el.classList.toggle('running', !!t.running);
    });
  } // end applyData

  function connectToSupabase() {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      realtimeChannel = supabaseClient.channel(watchId, {
        config: {
          broadcast: { ack: false }
        }
      });

      realtimeChannel
        .on('broadcast', { event: 'match_state' }, (payload) => {
          retryCount = 0;
          clearTimeout(noDataTimer);
          setStatus('🔴 TRANSMISIÓN EN VIVO');
          applyData(payload.payload);
          // Reset offline timer: if no data arrives in 7s show offline msg
          noDataTimer = setTimeout(showOffline, NO_DATA_TIMEOUT);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setStatus('🔴 CONECTADO - ESPERANDO DATOS');
            // Start offline timer immediately on connect
            noDataTimer = setTimeout(showOffline, NO_DATA_TIMEOUT);
          } else if (status === 'CLOSED') {
            clearTimeout(noDataTimer);
            setStatus('SIN SEÑAL — reconectando...');
            scheduleReconnect();
          } else if (status === 'CHANNEL_ERROR') {
            clearTimeout(noDataTimer);
            setStatus('ERROR DE CONEXIÓN — reintentando...');
            scheduleReconnect();
          }
        });
    } catch (e) {
      console.error("Error al conectar espectador a Supabase:", e);
      setStatus('ERROR DE RED — reintentando...');
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (retryCount >= MAX_RETRIES) { setStatus('SIN CONEXIÓN CON EL OPERADOR'); return; }
    retryCount++;
    setTimeout(connectToSupabase, 3000);
  }

  connectToSupabase();
}

/* ── Result Generator ── */
function showResultModal() {
  // Fill in tournament name
  document.getElementById('rcTournament').textContent =
    document.getElementById('tournamentName').value || 'HANDBALL';

  // Fill scores
  document.getElementById('rcScoreLeft').textContent = pad2(state.scoreLeft);
  document.getElementById('rcScoreRight').textContent = pad2(state.scoreRight);

  // Team names
  document.getElementById('rcNameLeft').textContent =
    document.getElementById('teamNameLeft').value || 'LOCAL';
  document.getElementById('rcNameRight').textContent =
    document.getElementById('teamNameRight').value || 'VISITANTE';

  // Copy logos
  ['Left', 'Right'].forEach(side => {
    const src = document.getElementById('logo' + side);
    const dst = document.getElementById('rcLogo' + side);
    dst.innerHTML = '';
    if (src && src.querySelector('img')) {
      const img = src.querySelector('img').cloneNode();
      img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
      dst.appendChild(img);
    } else {
      dst.textContent = side === 'Left'
        ? (document.getElementById('teamNameLeft').value || 'L').charAt(0)
        : (document.getElementById('teamNameRight').value || 'V').charAt(0);
      dst.style.cssText = 'font-size:22px; font-weight:900; color:var(--led-yellow);';
    }
  });

  openModal('resultModal');
}

// Shared helper: fill an element set with prefix
function fillResultCard(prefix) {
  document.getElementById(prefix + 'Tournament').textContent =
    document.getElementById('tournamentName').value || 'HANDBALL';
  document.getElementById(prefix + 'ScoreLeft').textContent = pad2(state.scoreLeft);
  document.getElementById(prefix + 'ScoreRight').textContent = pad2(state.scoreRight);
  document.getElementById(prefix + 'NameLeft').textContent =
    document.getElementById('teamNameLeft').value || 'LOCAL';
  document.getElementById(prefix + 'NameRight').textContent =
    document.getElementById('teamNameRight').value || 'VISITANTE';

  ['Left', 'Right'].forEach(side => {
    const src = document.getElementById('logo' + side);
    const dst = document.getElementById(prefix + 'Logo' + side);
    dst.innerHTML = '';
    if (src && src.querySelector('img')) {
      const img = src.querySelector('img').cloneNode();
      img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
      dst.appendChild(img);
    } else {
      dst.textContent = side === 'Left'
        ? (document.getElementById('teamNameLeft').value || 'L').charAt(0)
        : (document.getElementById('teamNameRight').value || 'V').charAt(0);
      dst.style.cssText = 'font-size:22px; font-weight:900; color:var(--led-yellow);';
    }
  });
}

function openResultScreen() {
  closeModal('resultModal');
  fillResultCard('rs');
  const screen = document.getElementById('resultScreen');
  screen.style.display = 'flex';
}

function showAlert(msg) {
  document.getElementById('alertMessage').textContent = msg;
  openModal('alertModal');
}

function closeResultScreen() {
  document.getElementById('resultScreen').style.display = 'none';
}


function captureAndDownload() {
  const el = document.getElementById('resultCapture');
  const btn = el.closest('.modal').querySelector('button');

  html2canvas(el, {
    backgroundColor: '#0a0a0c',
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false
  }).then(canvas => {
    const filename = `resultado-handball-${Date.now()}.png`;
    canvas.toBlob(blob => {
      // Try Web Share API first (mobile)
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: 'image/png' })] })) {
        navigator.share({
          title: 'Resultado Handball',
          files: [new File([blob], filename, { type: 'image/png' })]
        }).catch(() => downloadBlob(canvas, filename));
      } else {
        downloadBlob(canvas, filename);
      }
    }, 'image/png');
  });
}

function captureAndDownload() {
  const el = document.getElementById('resultCapture');

  // Detect mobile
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  html2canvas(el, {
    backgroundColor: '#0a0a0c',
    scale: 2,
    useCORS: true,
    allowTaint: true,
    logging: false
  }).then(canvas => {
    const dataUrl = canvas.toDataURL('image/png');
    const filename = `resultado-handball-${Date.now()}.png`;

    if (isMobile) {
      // Mobile: Try Web Share API (works on Android Chrome and iOS Safari)
      canvas.toBlob(blob => {
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ title: 'Resultado Handball', files: [file] })
            .catch(() => openImageInNewTab(dataUrl));
        } else {
          // Fallback: open image in new tab, user long-presses to save
          openImageInNewTab(dataUrl);
        }
      }, 'image/png');
    } else {
      // Desktop: direct download
      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      link.click();
    }
  });
}

function openImageInNewTab(dataUrl) {
  // Opens the image in a new tab — on mobile the user can long-press → Save Image
  const w = window.open('', '_blank');
  w.document.write(`
      <html><head><title>Resultado Handball</title>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{margin:0;background:#111;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#aaa;}
      img{max-width:100%;border-radius:10px;}p{font-size:14px;margin-top:16px;text-align:center;}</style></head>
      <body><img src="${dataUrl}"><p>Mantené presionada la imagen y elegí "Guardar imagen"</p></body></html>
    `);
  w.document.close();
}

/* ── Rest Timer (Descanso 5 min) ── */
const REST_TOTAL = 5 * 60; // 300 segundos
let restSeconds = REST_TOTAL;
let restRunning = false;
let restInterval = null;

function toggleRestTimer() {
  restRunning ? pauseRestTimer() : startRestTimer();
}

function startRestTimer() {
  if (restSeconds <= 0) return;
  restRunning = true;
  const btn = document.getElementById('btnRestStart');
  btn.textContent = '⏸';
  btn.classList.add('btn-red'); btn.classList.remove('btn-orange');
  restInterval = setInterval(() => {
    if (restSeconds > 0) {
      restSeconds--;
      renderRestTimer();
    } else {
      restSeconds = 0;
      restRunning = false;
      clearInterval(restInterval); restInterval = null;
      renderRestTimer();
      playPenaltyAlert('center');
      const el = document.getElementById('restTimer');
      if (el) { el.classList.add('warning'); setTimeout(() => el.classList.remove('warning'), 6000); }
      const btn2 = document.getElementById('btnRestStart');
      if (btn2) { btn2.textContent = '▶'; btn2.classList.remove('btn-red'); btn2.classList.add('btn-orange'); }
    }
  }, 1000);
}

function pauseRestTimer() {
  restRunning = false;
  clearInterval(restInterval); restInterval = null;
  const btn = document.getElementById('btnRestStart');
  btn.textContent = '▶';
  btn.classList.remove('btn-red'); btn.classList.add('btn-orange');
}

function resetRestTimer() {
  pauseRestTimer();
  restSeconds = REST_TOTAL;
  renderRestTimer();
  const el = document.getElementById('restTimer');
  if (el) el.classList.remove('warning');
}

function renderRestTimer() {
  const m = Math.floor(restSeconds / 60);
  const s = restSeconds % 60;
  const el = document.getElementById('restTimer');
  if (el) el.textContent = `${pad2(m)}:${pad2(s)}`;
}

/* ── Timeout (Tiempo Muerto) ── */

const timeoutIntervals = { left: null, right: null };

function toggleTimeout(side) {
  const t = state.timeout[side];
  if (t.seconds <= 0) return;

  if (t.running) {
    // --- Pausar tiempo muerto manualmente ---
    t.running = false;
    clearInterval(timeoutIntervals[side]);
    timeoutIntervals[side] = null;
    // No reanuda el partido automáticamente
  } else {
    // --- Iniciar tiempo muerto ---
    const team = side === 'left' ? document.getElementById('teamNameLeft').value : document.getElementById('teamNameRight').value;
    logEvent(`TIEMPO MUERTO SOLICITADO - ${team}`);

    // Si el partido está corriendo, pausarlo
    if (state.timerRunning) {
      pauseTimer();
    }
    t.running = true;
    timeoutIntervals[side] = setInterval(() => {
      if (t.seconds > 0) {
        t.seconds--;
        renderTimeout(side);
        broadcastState();
      } else {
        t.running = false;
        clearInterval(timeoutIntervals[side]);
        timeoutIntervals[side] = null;
        renderTimeout(side);
        playPenaltyAlert(side);
        broadcastState();
        // Flash the timeout display
        const el = document.getElementById('timeout' + side.charAt(0).toUpperCase() + side.slice(1));
        if (el) { el.classList.add('timeout-expired'); setTimeout(() => el.classList.remove('timeout-expired'), 4000); }
        // No reanuda el partido automáticamente
      }
    }, 1000);
  }
  renderTimeout(side);
}

function resetTimeout(side) {
  state.timeout[side].seconds = 60;
  state.timeout[side].running = false;
  clearInterval(timeoutIntervals[side]);
  timeoutIntervals[side] = null;
  renderTimeout(side);
}

/* ── Match Log Export ── */
function downloadMatchLog() {
  let txt = `=================================================\n`;
  txt += `          PLANILLA DEL PARTIDO\n`;
  txt += `  Torneo: ${document.getElementById('tournamentName').value || 'Sin nombre'}\n`;
  txt += `  Partido: ${document.getElementById('teamNameLeft').value} vs ${document.getElementById('teamNameRight').value}\n`;
  txt += `  Resultado Final: ${state.scoreLeft} - ${state.scoreRight}\n`;
  txt += `=================================================\n\n`;
  txt += `HISTORIAL DE EVENTOS:\n`;
  txt += `-------------------------------------------------\n`;
  txt += `Período | Reloj  | Evento\n`;
  txt += `-------------------------------------------------\n`;

  if (state.events.length === 0) {
    txt += `No se registraron eventos en este partido.\n`;
  } else {
    state.events.forEach(e => {
      txt += `   ${e.period}    | ${e.timeStr}  | ${e.description}\n`;
    });
  }
  txt += `-------------------------------------------------\n`;

  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `planilla-partido-${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function resetTimeout(side) {
  state.timeout[side].seconds = 60;
  state.timeout[side].running = false;
  clearInterval(timeoutIntervals[side]);
  timeoutIntervals[side] = null;
  renderTimeout(side);
}


function renderTimeout(side) {
  const t = state.timeout[side];
  const cap = side.charAt(0).toUpperCase() + side.slice(1);
  const timerEl = document.getElementById('timeout' + cap);
  const btnEl = document.getElementById('timeoutBtn' + cap);
  if (!timerEl || !btnEl) return;
  const m = Math.floor(t.seconds / 60), s = t.seconds % 60;
  timerEl.textContent = `${pad2(m)}:${pad2(s)}`;
  if (t.running) {
    timerEl.classList.add('running');
    btnEl.textContent = '⏸';
    btnEl.classList.add('btn-red'); btnEl.classList.remove('btn-orange');
  } else {
    timerEl.classList.remove('running');
    btnEl.textContent = t.seconds > 0 ? '▶' : '✔';
    btnEl.classList.remove('btn-red'); btnEl.classList.add('btn-orange');
  }
}

/* ── Wake Lock (Screen On) ── */
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.log('Wake Lock released');
      });
      console.log('Wake Lock active');
    }
  } catch (err) {
    console.log('Wake Lock error:', err.name, err.message);
  }
}

// Request wake lock on interaction or visibility change
document.addEventListener('visibilitychange', () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    requestWakeLock();
  }
});
document.addEventListener('click', () => {
  if (!wakeLock) requestWakeLock();
}, { once: true });
document.addEventListener('touchstart', () => {
  if (!wakeLock) requestWakeLock();
}, { once: true });
