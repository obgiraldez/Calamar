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

  // ---------- Reconexion automatica ----------
  // Si el navegador del master pierde la conexion un instante, Socket.io
  // reconecta con un socket nuevo: sin este paso el servidor "olvida" que
  // este socket controlaba la partida y los botones dejan de tener efecto.
  socket.on('connect', () => {
    if (!currentCode) return;
    socket.emit('master:reconnect', { code: currentCode }, (res) => {
      if (!res || !res.ok) return;
      applyState(res.state);
    });
  });

  function applyState(state) {
    if (state.status === 'ended') {
      renderWinners(state.players.filter((p) => p.status === 'winner'));
      showScreen('results');
      return;
    }
    if (state.status === 'green' || state.status === 'red') {
      setLightBanner(state.status);
      renderGamePlayers(state.players);
      showScreen('game');
      return;
    }
    renderLobbyPlayers(state.players);
    showScreen('lobby');
  }

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
    setLightBanner('green');
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

  // ---------- Rejilla grande de participantes (foto + numero) ----------
  const GRID_PAGE_SIZE = 16;
  const GRID_ROTATE_MS = 6000;
  let gridPlayers = [];
  let gridPageIndex = 0;
  let gridRotateTimer = null;

  function renderGamePlayers(players) {
    const active = players.filter((p) => p.status === 'active').length;
    document.getElementById('active-count').textContent = active;
    document.getElementById('total-count').textContent = players.length;

    gridPlayers = players;
    const totalPages = Math.max(1, Math.ceil(gridPlayers.length / GRID_PAGE_SIZE));
    if (gridPageIndex >= totalPages) gridPageIndex = 0;
    drawGridPage();
    restartGridRotation(totalPages);
  }

  function drawGridPage() {
    const totalPages = Math.max(1, Math.ceil(gridPlayers.length / GRID_PAGE_SIZE));
    const start = gridPageIndex * GRID_PAGE_SIZE;
    const pagePlayers = gridPlayers.slice(start, start + GRID_PAGE_SIZE);
    const grid = document.getElementById('player-grid');
    grid.innerHTML = '';
    pagePlayers.forEach((p) => grid.appendChild(gridCard(p)));
    document.getElementById('grid-page-indicator').textContent =
      totalPages > 1 ? `Pagina ${gridPageIndex + 1} / ${totalPages}` : '';
  }

  function gridCard(p) {
    const div = document.createElement('div');
    div.className = 'grid-card' + (p.status === 'eliminated' ? ' eliminated' : '');
    const img = document.createElement('img');
    img.src = p.selfie;
    img.alt = p.username;
    const number = document.createElement('div');
    number.className = 'grid-number';
    number.textContent = p.numberLabel;
    div.append(img, number);
    if (p.status === 'eliminated') {
      const overlay = document.createElement('div');
      overlay.className = 'grid-eliminated-overlay';
      overlay.innerHTML = '<span class="grid-x">&#10060;</span><span>ELIMINADO</span>';
      div.appendChild(overlay);
    }
    return div;
  }

  function restartGridRotation(totalPages) {
    if (gridRotateTimer) clearInterval(gridRotateTimer);
    gridRotateTimer = null;
    if (totalPages <= 1) return;
    gridRotateTimer = setInterval(() => {
      gridPageIndex = (gridPageIndex + 1) % totalPages;
      drawGridPage();
    }, GRID_ROTATE_MS);
  }

  // ---------- Finalizar partida ----------
  document.getElementById('btn-end').addEventListener('click', () => {
    socket.emit('master:endGame', {}, (res) => {
      if (!res || !res.ok) return;
      renderWinners(res.winners);
      showScreen('results');
    });
  });

  socket.on('game:ended', ({ winners }) => {
    renderWinners(winners);
    showScreen('results');
  });

  function renderWinners(winners) {
    if (gridRotateTimer) clearInterval(gridRotateTimer);
    gridRotateTimer = null;
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
