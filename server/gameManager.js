const { customAlphabet } = require('nanoid');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos
const generateGameCode = customAlphabet(CODE_ALPHABET, 5);

const STATUS = {
  LOBBY: 'lobby',
  GREEN: 'green',
  RED: 'red',
  ENDED: 'ended',
};

class GameManager {
  constructor() {
    /** @type {Map<string, Game>} */
    this.games = new Map();
  }

  createGame() {
    let code;
    do {
      code = generateGameCode();
    } while (this.games.has(code));

    const game = {
      code,
      status: STATUS.LOBBY,
      createdAt: Date.now(),
      players: new Map(), // playerId -> player
      usedNumbers: new Set(),
      masterSocketId: null,
    };
    this.games.set(code, game);
    return game;
  }

  getGame(code) {
    return this.games.get((code || '').toUpperCase());
  }

  deleteGame(code) {
    this.games.delete(code);
  }

  assignNumber(game) {
    if (game.usedNumbers.size >= 1000) return null;
    let number;
    do {
      number = Math.floor(Math.random() * 1000);
    } while (game.usedNumbers.has(number));
    game.usedNumbers.add(number);
    return number;
  }

  formatNumber(number) {
    return String(number).padStart(3, '0');
  }

  addPlayer(game, { id, username, selfie, socketId }) {
    const number = this.assignNumber(game);
    const player = {
      id,
      username,
      selfie,
      number,
      numberLabel: this.formatNumber(number),
      status: 'active', // active | eliminated | winner
      socketId,
      joinedAt: Date.now(),
    };
    game.players.set(id, player);
    return player;
  }

  publicPlayer(player) {
    return {
      id: player.id,
      username: player.username,
      selfie: player.selfie,
      number: player.number,
      numberLabel: player.numberLabel,
      status: player.status,
    };
  }

  publicGameState(game) {
    return {
      code: game.code,
      status: game.status,
      players: Array.from(game.players.values()).map((p) => this.publicPlayer(p)),
    };
  }
}

module.exports = { GameManager, STATUS };
