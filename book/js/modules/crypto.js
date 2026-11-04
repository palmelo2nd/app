// (1) インポート — なし（Web Crypto API・CompressionStreamのみ使用）
// book_dataリポジトリの暗号化ファイルの復号・暗号化（brain #1520）。
// 形式は~/.claude/scripts/book/book_crypto.pyと同じ：
//   鍵 = PBKDF2-SHA256(パスフレーズ, salt, iterations) → AES-256-GCM
//   ファイル = "BKE1\n" + base64(IV12バイト + 暗号文 + タグ)。暗号化前にgzip圧縮
//   AAD = リポジトリ内の相対パス（例: "b01_論理学.enc"）。ファイルの差し替えを検知する

const MAGIC = 'BKE1\n';
const KEYCHECK_TEXT = 'book_data keycheck';

// ===== base64 =====

function bytesToBase64(bytes) {
    let binary = '';
    const CHUNK = 0x8000; // 大きな配列でfromCharCodeの引数上限を超えないよう分割する
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// ===== gzip =====

async function pipeThrough(bytes, stream) {
    const response = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await response.arrayBuffer());
}

const gzip   = (bytes) => pipeThrough(bytes, new CompressionStream('gzip'));
const gunzip = (bytes) => pipeThrough(bytes, new DecompressionStream('gzip'));

// ===== 鍵 =====

/**
 * パスフレーズとkeycheck.jsonから鍵を導出し、照合用データで正しさを確かめる。
 * (2) インプット: passphrase, keycheck（keycheck.jsonをパースしたもの）
 * (3) メイン: PBKDF2で32バイト導出 → 照合用データを復号して一致を確認
 * (4) アウトプット: 鍵のbase64文字列（端末に保存する用）。パスフレーズが違えばError
 */
export async function deriveKeyBase64(passphrase, keycheck) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(keycheck.salt), iterations: keycheck.iterations },
        material, 256
    );
    const keyB64 = bytesToBase64(new Uint8Array(bits));
    let ok = false;
    try {
        const check = await decryptToBytes(await importKey(keyB64), keycheck.check, 'keycheck.json');
        ok = new TextDecoder().decode(check) === KEYCHECK_TEXT;
    } catch (error) {
        ok = false;
    }
    if (!ok) throw new Error('パスフレーズが違います');
    return keyB64;
}

// (2) インプット: 鍵のbase64  (3) メイン: AES-GCM鍵として取り込む（取り出し不可）  (4) アウトプット: CryptoKey
export function importKey(keyB64) {
    return crypto.subtle.importKey('raw', base64ToBytes(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// ===== 暗号化・復号 =====

// (2) インプット: key, 暗号化ファイルの中身, aad  (3) メイン: base64→AES-GCM復号→gunzip  (4) アウトプット: Uint8Array
export async function decryptToBytes(key, text, aad) {
    if (!text.startsWith(MAGIC)) throw new Error(`暗号化ファイルの形式ではありません: ${aad}`);
    const raw = base64ToBytes(text.slice(MAGIC.length).trim());
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: raw.subarray(0, 12), additionalData: new TextEncoder().encode(aad) },
        key, raw.subarray(12)
    );
    return gunzip(new Uint8Array(plain));
}

export async function decryptToText(key, text, aad) {
    return new TextDecoder().decode(await decryptToBytes(key, text, aad));
}

// (2) インプット: key, 平文の文字列, aad  (3) メイン: gzip→AES-GCM暗号化→base64  (4) アウトプット: 暗号化ファイルの中身
export async function encryptText(key, plainText, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
        key, await gzip(new TextEncoder().encode(plainText))
    );
    const out = new Uint8Array(12 + body.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(body), 12);
    return MAGIC + bytesToBase64(out) + '\n';
}

// 画像用：復号したバイト列をdata URLにする
export async function decryptToDataUrl(key, text, aad, mime) {
    return `data:${mime};base64,${bytesToBase64(await decryptToBytes(key, text, aad))}`;
}

// ===== 本文と利用者データ（既読・ハイライト・アーカイブ）の合成・分離 =====
// book_crypto.pyのmerge_state／split_stateと同じ規則。
// .state: {"既読": {"<順序>": bool}, "ハイライト": {"<順序>": [...]}, "アーカイブ": {"<記事ID>": bool}}

// (2) インプット: pageData（本文のみ）, state  (3) メイン: ページ・記事へ書き込む（pageDataを直接変更）  (4) アウトプット: なし
export function mergeState(pageData, state) {
    const read = state?.['既読'] || {}, marks = state?.['ハイライト'] || {}, archived = state?.['アーカイブ'] || {};
    for (const page of pageData) {
        const order = String(page['順序']);
        if (order in read) page['既読'] = read[order];
        if (order in marks) page['ハイライト'] = marks[order];
        for (const art of page['記事'] || []) {
            if (art['ID'] in archived) art['アーカイブ'] = archived[art['ID']];
        }
    }
}

// (2) インプット: pageData  (3) メイン: 既読・ハイライト・アーカイブだけを集める  (4) アウトプット: state
export function extractState(pageData) {
    const state = { '既読': {}, 'ハイライト': {}, 'アーカイブ': {} };
    for (const page of pageData) {
        const order = String(page['順序']);
        if ('既読' in page) state['既読'][order] = page['既読'];
        if ('ハイライト' in page) state['ハイライト'][order] = page['ハイライト'];
        for (const art of page['記事'] || []) {
            if ('アーカイブ' in art) state['アーカイブ'][art['ID']] = art['アーカイブ'];
        }
    }
    return state;
}
