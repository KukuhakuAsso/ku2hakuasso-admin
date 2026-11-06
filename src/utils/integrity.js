// 可塑区组件的完整性校验（api-12：asset.integrity 形如 `sha384-<base64>`）。
//
// 与玩家端 utils/integrity.js 同一套实现（两个子项目各自独立构建，无法共享源码）。
// 校验不通过必须中止，绝不执行任何未通过校验的代码。

const BASE64_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Uint8Array → base64；不依赖 Buffer / btoa，浏览器与 node 都能用。
export function toBase64(bytes) {
    let output = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = bytes[i + 1];
        const c = bytes[i + 2];
        output += BASE64_ALPHABET[a >> 2];
        output += BASE64_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
        output +=
            b === undefined
                ? "="
                : BASE64_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
        output += c === undefined ? "=" : BASE64_ALPHABET[c & 63];
    }
    return output;
}

// 用组件源码重算 sha384 并与描述符里的 integrity 比对（只认 `sha384-` 前缀）。
// 空值 / 畸形值一律返回 false。
export async function verifySha384(source, integrity) {
    const expected = String(integrity ?? "").trim();
    const match = /^sha384-([A-Za-z0-9+/]+={0,2})$/.exec(expected);
    if (!match) return false;

    const digest = await globalThis.crypto.subtle.digest(
        "SHA-384",
        new TextEncoder().encode(String(source ?? "")),
    );
    return toBase64(new Uint8Array(digest)) === match[1];
}
