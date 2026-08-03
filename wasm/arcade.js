/* @ts-self-types="./arcade.d.ts" */

/**
 * Mouse movement since the last report, in screen pixels. Geo Wars aims
 * relative to the ship, so it wants the motion rather than a cursor position.
 * @param {string} game
 * @param {number} dx
 * @param {number} dy
 */
export function aim_delta(game, dx, dy) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.aim_delta(ptr0, len0, dx, dy);
}

export function boot() {
    wasm.boot();
}

/**
 * Mouse button edges. `button` follows the DOM: 0 left, 2 right.
 * @param {string} game
 * @param {number} button
 * @param {boolean} down
 */
export function button(game, button, down) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.button(ptr0, len0, button, down);
}

/**
 * Values the shell mirrors into DOM overlays (HP pips, score lines).
 * @param {string} game
 * @returns {string}
 */
export function hud(game) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hud(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Build (or rebuild) a game's state. Called when the player picks it.
 * @param {string} game
 * @param {string} canvas_id
 * @param {number} seed
 */
export function init(game, canvas_id, seed) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(canvas_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    wasm.init(ptr0, len0, ptr1, len1, seed);
}

/**
 * Keyboard edges, lower-cased key names.
 * @param {string} game
 * @param {string} name
 * @param {boolean} down
 */
export function key(game, name, down) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    wasm.key(ptr0, len0, ptr1, len1, down);
}

/**
 * @param {string} game
 */
export function net_close(game) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.net_close(ptr0, len0);
}

/**
 * Open a netplay session. `role` is "host" or "guest". The shell owns the
 * actual connection and feeds it in via `net_peer` / `net_packet`.
 * @param {string} game
 * @param {string} role
 */
export function net_open(game, role) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(role, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    wasm.net_open(ptr0, len0, ptr1, len1);
}

/**
 * The shell delivers one packet received from the peer.
 * @param {string} game
 * @param {Uint8Array} data
 */
export function net_packet(game, data) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    wasm.net_packet(ptr0, len0, ptr1, len1);
}

/**
 * The shell reports the peer's data channel opening (true) or dying (false).
 * @param {string} game
 * @param {boolean} connected
 */
export function net_peer(game, connected) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.net_peer(ptr0, len0, connected);
}

/**
 * "off" | "waiting" | "host" | "guest" — drives the lobby text in the shell.
 * @param {string} game
 * @returns {string}
 */
export function net_status(game) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.net_status(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Pointer position in CSS pixels, forwarded from the shell's pointer lock.
 * @param {string} game
 * @param {number} x
 * @param {number} y
 */
export function pointer(game, x, y) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.pointer(ptr0, len0, x, y);
}

/**
 * True while a match is live — the shell uses this to decide what a click means.
 * @param {string} game
 * @returns {boolean}
 */
export function running(game) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.running(ptr0, len0);
    return ret !== 0;
}

/**
 * Start a match.
 * @param {string} game
 */
export function start(game) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.start(ptr0, len0);
}

/**
 * Advance and render one frame. `dt` is seconds, already clamped by the shell.
 * @param {string} game
 * @param {number} dt
 */
export function tick(game, dt) {
    const ptr0 = passStringToWasm0(game, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    wasm.tick(ptr0, len0, dt);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_number_get_394265ed1e1b84ee: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_addColorStop_8eb1c8d584dae53b: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.addColorStop(arg1, getStringFromWasm0(arg2, arg3));
        }, arguments); },
        __wbg_arc_61372d0a8f0a988c: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.arc(arg1, arg2, arg3, arg4, arg5);
        }, arguments); },
        __wbg_beat_7a2bede8e248b19f: function(arg0) {
            const ret = ARCADE_WASM_HOST.beat();
            const ptr1 = passArrayF64ToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_beginPath_ca2dfce389ff20d2: function(arg0) {
            arg0.beginPath();
        },
        __wbg_bleep_5c4b13e66ee747cb: function(arg0, arg1, arg2, arg3, arg4) {
            ARCADE_WASM_HOST.bleep(arg0, arg1, getStringFromWasm0(arg2, arg3), arg4);
        },
        __wbg_closePath_0e752092e41e1e22: function(arg0) {
            arg0.closePath();
        },
        __wbg_createRadialGradient_f08708ebb7199d95: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
            const ret = arg0.createRadialGradient(arg1, arg2, arg3, arg4, arg5, arg6);
            return ret;
        }, arguments); },
        __wbg_devicePixelRatio_1c0e0ed7deb19cd8: function(arg0) {
            const ret = arg0.devicePixelRatio;
            return ret;
        },
        __wbg_document_179650d6cb13c263: function(arg0) {
            const ret = arg0.document;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_error_b65623446885fe02: function(arg0, arg1) {
            console.error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_event_93cb49744683ac5b: function(arg0, arg1, arg2, arg3, arg4, arg5) {
            ARCADE_WASM_HOST.event(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5));
        },
        __wbg_fillRect_97b1f503e30148c3: function(arg0, arg1, arg2, arg3, arg4) {
            arg0.fillRect(arg1, arg2, arg3, arg4);
        },
        __wbg_fillText_e462ba58cec15054: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.fillText(getStringFromWasm0(arg1, arg2), arg3, arg4);
        }, arguments); },
        __wbg_fill_7e2406c195723006: function(arg0) {
            arg0.fill();
        },
        __wbg_getContext_e79ddf6a9cb3cc76: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getContext(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getElementById_1cbd8f06dbe8eb8e: function(arg0, arg1, arg2) {
            const ret = arg0.getElementById(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_gfx_9de8bec6b4a4b7b6: function() { return handleError(function (arg0) {
            const ret = ARCADE_WASM_HOST.gfx();
            const ptr1 = passArrayF64ToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_hat_0b43523d6e76cd04: function(arg0, arg1) {
            ARCADE_WASM_HOST.hat(arg0, arg1);
        },
        __wbg_innerHeight_92315939e482496d: function() { return handleError(function (arg0) {
            const ret = arg0.innerHeight;
            return ret;
        }, arguments); },
        __wbg_innerWidth_dec7d2ac73df3e63: function() { return handleError(function (arg0) {
            const ret = arg0.innerWidth;
            return ret;
        }, arguments); },
        __wbg_instanceof_CanvasRenderingContext2d_2284b703b7023dcc: function(arg0) {
            let result;
            try {
                result = arg0 instanceof CanvasRenderingContext2D;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_HtmlCanvasElement_ed02ed9136056019: function(arg0) {
            let result;
            try {
                result = arg0 instanceof HTMLCanvasElement;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Window_05ba1ee4f6781663: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Window;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_lineTo_1aeefd30328165b5: function(arg0, arg1, arg2) {
            arg0.lineTo(arg1, arg2);
        },
        __wbg_moveTo_2618bed6b5b25622: function(arg0, arg1, arg2) {
            arg0.moveTo(arg1, arg2);
        },
        __wbg_netSend_ab7c4eb1285ed519: function(arg0, arg1) {
            ARCADE_WASM_HOST.netSend(getArrayU8FromWasm0(arg0, arg1));
        },
        __wbg_reducedMotion_073b9f4fc6cfdb0e: function() {
            const ret = ARCADE_WASM_HOST.reducedMotion();
            return ret;
        },
        __wbg_restore_ab535bc88702bcc0: function(arg0) {
            arg0.restore();
        },
        __wbg_rotate_6a6e81bc63bce7d8: function() { return handleError(function (arg0, arg1) {
            arg0.rotate(arg1);
        }, arguments); },
        __wbg_save_cd0bc920468bfe2c: function(arg0) {
            arg0.save();
        },
        __wbg_set_fillStyle_4360b989b9352bbb: function(arg0, arg1, arg2) {
            arg0.fillStyle = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_fillStyle_ed3ce34a55db5220: function(arg0, arg1) {
            arg0.fillStyle = arg1;
        },
        __wbg_set_font_33fee74f2c82cb6f: function(arg0, arg1, arg2) {
            arg0.font = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_globalAlpha_9b3de2f2aa9958de: function(arg0, arg1) {
            arg0.globalAlpha = arg1;
        },
        __wbg_set_globalCompositeOperation_91a4a7202a4f36d5: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.globalCompositeOperation = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_lineCap_2b3a8b4e4499222b: function(arg0, arg1, arg2) {
            arg0.lineCap = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_lineJoin_f7a0158da26951b7: function(arg0, arg1, arg2) {
            arg0.lineJoin = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_lineWidth_beb3d05e36f4cc53: function(arg0, arg1) {
            arg0.lineWidth = arg1;
        },
        __wbg_set_shadowBlur_3f8fd92fc17ae584: function(arg0, arg1) {
            arg0.shadowBlur = arg1;
        },
        __wbg_set_shadowColor_f84336148c00ebf9: function(arg0, arg1, arg2) {
            arg0.shadowColor = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_strokeStyle_b390d5f09a6989a8: function(arg0, arg1, arg2) {
            arg0.strokeStyle = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_textAlign_75f93b22c0415d5d: function(arg0, arg1, arg2) {
            arg0.textAlign = getStringFromWasm0(arg1, arg2);
        },
        __wbg_static_accessor_GLOBAL_4ef717fb391d88b7: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_8d1badc68b5a74f4: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_146583524fe1469b: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_f2829a2234d7819e: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_storageGet_ef1e5bcc2bff2be8: function(arg0, arg1, arg2) {
            const ret = ARCADE_WASM_HOST.storageGet(getStringFromWasm0(arg1, arg2));
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_storageSet_c8d0e8fd1da40afc: function(arg0, arg1, arg2, arg3) {
            ARCADE_WASM_HOST.storageSet(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
        },
        __wbg_strokeRect_74c74060d04c703b: function(arg0, arg1, arg2, arg3, arg4) {
            arg0.strokeRect(arg1, arg2, arg3, arg4);
        },
        __wbg_stroke_cf809e69aae41b03: function(arg0) {
            arg0.stroke();
        },
        __wbg_sweep_088a300177840816: function(arg0, arg1, arg2, arg3, arg4, arg5) {
            ARCADE_WASM_HOST.sweep(arg0, arg1, arg2, getStringFromWasm0(arg3, arg4), arg5);
        },
        __wbg_translate_d2b84d406c25580d: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.translate(arg1, arg2);
        }, arguments); },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./arcade_bg.js": import0,
    };
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('arcade_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
