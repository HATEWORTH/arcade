/* tslint:disable */
/* eslint-disable */

export function boot(): void;

/**
 * Mouse button edges. `button` follows the DOM: 0 left, 2 right.
 */
export function button(game: string, button: number, down: boolean): void;

/**
 * Values the shell mirrors into DOM overlays (HP pips, score lines).
 */
export function hud(game: string): string;

/**
 * Build (or rebuild) a game's state. Called when the player picks it.
 */
export function init(game: string, canvas_id: string, seed: number): void;

/**
 * Keyboard edges, lower-cased key names.
 */
export function key(game: string, name: string, down: boolean): void;

export function net_close(game: string): void;

/**
 * Open a netplay session. `role` is "host" or "guest". The shell owns the
 * actual connection and feeds it in via `net_peer` / `net_packet`.
 */
export function net_open(game: string, role: string): void;

/**
 * The shell delivers one packet received from the peer.
 */
export function net_packet(game: string, data: Uint8Array): void;

/**
 * The shell reports the peer's data channel opening (true) or dying (false).
 */
export function net_peer(game: string, connected: boolean): void;

/**
 * "off" | "waiting" | "host" | "guest" — drives the lobby text in the shell.
 */
export function net_status(game: string): string;

/**
 * Pointer position in CSS pixels, forwarded from the shell's pointer lock.
 */
export function pointer(game: string, x: number, y: number): void;

/**
 * True while a match is live — the shell uses this to decide what a click means.
 */
export function running(game: string): boolean;

/**
 * Start a match.
 */
export function start(game: string): void;

/**
 * Advance and render one frame. `dt` is seconds, already clamped by the shell.
 */
export function tick(game: string, dt: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly boot: () => void;
    readonly init: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly tick: (a: number, b: number, c: number) => void;
    readonly start: (a: number, b: number) => void;
    readonly running: (a: number, b: number) => number;
    readonly pointer: (a: number, b: number, c: number, d: number) => void;
    readonly button: (a: number, b: number, c: number, d: number) => void;
    readonly key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly hud: (a: number, b: number, c: number) => void;
    readonly net_open: (a: number, b: number, c: number, d: number) => void;
    readonly net_peer: (a: number, b: number, c: number) => void;
    readonly net_packet: (a: number, b: number, c: number, d: number) => void;
    readonly net_close: (a: number, b: number) => void;
    readonly net_status: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
