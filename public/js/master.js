(() => {
  const socket = io();

  const screens = {
    create: document.getElementById('screen-create'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    results: document.getElementById('screen-results'),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  let currentCode = null;

  // ---------- Musica ambiente (simulada con Web Audio API) ----------
  const music = createAmbientMusic();

  function createAmbientMusic() {
    let ctx = null;
    let playing = false;
    let notesTimer = null;
    const notes = [261.6, 329.6, 392.0, 329.6, 293.7, 392.0, 440.0, 392.0];
    let noteIndex = 0;

    function ensureCtx() {
      if (!ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        ctx = new AudioCtx();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function playNote(freq) {
      const c = ensureCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, c.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.28);
      osc.connect(gain).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + 0.3);
    }

    function start() {
      if (playing) return;
      playing = true;
      ensureCtx();
      notesTimer = setInterval(() => {
        playNote(notes[noteIndex % notes.length]);
        noteIndex += 1;
      }, 320);
    }

    function stop() {
      playing = false;
      if (notesTimer) clearInterval(notesTimer);
      notesTimer = null;
    }

    return { start, stop };
  }

  // ---------- Crear partida ----------
  document.getElementById('btn-create').addEventListener('click', () => {
    socket.emit('master:createGame', {}, (res) => {
      if (!res || !res.ok) return;
      currentCode = res.state.code;
      enterLobby(currentCode);
    });
  });

  async function enterLobby(code) {
    document.getElementById('lobby-code').textContent = code;
    document.getElementById('game-code-tag').textContent = `#${code}`;
    try {
      const resp = await fetch(`/api/games/${code}/qrcode`);
      const data = await resp.json();
      document.getElementById('qr-image').src = data.qrDataUrl;
    } catch (e) {
      console.error('No se pudo cargar el QR', e);
    }
    renderLobbyPlayers([]);
    showScreen('lobby');
  }

  document.getElementById('btn-cancel').addEventListener('click', () => {
    if (currentCode) socket.emit('master:closeGame');
    currentCode = null;
    showScreen('create');
  });

  // ---------- Lobby: lista de jugadores ----------
  function renderLobbyPlayers(players) {
    document.getElementById('player-count').textContent = players.length;
    document.getElementById('btn-start').disabled = players.length === 0;
    const list = document.getElementById('lobby-player-list');
    list.innerHTML = '';
    players.forEach((p) => {
      list.appendChild(playerListItem(p));
    });
  }

  function playerListItem(p) {
    const li = document.createElement('li');
    li.className = 'player-item' + (p.status === 'eliminated' ? ' eliminated' : '');
    const img = document.createElement('img');
    img.src = p.selfie;
    img.alt = p.username;
    const number = document.createElement('span');
    number.className = 'number';
    number.textContent = p.numberLabel;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.username;
    const badge = document.createElement('span');
    badge.className = 'status-badge';
    badge.textContent = p.status === 'eliminated' ? 'Eliminado' : p.status === 'winner' ? 'Ganador' : 'En juego';
    li.append(img, number, name, badge);
    return li;
  }

  socket.on('master:playerJoined', ({ state }) => {
    renderLobbyPlayers(state.players);
  });

  // ---------- Comenzar partida ----------
  document.getElementById('btn-start').addEventListener('click', () => {
    socket.emit('master:startGame', {}, (res) => {
      if (!res || !res.ok) return alert(res && res.error ? res.error : 'No se pudo comenzar la partida');
    });
  });

  socket.on('game:started', ({ state }) => {
    renderGamePlayers(state.players);
    showScreen('game');
  });

  socket.on('game:greenLight', () => setLightBanner('green'));
  socket.on('game:redLight', () => setLightBanner('red'));

  function setLightBanner(color) {
    const banner = document.getElementById('light-banner');
    banner.classList.remove('green', 'red');
    banner.classList.add(color);
    banner.textContent = color === 'green' ? 'LUZ VERDE' : 'LUZ ROJA';
    if (color === 'green') music.start();
    else music.stop();
  }

  document.getElementById('btn-red').addEventListener('click', () => {
    socket.emit('master:redLight');
  });

  document.getElementById('btn-green').addEventListener('click', () => {
    socket.emit('master:greenLight');
  });

  socket.on('master:playerEliminated', ({ state }) => {
    renderGamePlayers(state.players);
  });

  function renderGamePlayers(players) {
    const active = players.filter((p) => p.status === 'active').length;
    document.getElementById('active-count').textContent = active;
    document.getElementById('total-count').textContent = players.length;
    const list = document.getElementById('game-player-list');
    list.innerHTML = '';
    players.forEach((p) => list.appendChild(playerListItem(p)));
  }

  // ---------- Finalizar partida ----------
  document.getElementById('btn-end').addEventListener('click', () => {
    socket.emit('master:endGame', {}, (res) => {
      if (!res || !res.ok) return;
      music.stop();
      renderWinners(res.winners);
      showScreen('results');
    });
  });

  socket.on('game:ended', ({ winners }) => {
    music.stop();
    renderWinners(winners);
    showScreen('results');
  });

  function renderWinners(winners) {
    const subtitle = document.getElementById('results-subtitle');
    subtitle.textContent =
      winners.length > 0
        ? `${winners.length} jugador${winners.length === 1 ? '' : 'es'} han ganado`
        : 'No ha quedado ningun jugador en pie';
    const list = document.getElementById('winners-list');
    list.innerHTML = '';
    winners.forEach((p) => list.appendChild(playerListItem(p)));
  }

  document.getElementById('btn-new-game').addEventListener('click', () => {
    currentCode = null;
    showScreen('create');
  });
})();
