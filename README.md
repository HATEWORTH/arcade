# arcade
## https://hateworth.github.io/arcade/

A cabinet of small browser games on one canvas. Tetris, Snake, Cards and the
dungeon crawler are JavaScript. **Pong and Geo Wars are Rust compiled to
WebAssembly**, with peer-to-peer multiplayer over WebRTC.

## Layout

| path | what |
| --- | --- |
| `index.html` | the shell: overlays, menu, script loading |
| `js/audio.js` | the synth, sequencer and song book — exports `window.ARCADE` for every game |
| `js/shared.js` | pointer lock and the shared screen fill |
| `js/wasmhost.js` | drives the Rust games: input, overlays, lobby, and the `ARCADE_WASM_HOST` shim Rust calls back through |
| `js/*.js` | the games still written in JavaScript |
| `rust/` | the Rust crate: Pong, Geo Wars, canvas renderer, netcode |
| `wasm/` | build output, committed because GitHub Pages has no build step |

## Building the Rust games

Needs the `wasm32-unknown-unknown` target and
[wasm-pack](https://rustwasm.github.io/wasm-pack/).

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-pack
./rust/build.sh
```

That writes `wasm/arcade.js` and `wasm/arcade_bg.wasm`. **Commit both** — the
Pages site loads them directly.

## Multiplayer

Pong is 1v1 across the tunnel; Geo Wars is two-ship co-op. Both are
host-authoritative: the host simulates, the guest sends input and draws the
snapshots it gets back. Traffic is peer-to-peer over an unreliable, unordered
WebRTC data channel — nothing but connection setup touches a server.

WebRTC still needs a way to introduce the peers. Rather than running a
signalling server, the shell uses [trystero](https://github.com/dmotz/trystero)
(vendored in `js/vendor/`): the handshake rides public nostr relays, encrypted
with the room code, and after that everything is peer-to-peer. There is no
server to deploy — it works straight off GitHub Pages, for free.

The host clicks **HOST A 2P GAME** on the menu, picks a game, and clicks the
status pill to copy an invite link (it carries the room code and the game).
Player 2 just opens the link. Query parameters also work:

| parameter | meaning |
| --- | --- |
| `?host=1` | pre-arm the host toggle |
| `?join=1&room=CODE` | join a host's room |
| `?game=pong` / `?game=geo` | jump straight into that game's lobby | With no parameters both games run single-player exactly as before —
Pong against the CPU, Geo Wars solo.

The usual WebRTC caveat applies: peers behind symmetric NAT (some mobile
carriers, strict corporate networks) can't hole-punch and would need a TURN
relay, which is the one thing this setup doesn't include.
