(() => {
  const socket = io();

  const screens = {
    consent: document.getElementById('screen-consent'),
    join: document.getElementById('screen-join'),
    waiting: document.getElementById('screen-waiting'),
    game: document.getElementById('screen-game'),
    eliminated: document.getElementById('screen-eliminated'),
    result: document.getElementById('screen-result'),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  const state = {
    code: null,
    playerId: null,
    selfie: null,
    stream: null,
    status: 'active',
    lightIsRed: false,
    eliminationSent: false,
    hasJoined: false,
  };

  // ---------- Aviso de privacidad ----------
  const consentCheckbox = document.getElementById('consent-checkbox');
  const btnConsentContinue = document.getElementById('btn-consent-continue');

  consentCheckbox.addEventListener('change', () => {
    btnConsentContinue.disabled = !consentCheckbox.checked;
  });

  btnConsentContinue.addEventListener('click', () => {
    showScreen('join');
  });

  // ---------- Prefill del codigo desde la URL (?code=XXXXX) ----------
  const urlParams = new URLSearchParams(window.location.search);
  const codeInput = document.getElementById('input-code');
  const usernameInput = document.getElementById('input-username');
  const joinError = document.getElementById('join-error');
  const btnJoin = document.getElementById('btn-join');
  const btnStartCamera = document.getElementById('btn-start-camera');
  const btnCapture = document.getElementById('btn-capture');
  const video = document.getElementById('camera-video');
  const canvas = document.getElementById('camera-canvas');
  const selfiePreview = document.getElementById('selfie-preview');

  const prefilledCode = urlParams.get('code');
  if (prefilledCode) codeInput.value = prefilledCode.toUpperCase();

  function updateJoinButtonState() {
    btnJoin.disabled = !(codeInput.value.trim() && usernameInput.value.trim() && state.selfie);
  }
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
    updateJoinButtonState();
  });
  usernameInput.addEventListener('input', updateJoinButtonState);

  // ---------- Camara / selfie ----------
  btnStartCamera.addEventListener('click', async () => {
    joinError.textContent = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      state.stream = stream;
      video.srcObject = stream;
      btnCapture.disabled = false;
      btnStartCamera.disabled = true;
    } catch (err) {
      joinError.textContent = 'No se pudo acceder a la camara. Revisa los permisos del navegador.';
    }
  });

  btnCapture.addEventListener('click', () => {
    const w = video.videoWidth || 480;
    const h = video.videoHeight || 480;
    const size = Math.min(w, h);
    canvas.width = 300;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.translate(300, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, (w - size) / 2, (h - size) / 2, size, size, 0, 0, 300, 300);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    state.selfie = dataUrl;
    selfiePreview.src = dataUrl;
    selfiePreview.style.display = 'block';
    video.style.display = 'none';
    stopCameraStream();
    updateJoinButtonState();
  });

  function stopCameraStream() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
  }

  // ---------- Permiso de sensores de movimiento (iOS requiere gesto del usuario) ----------
  async function requestMotionPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const result = await DeviceMotionEvent.requestPermission();
        return result === 'granted';
      } catch (e) {
        return false;
      }
    }
    return true; // Android y navegadores que no requieren permiso explicito
  }

  // ---------- Unirse a la partida ----------
  btnJoin.addEventListener('click', async () => {
    joinError.textContent = '';
    const code = codeInput.value.trim().toUpperCase();
    const username = usernameInput.value.trim();
    if (!code || !username || !state.selfie) return;

    btnJoin.disabled = true;
    await requestMotionPermission();

    socket.emit('player:join', { code, username, selfie: state.selfie }, (res) => {
      if (!res || !res.ok) {
        joinError.textContent = (res && res.error) || 'No se pudo unir a la partida.';
        btnJoin.disabled = false;
        return;
      }
      state.code = code;
      state.playerId = res.player.id;
      state.hasJoined = true;
      document.getElementById('waiting-selfie').src = res.player.selfie;
      document.getElementById('waiting-number').textContent = res.player.numberLabel;
      showScreen('waiting');
    });
  });

  // ---------- Reconexion automatica ----------
  // Si el movil pierde la cobertura un instante (muy habitual en una fiesta con
  // muchos moviles en la misma wifi), Socket.io reconecta con un socket nuevo.
  // Sin este paso el jugador se queda "sordo": sigue viendo la ultima pantalla
  // pero no vuelve a recibir cambios de luz ni el final de la partida.
  socket.on('connect', () => {
    if (!state.hasJoined || !state.code || !state.playerId) return;
    socket.emit('player:rejoin', { code: state.code, playerId: state.playerId }, (res) => {
      if (!res || !res.ok) {
        joinError.textContent = 'Se perdio la conexion con la partida.';
        state.hasJoined = false;
        showScreen('join');
        return;
      }
      applyGameState(res.state, res.player);
    });
  });

  function applyGameState(gameState, player) {
    if (player.status === 'eliminated') {
      state.status = 'eliminated';
      document.getElementById('eliminated-number').textContent = player.numberLabel;
      showScreen('eliminated');
      return;
    }

    if (gameState.status === 'ended') {
      const winners = gameState.players.filter((p) => p.status === 'winner');
      renderResult(player.status === 'winner', winners);
      return;
    }

    if (gameState.status === 'green' || gameState.status === 'red') {
      document.getElementById('game-number').textContent = player.numberLabel;
      setGameLight(gameState.status === 'red' ? 'red' : 'green');
      showScreen('game');
      return;
    }

    // gameState.status === 'lobby'
    document.getElementById('waiting-selfie').src = player.selfie;
    document.getElementById('waiting-number').textContent = player.numberLabel;
    showScreen('waiting');
  }

  // ---------- Eventos de partida ----------
  socket.on('game:started', () => {
    document.getElementById('game-number').textContent = playerNumberLabel();
    setGameLight('green');
    showScreen('game');
  });

  socket.on('game:greenLight', () => setGameLight('green'));
  socket.on('game:redLight', () => setGameLight('red'));

  function playerNumberLabel() {
    return document.getElementById('waiting-number').textContent;
  }

  function setGameLight(color) {
    state.lightIsRed = color === 'red';
    const screen = screens.game;
    const statusText = document.getElementById('game-status-text');
    if (color === 'red') {
      screen.classList.add('state-red');
      statusText.textContent = 'LUZ ROJA · NO TE MUEVAS';
      resetMotionBaseline();
    } else {
      screen.classList.remove('state-red');
      statusText.textContent = 'LUZ VERDE · MUEVETE';
      state.eliminationSent = false;
    }
  }

  socket.on('master:playerEliminated', ({ player }) => {
    if (player.id !== state.playerId) return;
    state.status = 'eliminated';
    document.getElementById('eliminated-number').textContent = player.numberLabel;
    showScreen('eliminated');
  });

  socket.on('game:ended', ({ winners }) => {
    const iWon = winners.some((w) => w.id === state.playerId);
    renderResult(iWon, winners);
  });

  socket.on('game:closed', () => {
    state.hasJoined = false;
    joinError.textContent = 'El master ha cerrado la partida.';
    showScreen('join');
  });

  function renderResult(iWon, winners) {
    const icon = document.getElementById('result-icon');
    const title = document.getElementById('result-title');
    const subtitle = document.getElementById('result-subtitle');
    const list = document.getElementById('result-winners');

    if (iWon) {
      icon.innerHTML = '&#127942;';
      title.textContent = 'HAS GANADO';
      title.style.color = 'var(--green)';
      subtitle.textContent = '¡Enhorabuena, has sobrevivido!';
    } else {
      icon.innerHTML = '&#128128;';
      title.textContent = 'FIN DE LA PARTIDA';
      title.style.color = 'var(--pink)';
      subtitle.textContent = winners.length ? 'Estos son los jugadores que han ganado:' : 'No ha ganado nadie esta vez.';
    }

    list.innerHTML = '';
    winners.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'player-item';
      const img = document.createElement('img');
      img.src = p.selfie;
      img.alt = p.username;
      const number = document.createElement('span');
      number.className = 'number';
      number.textContent = p.numberLabel;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.username;
      li.append(img, number, name);
      list.appendChild(li);
    });

    showScreen('result');
  }

  // ---------- Deteccion de movimiento con los sensores del movil ----------
  let baselineMagnitude = null;
  const MOVEMENT_THRESHOLD = 2.2; // m/s^2 de variacion para considerar "movimiento"

  function resetMotionBaseline() {
    baselineMagnitude = null;
    state.eliminationSent = false;
  }

  window.addEventListener('devicemotion', (event) => {
    if (!state.lightIsRed || state.status !== 'active' || state.eliminationSent) return;

    const acc = event.accelerationIncludingGravity || event.acceleration;
    if (!acc || acc.x === null) return;

    const magnitude = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);

    if (baselineMagnitude === null) {
      baselineMagnitude = magnitude;
      return;
    }

    const delta = Math.abs(magnitude - baselineMagnitude);
    baselineMagnitude = baselineMagnitude * 0.8 + magnitude * 0.2; // suaviza el valor base

    if (delta > MOVEMENT_THRESHOLD) {
      triggerElimination();
    }
  });

  function triggerElimination() {
    if (state.eliminationSent) return;
    state.eliminationSent = true;
    socket.emit('player:eliminated', {});
  }
})();
