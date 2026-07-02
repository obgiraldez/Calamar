# Luz roja, luz verde 🦑

Juego para fiestas inspirado en "El juego del calamar" (Red Light, Green Light). Un **master** controla la partida desde el ordenador/proyector y los **jugadores** se unen desde su propio movil.

## Como funciona

1. El master abre `/master.html`, pulsa **Crear partida** y se muestra un codigo QR + un codigo de partida.
2. Los jugadores escanean el QR (o entran el codigo a mano en `/player.html`), activan la camara, se hacen una selfie y eligen un nombre para unirse. Al entrar reciben un numero unico aleatorio (000-999).
3. El master pulsa **Comenzar partida**: la pantalla de cada jugador se pone verde y pueden moverse.
4. El master pulsa **Luz roja**: la pantalla de todos se pone roja. Si el sensor de movimiento (acelerometro) del movil de un jugador detecta que se ha movido, ese jugador queda **eliminado** automaticamente.
5. El master alterna entre **Luz roja** / **Luz verde** hasta pulsar **Finalizar partida**, momento en el que se muestra la lista de jugadores que han sobrevivido (ganadores) tanto en la pantalla del master como en la de cada jugador.

## Requisitos tecnicos del movil del jugador

- Camara (para la selfie de registro).
- Acelerometro / sensores de movimiento (`devicemotion`). En iOS Safari se debe conceder el permiso explicitamente (se solicita al pulsar "Unirme a la partida").
- Para que la camara y los sensores funcionen, el sitio debe servirse por **HTTPS** (o `localhost` en pruebas locales).

## Arquitectura

- **Backend**: Node.js + Express + Socket.io (`server/`). Mantiene el estado de las partidas en memoria (sin base de datos, pensado para el uso puntual de una fiesta).
- **Frontend**: HTML/CSS/JS sin build step (`public/`), una pagina para el master y otra para los jugadores.
- El master genera el codigo QR con la libreria `qrcode`, apuntando a `/join/:code`, que redirige a `player.html?code=...`.

## Puesta en marcha

```bash
npm install
npm start
```

El servidor arranca en `http://localhost:3000` (variable `PORT` configurable). Para probarlo con moviles reales en una fiesta, despliega detras de HTTPS (por ejemplo con un tunel como ngrok, o un hosting con TLS) ya que los sensores y la camara requieren un contexto seguro.
