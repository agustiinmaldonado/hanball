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
      left:  { seconds: 60, running: false },
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
        teamNameLeft:   document.getElementById('teamNameLeft')?.value   || '',
        teamNameRight:  document.getElementById('teamNameRight')?.value  || '',
        teamColorLeft:  document.getElementById('teamColorLeft')?.value  || '#FFD700',
        teamColorRight: document.getElementById('teamColorRight')?.value || '#FFD700',
        logoLeftHtml:   document.getElementById('logoLeft')?.innerHTML   || '',
        logoRightHtml:  document.getElementById('logoRight')?.innerHTML  || '',
      };
      // timerRunning always saves as false (can't restore a live timer)
      snap.state.timerRunning = false;
      snap.state.timeout.left.running  = false;
      snap.state.timeout.right.running = false;
      localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
    } catch(e) { console.warn('saveState error', e); }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const snap = JSON.parse(raw);
      // Restore state object
      Object.assign(state, snap.state);
      // Restore DOM text fields
      document.getElementById('tournamentName').value  = snap.tournamentName;
      document.getElementById('teamNameLeft').value    = snap.teamNameLeft;
      document.getElementById('teamNameRight').value   = snap.teamNameRight;
      document.getElementById('teamColorLeft').value   = snap.teamColorLeft;
      document.getElementById('teamColorRight').value  = snap.teamColorRight;
      updateTeamColor('left',  snap.teamColorLeft);
      updateTeamColor('right', snap.teamColorRight);
      document.getElementById('logoLeft').innerHTML    = snap.logoLeftHtml;
      document.getElementById('logoRight').innerHTML   = snap.logoRightHtml;
      // Restore score display
      document.getElementById('scoreLeft').textContent  = pad2(state.scoreLeft);
      document.getElementById('scoreRight').textContent = pad2(state.scoreRight);
      document.getElementById('periodNum').textContent  = state.period;
      document.getElementById('ht1Left').textContent    = state.ht1Left;
      document.getElementById('ht1Right').textContent   = state.ht1Right;
      document.getElementById('ht2Left').textContent    = state.ht2Left;
      document.getElementById('ht2Right').textContent   = state.ht2Right;
      document.getElementById('ht2Block').style.display = state.period >= 2 ? '' : 'none';
      setArrow(state.arrow);
      renderTimer();
      renderPenalties('left');
      renderPenalties('right');
      renderTimeout('left');
      renderTimeout('right');
      return true;
    } catch(e) { console.warn('loadState error', e); return false; }
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
    const defaultColor = '#FFD700';
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
      } else {
        endPeriodTime();
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
      document.getElementById('ht1Left').textContent = state.ht1Left;
      document.getElementById('ht1Right').textContent = state.ht1Right;
      setStatus('PARCIAL 1° GUARDADO');
    } else {
      state.ht2Left = state.scoreLeft; state.ht2Right = state.scoreRight;
      document.getElementById('ht2Left').textContent = state.ht2Left;
      document.getElementById('ht2Right').textContent = state.ht2Right;
      document.getElementById('ht2Block').style.display = '';
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
    state.penalties[side].push({ id: Date.now(), seconds: 120, running: false, player: '??' });
    const team = side === 'left' ? document.getElementById('teamNameLeft').value : document.getElementById('teamNameRight').value;
    logEvent(`PENAL AGREGADO - ${team}`);
    renderPenalties(side);
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

    // Alerta visual: Parpadeo verde en el panel del equipo
    const panelId = side === 'left' ? 'teamPanelLeft' : 'teamPanelRight';
    const panel = document.getElementById(panelId) || document.body;
    panel.classList.add('flash-green');
    setTimeout(() => panel.classList.remove('flash-green'), 1000);
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
        <span class="penalty-num" contenteditable="true"
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
      const teamColor = document.getElementById(targetId === 'logoLeft' ? 'teamColorLeft' : 'teamColorRight')?.value || '#FFD700';
      
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
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const src = canvas.toDataURL('image/png');
    closeWebcamModal();
    setLogoImage(src);
  }

  function triggerGallery() {
    document.getElementById('fileInputGallery').click();
  }

  function handleFileInput(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const src = e.target.result;
      const prev = document.getElementById('logoPreview');
      prev.src = src;
      prev.classList.add('visible');
      // auto-apply after short preview
      setTimeout(() => setLogoImage(src), 600);
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
    showConfirm('¿Iniciar nuevo partido?\nSe resetearán todos los datos.', fullReset);
  }

  function confirmReset() {
    showConfirm('¿Resetear todo el marcador?', fullReset);
  }

  function fullReset() {
    pauseTimer();
    Object.assign(state, {
      scoreLeft:0, scoreRight:0, period:1,
      timerSeconds: state.periodMinutes * 60,
      timerRunning: false,
      ht1Left:0, ht1Right:0, ht2Left:0, ht2Right:0,
      penalties: { left:[], right:[] }, arrow:'none',
      events: [],
      timeout: { left: { seconds:60, running:false }, right: { seconds:60, running:false } }
    });
    ['scoreLeft','scoreRight'].forEach(id => document.getElementById(id).textContent = '00');
    document.getElementById('periodNum').textContent = '1';
    ['ht1Left','ht1Right'].forEach(id => document.getElementById(id).textContent = '0');
    document.getElementById('ht2Block').style.display = 'none';
    document.getElementById('penaltiesLeft').innerHTML = '';
    document.getElementById('penaltiesRight').innerHTML = '';
    setArrow('none');
    renderTimer();
    renderTimeout('left');
    renderTimeout('right');
    setStatus('NUEVO PARTIDO');
    localStorage.removeItem(SAVE_KEY);
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
    if (e.key === ' ') { e.preventDefault(); toggleTimer(); }
    // LOCAL: ↑ suma, ↓ resta
    else if (e.key === 'ArrowUp')    { e.preventDefault(); changeScore('left',  1); }
    else if (e.key === 'ArrowDown')  { e.preventDefault(); changeScore('left', -1); }
    // VISITANTE: ← suma, → resta
    else if (e.key === 'ArrowLeft')  { e.preventDefault(); changeScore('right',  1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); changeScore('right', -1); }

    /* ── Botones de volumen (Android Chrome/Firefox) ── */
    else if (e.key === 'AudioVolumeUp'   || e.keyCode === 175) { e.preventDefault(); if (!isViewer) changeScore('left',  1); }
    else if (e.key === 'AudioVolumeDown' || e.keyCode === 174) { e.preventDefault(); if (!isViewer) changeScore('right', 1); }
  });

  /* ── Helpers ── */
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* ── Init ── */
  renderTimer();

  /* ── Networking (PeerJS) ── */
  let peer = null;
  let connections = [];
  const urlParams = new URLSearchParams(window.location.search);
  const watchId = urlParams.get('watch');
  const isViewer = !!watchId;

  if (isViewer) {
    document.body.classList.add('viewer-mode');
    document.getElementById('loginOverlay').style.display = 'none';
    setStatus('ESPECTADOR - CONECTANDO...');
    initViewer(watchId);
  } else {
    // Restore session: if already authenticated in this browser session, skip login
    if (sessionStorage.getItem('handball_admin') === 'true') {
      document.getElementById('loginOverlay').style.display = 'none';
      // Restore match state from localStorage
      if (loadState()) {
        setStatus('PARTIDO RESTAURADO');
      }
    } else {
      document.getElementById('loginPin').focus();
    }
  }

  function checkLogin() {
    if (document.getElementById('loginPin').value === 'ATM2019') {
      document.getElementById('loginOverlay').style.display = 'none';
      sessionStorage.setItem('handball_admin', 'true');
      // Restore any saved match
      if (loadState()) {
        setStatus('PARTIDO RESTAURADO');
      }
    } else {
      const err = document.getElementById('loginError');
      err.style.display = 'block';
      document.getElementById('loginPin').value = '';
      setTimeout(() => err.style.display = 'none', 2000);
    }
  }

  function initAdminNetwork() {
    if (peer && peer.open) {
      openModal('shareModal');
      return;
    }
    openModal('shareModal');
    document.getElementById('shareStatus').textContent = 'Conectando al servidor...';
    document.getElementById('shareStatus').style.color = 'var(--led-orange)';

    // ── ID de sala FIJA ──────────────────────────────────
    const ROOM_ID = 'handball-frias-live';
    // ─────────────────────────────────────────────────────

    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
    peer = new Peer(ROOM_ID);

    peer.on('open', (id) => {
      document.getElementById('shareStatus').textContent = '✔ EN VIVO — sala: ' + ROOM_ID;
      document.getElementById('shareStatus').style.color = '#00cc44';

      const baseUrl = window.location.href.split('?')[0];
      const shareUrl = `${baseUrl}?watch=${ROOM_ID}`;
      document.getElementById('shareLinkInput').value = shareUrl;

      // Generate QR Code
      const qrContainer = document.getElementById('qrcode');
      qrContainer.innerHTML = '';
      new QRCode(qrContainer, {
        text: shareUrl,
        width: 160,
        height: 160,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.L
      });

      setInterval(broadcastState, 1000);
    });

    peer.on('connection', (conn) => {
      connections.push(conn);
      conn.on('open', () => broadcastState());
      conn.on('close', () => { connections = connections.filter(c => c !== conn); });
    });

    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // ID taken means another tab/device is already broadcasting with this ID
        document.getElementById('shareStatus').textContent = '⚠ Sala ocupada — ya hay una transmisión activa en otro dispositivo.';
        document.getElementById('shareStatus').style.color = 'var(--led-orange)';
      } else {
        document.getElementById('shareStatus').textContent = 'Error de red: ' + (err.message || err.type);
        document.getElementById('shareStatus').style.color = 'var(--led-red)';
      }
      peer = null;
    });
  }

  function copyShareLink() {
    const input = document.getElementById('shareLinkInput');
    input.select();
    document.execCommand('copy');
    setStatus('LINK COPIADO');
  }

  function broadcastState() {
    if (isViewer || connections.length === 0) return;
    const payload = {
      state: state,
      tournamentName: document.getElementById('tournamentName').value,
      teamNameLeft: document.getElementById('teamNameLeft').value,
      teamNameRight: document.getElementById('teamNameRight').value,
      teamColorLeft: document.getElementById('teamColorLeft').value,
      teamColorRight: document.getElementById('teamColorRight').value,
      logoLeftHtml: document.getElementById('logoLeft').innerHTML,
      logoRightHtml: document.getElementById('logoRight').innerHTML
    };
    connections.forEach(conn => { if (conn.open) conn.send(payload); });
  }

  document.addEventListener('click', () => {
    if (!isViewer) {
      setTimeout(broadcastState, 50);
      setTimeout(saveState, 100);
    }
  });
  document.addEventListener('keyup', () => {
    if (!isViewer) {
      setTimeout(broadcastState, 50);
      setTimeout(saveState, 100);
    }
  });
  // Also auto-save every 5 seconds while the timer is running
  setInterval(() => { if (!isViewer && state.timerRunning) saveState(); }, 5000);

  function initViewer(watchId) {
    peer = new Peer();
    peer.on('open', () => {
      const conn = peer.connect(watchId);
      conn.on('open', () => { setStatus('🔴 TRANSMISIÓN EN VIVO'); });
      conn.on('data', (data) => {
        Object.assign(state, data.state);
        document.getElementById('tournamentName').value = data.tournamentName;
        document.getElementById('teamNameLeft').value = data.teamNameLeft;
        document.getElementById('teamNameRight').value = data.teamNameRight;
        document.getElementById('teamColorLeft').value = data.teamColorLeft;
        document.getElementById('teamColorRight').value = data.teamColorRight;
        updateTeamColor('left', data.teamColorLeft);
        updateTeamColor('right', data.teamColorRight);
        document.getElementById('logoLeft').innerHTML = data.logoLeftHtml;
        document.getElementById('logoRight').innerHTML = data.logoRightHtml;
        
        document.getElementById('scoreLeft').textContent = pad2(state.scoreLeft);
        document.getElementById('scoreRight').textContent = pad2(state.scoreRight);
        document.getElementById('periodNum').textContent = state.period;
        document.getElementById('ht1Left').textContent = state.ht1Left;
        document.getElementById('ht1Right').textContent = state.ht1Right;
        document.getElementById('ht2Left').textContent = state.ht2Left;
        document.getElementById('ht2Right').textContent = state.ht2Right;
        document.getElementById('ht2Block').style.display = state.period >= 2 ? '' : 'none';
        
        setArrow(state.arrow);
        renderTimer();
        renderPenalties('left');
        renderPenalties('right');
        renderTimeout('left');
        renderTimeout('right');
      });
      conn.on('close', () => { setStatus('DESCONECTADO DEL ORIGEN'); });
    });
    peer.on('error', () => { setStatus('ERROR DE CONEXIÓN'); });
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

    // Period info
    document.getElementById('rcPeriod').textContent = `PERÍODO ${state.period}`;

    // Halftime scores
    const ht2 = state.period >= 2
      ? `  |  2T: ${state.ht2Left} - ${state.ht2Right}` : '';
    document.getElementById('rcHalftimes').textContent =
      `1T: ${state.ht1Left} - ${state.ht1Right}${ht2}`;

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
    document.getElementById(prefix + 'Period').textContent = `PERÍODO ${state.period}`;
    const ht2 = state.period >= 2 ? `  |  2T: ${state.ht2Left} - ${state.ht2Right}` : '';
    document.getElementById(prefix + 'Halftimes').textContent =
      `1T: ${state.ht1Left} - ${state.ht1Right}${ht2}`;

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
          if (t.seconds === 0) {
            t.running = false;
            clearInterval(timeoutIntervals[side]);
            timeoutIntervals[side] = null;
            renderTimeout(side);
            playPenaltyAlert(side);
            // Flash the timeout display
            const el = document.getElementById('timeout' + side.charAt(0).toUpperCase() + side.slice(1));
            if (el) { el.classList.add('timeout-expired'); setTimeout(() => el.classList.remove('timeout-expired'), 4000); }
            // No reanuda el partido automáticamente
          }
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
    const timerEl  = document.getElementById('timeout' + cap);
    const btnEl    = document.getElementById('timeoutBtn' + cap);
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
