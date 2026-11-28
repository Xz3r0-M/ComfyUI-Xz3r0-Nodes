/**
 * 随机尾巴 / 随机短串（`web/core/random-id.js`）
 * ============================================
 *
 * 列表行的 uid、临时文件名、蒙版编辑器的会话令牌都靠它加一段随机尾巴。
 *
 * 这里不走 Math 里那个伪随机函数：GitHub 的 CodeQL 会把它的结果报成
 * 「不安全的随机数」（`js/insecure-randomness`），上面这些字符串正好都
 * 会被写进元素 id、拖拽数据、文件名和存盘 JSON，属于扫描器眼里的敏感位置。
 *
 * 统一用浏览器自带的 crypto：
 * - `crypto.getRandomValues` 在普通 http 页面也有（不像 `randomUUID`
 *   只在 localhost / https 这种安全上下文才有），所以直接用它；
 * - 连 crypto 都没有的极老浏览器退到「时间戳 + 自增序号」——这些串只要
 *   在同一页面里不重复就够，不需要保密。
 *
 * 用法：
 * ```js
 * randomSuffix(8);  // => "9f3a1c07"
 * ```
 */

/* 老浏览器兜底用的自增序号，和字符串里不合法的字符没关系，只管不重复 */
let fallbackSeed = 0;

function cryptoSource() {
    const safe = typeof crypto !== "undefined" ? crypto : null;
    if (safe && typeof safe.getRandomValues === "function") {
        return safe;
    }
    return null;
}

/**
 * 取一段随机小写十六进制串。
 *
 * @param {number} [length=8] 想要几位，最少 2 位；实际长度就是这么大
 * @returns {string} 例如 "9f3a1c07"
 */
export function randomSuffix(length = 8) {
    const size = Math.max(2, Math.floor(Number(length) || 8));
    const safe = cryptoSource();
    if (safe) {
        const bytes = new Uint8Array(size);
        safe.getRandomValues(bytes);
        let text = "";
        for (let index = 0; index < bytes.length; index += 1) {
            text += bytes[index].toString(16).padStart(2, "0");
        }
        return text.slice(0, size);
    }
    fallbackSeed += 1;
    const stamp = Date.now().toString(36);
    const tail = fallbackSeed.toString(36).padStart(2, "0");
    return `${stamp}${tail}`.slice(-size).padStart(size, "0");
}
