(() => {
  const socket = io();

  const screens = {
    create: document.getElementById('screen-create'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('master-screen-game'),
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
      setLightState(state.status);
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
    setLightState('green');
    renderGamePlayers(state.players);
    showScreen('game');
  });

  socket.on('game:greenLight', () => setLightState('green'));
  socket.on('game:redLight', () => setLightState('red'));

  function setLightState(color) {
    const gameScreen = screens.game;
    gameScreen.classList.remove('state-green', 'state-red');
    gameScreen.classList.add(color === 'red' ? 'state-red' : 'state-green');
    document.getElementById('light-label').textContent = color === 'red' ? 'LUZ ROJA' : 'LUZ VERDE';
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

  // ---------- Rejilla en rombo de participantes (foto + numero) ----------
  // Filas centradas que alternan "cols" y "cols - 1" tarjetas: al estar
  // ambas centradas, la fila corta queda automaticamente desplazada media
  // tarjeta respecto a la larga, y una superposicion vertical negativa
  // entrelaza las filas como un panal de rombos (ver el cartel original
  // de "El juego del calamar"). No hay paginacion: la tarjeta se encoge o
  // crece segun quepan mas o menos jugadores y segun el ancho disponible.
  const MIN_DIAMOND_PX = 46;
  const MAX_DIAMOND_PX = 150;
  const DIAMOND_GAP_PX = 10;

  let lastRenderedPlayers = [];
  let lastWinners = [];

  function renderGamePlayers(players) {
    const active = players.filter((p) => p.status === 'active').length;
    document.getElementById('active-count').textContent = active;
    document.getElementById('total-count').textContent = players.length;

    lastRenderedPlayers = players;
    drawDiamondGrid('player-grid', players);
  }

  function drawDiamondGrid(containerId, players) {
    const container = document.getElementById(containerId);

    if (players.length === 0) {
      container.innerHTML = '';
      return;
    }

    const containerWidth = container.clientWidth || container.parentElement.clientWidth || 320;

    // Numero de columnas de las filas "largas": buscamos una rejilla mas o
    // menos cuadrada, para que quepan todos sin que queden filas eternas.
    let cols = Math.round(Math.sqrt(players.length * 1.15));
    cols = Math.max(3, Math.min(10, cols));

    let diamondSize = (containerWidth - DIAMOND_GAP_PX * (cols - 1)) / cols;
    diamondSize = Math.max(MIN_DIAMOND_PX, Math.min(MAX_DIAMOND_PX, diamondSize));

    container.style.setProperty('--diamond-size', `${diamondSize}px`);
    container.style.setProperty('--diamond-gap', `${DIAMOND_GAP_PX}px`);
    container.innerHTML = '';

    let index = 0;
    let rowIsLong = true;
    let rowIndex = 0;
    while (index < players.length) {
      const rowSize = rowIsLong ? cols : Math.max(1, cols - 1);
      const rowPlayers = players.slice(index, index + rowSize);
      if (rowPlayers.length === 0) break;

      const row = document.createElement('div');
      row.className = 'diamond-row' + (rowIndex > 0 ? ' diamond-row-overlap' : '');
      rowPlayers.forEach((p) => row.appendChild(diamondCard(p)));
      container.appendChild(row);

      index += rowSize;
      rowIsLong = !rowIsLong;
      rowIndex += 1;
    }
  }

  function diamondCard(p) {
    const div = document.createElement('div');
    div.className = 'diamond-card' + (p.status === 'eliminated' ? ' eliminated' : '');
    const img = document.createElement('img');
    img.src = p.selfie;
    img.alt = p.username;
    const number = document.createElement('div');
    number.className = 'diamond-number';
    number.textContent = p.numberLabel;
    div.append(img, number);
    if (p.status === 'eliminated') {
      const overlay = document.createElement('div');
      overlay.className = 'diamond-eliminated-overlay';
      overlay.innerHTML = '<span class="diamond-x">&#10060;</span><span>ELIMINADO</span>';
      div.appendChild(overlay);
    }
    return div;
  }

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (screens.game.classList.contains('active')) {
        drawDiamondGrid('player-grid', lastRenderedPlayers);
      } else if (screens.results.classList.contains('active')) {
        drawDiamondGrid('winners-grid', lastWinners);
      }
    }, 150);
  });

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
    lastWinners = winners;
    const subtitle = document.getElementById('results-subtitle');
    subtitle.textContent =
      winners.length > 0
        ? `${winners.length} jugador${winners.length === 1 ? '' : 'es'} han ganado`
        : 'No ha quedado ningun jugador en pie';
    drawDiamondGrid('winners-grid', winners);
  }

  document.getElementById('btn-new-game').addEventListener('click', () => {
    currentCode = null;
    showScreen('create');
  });
})();
