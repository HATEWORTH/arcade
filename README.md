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

WebRTC still needs a signalling server to introduce the peers. That is
[`matchbox_server`](https://github.com/johanhelsing/matchbox):

```sh
cargo install matchbox_server
matchbox_server            # listens on ws://localhost:3536
```

Then open the site with the lobby query parameters:

| parameter | meaning |
| --- | --- |
| `?host=1` | open this tab as the host |
| `?join=1` | open this tab as the guest |
| `?room=NAME` | which room to meet in (default `arcade`) |
| `?net=wss://…` | signalling server, overriding `ws://localhost:3536` |

So one player opens `…/?host=1&room=abc` and the other `…/?join=1&room=abc`.
With no parameters both games run single-player exactly as before — Pong
against the CPU, Geo Wars solo.

To play over the internet rather than a LAN, deploy `matchbox_server`
somewhere with TLS and pass it as `?net=wss://your-host`. A public deployment
will also want a TURN relay for players behind symmetric NAT.
