/**
 * 按「人看着顺眼」的顺序比名字
 * ============================
 *
 * 直接比字符串会把数字按字符逐个比：`10` 排在 `2` 前面，因为字符 `"1"`
 * 比 `"2"` 小。于是名单看起来是这样：
 *
 *     1, 10, 11, 110, 2, 20, 200
 *
 * 这正是用户抱怨的「数字排序不对」。人期待的是按**数值大小**比：
 *
 *     1, 2, 10, 11, 20, 110, 200
 *
 * 做法：把名字切成「文字段」和「数字段」，文字段按小写逐字比，数字段按
 * 数值比（先去掉前导零，再比位数、再逐位比——这样再长的数字也不会因为
 * 浮点数精度而比错）。
 *
 * 为什么不用 `localeCompare(..., { numeric: true })`？
 * 因为它带的是浏览器的语言排序表，后端 Python 复现不了同一套规则。排序
 * 一旦前后端不一致，服务器分页和浏览器重排就会打架：翻到第二页时前面的
 * 顺序看起来会「接不上」。所以这里刻意用一份**可复现**的规则，Python 那边
 * 有一份逐字对应的实现（`xz3r0_utils/natural_sort.py`），两边结果完全一样。
 *
 * 代价：中文名字按 Unicode 顺序排，不再按拼音。换来的是一致性和可测试性。
 */

/**
 * 把名字切成块。
 *
 * @param {string} text
 * @returns {Array<Array<number|string>>} 每块是 `[类型, 位数, 值]`：
 *   - 数字段 `[0, 位数, 去前导零的数字串]`
 *   - 文字段 `[1, 0, 小写文本]`
 *   数字排在文字前面（`1.png` < `a.png`），和资源管理器、浏览器的语言
 *   排序表都一致。
 *   中间那位放位数，比较时先比位数再逐位比 ≈ 按数值比，但再长的数字也
 *   不会因为浮点精度而比错。三段的排布和 Python 那边逐字对应。
 */
function naturalChunks(text) {
    const chunks = [];
    String(text ?? "")
        .split(/(\d+)/)
        .forEach((part) => {
            if (!part) {
                return;
            }
            if (/^\d+$/.test(part)) {
                const digits = part.replace(/^0+(?=\d)/, "");
                chunks.push([0, digits.length, digits]);
            } else {
                chunks.push([1, 0, part.toLowerCase()]);
            }
        });
    return chunks;
}

/**
 * 比两个名字。用法和 `Array.prototype.sort` 的比较器一模一样。
 *
 * @param {string} left
 * @param {string} right
 * @returns {number} 负数 / 0 / 正数
 */
export function compareNaturalNames(left, right) {
    const a = String(left ?? "");
    const b = String(right ?? "");
    if (a === b) {
        return 0;
    }
    const leftChunks = naturalChunks(a);
    const rightChunks = naturalChunks(b);
    const count = Math.max(leftChunks.length, rightChunks.length);
    for (let index = 0; index < count; index += 1) {
        const one = leftChunks[index];
        const two = rightChunks[index];
        // 一方先用完：短的排前面（`abc` < `abcd`）
        if (!one) {
            return -1;
        }
        if (!two) {
            return 1;
        }
        // 文字段和数字段不能直接比大小，先比类型（数字在前、文字在后）
        if (one[0] !== two[0]) {
            return one[0] - two[0];
        }
        // 数字段这里比的是「位数」，比完才轮到具体数字
        if (one[1] !== two[1]) {
            return one[1] - two[1];
        }
        if (one[2] === two[2]) {
            continue;
        }
        return one[2] < two[2] ? -1 : 1;
    }
    return 0;
}

/**
 * 给对象数组用的排序键工厂：按某个字段的「自然顺序」排。
 *
 * ```js
 * items.sort(sortByNaturalField((item) => item.name));
 * ```
 */
export function sortByNaturalField(readName) {
    const get = typeof readName === "function"
        ? readName
        : (item) => item?.[readName];
    return (left, right) => compareNaturalNames(get(left), get(right));
}
