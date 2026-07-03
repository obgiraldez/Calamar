const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { nanoid } = require('nanoid');

const { GameManager, STATUS } = require('./gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const gameManager = new GameManager();

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/join/:code', (req, res) => {
  res.redirect(`/player.html?code=${encodeURIComponent(req.params.code)}`);
});

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

app.get('/api/games/:code/qrcode', async (req, res) => {
  const game = gameManager.getGame(req.params.code);
  if (!game) return res.status(404).json({ error: 'Partida no encontrada' });
  try {
    const joinUrl = `${baseUrl(req)}/join/${game.code}`;
    const qrDataUrl = await QRCode.toDataURL(joinUrl, { width: 400, margin: 1 });
    res.json({ qrDataUrl, joinUrl });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo generar el QR' });
  }
});

io.on('connection', (socket) => {
  let currentGameCode = null;
  let role = null; // 'master' | 'player'
  let playerId = null;

  socket.on('master:createGame', (_payload, ack) => {
    const game = gameManager.createGame();
    game.masterSocketId = socket.id;
    currentGameCode = game.code;
    role = 'master';
    socket.join(roomName(game.code));
    socket.join(masterRoomName(game.code));
    if (typeof ack === 'function') {
      ack({ ok: true, state: gameManager.publicGameState(game) });
    }
  });

  socket.on('master:reconnect', ({ code }, ack) => {
    const game = gameManager.getGame(code);
    if (!game) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Partida no encontrada' });
      return;
    }
    game.masterSocketId = socket.id;
    currentGameCode = game.code;
    role = 'master';
    socket.join(roomName(game.code));
    socket.join(masterRoomName(game.code));
    if (typeof ack === 'function') ack({ ok: true, state: gameManager.publicGameState(game) });
  });

  socket.on('player:join', ({ code, username, selfie }, ack) => {
    const game = gameManager.getGame(code);
    if (!game) {
      return ack && ack({ ok: false, error: 'Codigo de partida no valido.' });
    }
    if (game.status !== STATUS.LOBBY) {
      return ack && ack({ ok: false, error: 'La partida ya ha comenzado o ha finalizado.' });
    }
    const cleanUsername = (username || '').trim().slice(0, 24);
    if (!cleanUsername) {
      return ack && ack({ ok: false, error: 'El nombre de usuario es obligatorio.' });
    }
    if (!selfie || typeof selfie !== 'string' || !selfie.startsWith('data:image')) {
      return ack && ack({ ok: false, error: 'Es necesario hacerse una selfie para unirse.' });
    }
    const usernameTaken = Array.from(game.players.values()).some(
      (p) => p.username.toLowerCase() === cleanUsername.toLowerCase()
    );
    if (usernameTaken) {
      return ack && ack({ ok: false, error: 'Ese nombre ya esta en uso en esta partida.' });
    }

    const id = nanoid(10);
    const player = gameManager.addPlayer(game, {
      id,
      username: cleanUsername,
      selfie,
      socketId: socket.id,
    });

    currentGameCode = game.code;
    role = 'player';
    playerId = id;
    socket.join(roomName(game.code));

    ack &&
      ack({
        ok: true,
        player: gameManager.publicPlayer(player),
        state: gameManager.publicGameState(game),
      });

    io.to(masterRoomName(game.code)).emit('master:playerJoined', {
      player: gameManager.publicPlayer(player),
      state: gameManager.publicGameState(game),
    });
  });

  socket.on('player:rejoin', ({ code, playerId: pid }, ack) => {
    const game = gameManager.getGame(code);
    if (!game || !game.players.has(pid)) {
      return ack && ack({ ok: false, error: 'No se pudo reconectar a la partida.' });
    }
    const player = game.players.get(pid);
    player.socketId = socket.id;
    currentGameCode = game.code;
    role = 'player';
    playerId = pid;
    socket.join(roomName(game.code));
    ack &&
      ack({
        ok: true,
        player: gameManager.publicPlayer(player),
        state: gameManager.publicGameState(game),
      });
  });

  socket.on('master:startGame', (_payload, ack) => {
    const game = requireMasterGame();
    if (!game) return ack && ack({ ok: false, error: 'Partida no encontrada' });
    if (game.players.size === 0) {
      return ack && ack({ ok: false, error: 'No hay jugadores en la partida.' });
    }
    game.status = STATUS.GREEN;
    io.to(roomName(game.code)).emit('game:started', { state: gameManager.publicGameState(game) });
    io.to(roomName(game.code)).emit('game:greenLight');
    ack && ack({ ok: true });
  });

  socket.on('master:redLight', (_payload, ack) => {
    const game = requireMasterGame();
    if (!game || game.status === STATUS.LOBBY || game.status === STATUS.ENDED) {
      return ack && ack({ ok: false, error: 'La partida no esta en curso.' });
    }
    game.status = STATUS.RED;
    io.to(roomName(game.code)).emit('game:redLight');
    ack && ack({ ok: true });
  });

  socket.on('master:greenLight', (_payload, ack) => {
    const game = requireMasterGame();
    if (!game || game.status === STATUS.LOBBY || game.status === STATUS.ENDED) {
      return ack && ack({ ok: false, error: 'La partida no esta en curso.' });
    }
    game.status = STATUS.GREEN;
    io.to(roomName(game.code)).emit('game:greenLight');
    ack && ack({ ok: true });
  });

  socket.on('master:endGame', (_payload, ack) => {
    const game = requireMasterGame();
    if (!game) return ack && ack({ ok: false, error: 'Partida no encontrada' });
    game.status = STATUS.ENDED;
    const winners = [];
    game.players.forEach((p) => {
      if (p.status === 'active') {
        p.status = 'winner';
        winners.push(gameManager.publicPlayer(p));
      }
    });
    shuffle(winners);
    const state = gameManager.publicGameState(game);
    io.to(roomName(game.code)).emit('game:ended', { winners, state });
    ack && ack({ ok: true, winners, state });
    // No necesitamos conservar fotos ni nombres una vez terminada la partida.
    // Se deja un breve margen por si algun movil se reconecta justo al terminar.
    const codeToDelete = game.code;
    setTimeout(() => gameManager.deleteGame(codeToDelete), GAME_DATA_RETENTION_MS);
  });

  socket.on('master:closeGame', () => {
    const game = requireMasterGame();
    if (!game) return;
    io.to(roomName(game.code)).emit('game:closed');
    gameManager.deleteGame(game.code);
  });

  socket.on('player:eliminated', (_payload, ack) => {
    const game = gameManager.getGame(currentGameCode);
    if (!game || role !== 'player' || !playerId) return;
    const player = game.players.get(playerId);
    if (!player || player.status !== 'active' || game.status !== STATUS.RED) {
      return ack && ack({ ok: false });
    }
    player.status = 'eliminated';
    io.to(roomName(game.code)).emit('master:playerEliminated', {
      player: gameManager.publicPlayer(player),
      state: gameManager.publicGameState(game),
    });
    ack && ack({ ok: true });
  });

  socket.on('disconnect', () => {
    if (role === 'master' && currentGameCode) {
      const game = gameManager.getGame(currentGameCode);
      if (game && game.masterSocketId === socket.id) {
        // El master se puede reconectar mientras la partida siga viva.
        game.masterSocketId = null;
        const codeAtDisconnect = currentGameCode;
        setTimeout(() => {
          const abandoned = gameManager.getGame(codeAtDisconnect);
          if (abandoned && abandoned.masterSocketId === null) {
            gameManager.deleteGame(codeAtDisconnect);
          }
        }, MASTER_ABANDON_TIMEOUT_MS);
      }
    }
  });

  function requireMasterGame() {
    if (role !== 'master' || !currentGameCode) return null;
    return gameManager.getGame(currentGameCode);
  }
});

function roomName(code) {
  return `game:${code}`;
}

function masterRoomName(code) {
  return `game:${code}:master`;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const MASTER_ABANDON_TIMEOUT_MS = 2 * 60 * 1000;
const GAME_DATA_RETENTION_MS = 30 * 1000;

server.listen(PORT, () => {
  console.log(`Servidor "Luz roja, luz verde" escuchando en el puerto ${PORT}`);
});
