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
 * Open a netplay session. `role` is "host" or "guest".
 */
export function net_open(game: string, url: string, role: string): void;

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
    readonly button: (a: number, b: number, c: number, d: number) => void;
    readonly hud: (a: number, b: number) => [number, number];
    readonly init: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly key: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly net_close: (a: number, b: number) => void;
    readonly net_open: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly net_status: (a: number, b: number) => [number, number];
    readonly pointer: (a: number, b: number, c: number, d: number) => void;
    readonly running: (a: number, b: number) => number;
    readonly start: (a: number, b: number) => void;
    readonly tick: (a: number, b: number, c: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h1640237add5a99b3: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h196b57bda68afff6: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h196b57bda68afff6_2: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h196b57bda68afff6_3: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hed18c246d52ebd85: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h196b57bda68afff6_5: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h579fcc4fdc37a792: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
