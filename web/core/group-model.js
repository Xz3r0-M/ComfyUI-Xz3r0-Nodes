/**
 * 列表分组的纯函数模型
 * ====================
 *
 * 只处理数据，不碰界面。分两件事：
 *
 * 一、整理
 *   保证「同组的行在数组里必须连续」，并让「空组」不存在。
 *
 * 二、归属计算
 *   缝隙属于哪一组、拖拽落点换算、建组 / 删组 / 自动解散。
 *
 * 为什么组要有序
 * --------------
 * 分组不是为了分类展示，而是把加载顺序变成看得见的块：
 * 数组摊平后的顺序就是加载顺序，不额外维护一份「组的顺序」。
 * 代价是同组必须连续，这一条由本模块的整理函数守住。
 *
 * 设计约定
 * --------
 * - 行可以是任意对象，模型只认 `group` 字段（组 id 或 null）
 * - `group` 为 null 表示未分组：它可以待在列表任意位置，
 *   而且**不渲染组头**（它不是「一个组」，只是「没有组」）
 * - 组记录只认 `id` / `name` / `collapsed`，其余字段原样透传，
 *   这样后续给某个节点加「组强度」之类的字段不用改本模块
 * - 行标识通过 `options.keyOf` 注入（XMediaListGet 用行 uid，
 *   XLoraGet 用 id），模型不假设字段名
 * - 所有函数都不修改入参，返回新数组
 * - 组不允许为空：最后一个成员离开时组记录立即删除
 */

const DEFAULT_KEY_FIELDS = ["ref", "id"];

/** 默认的行标识：先看 ref，再看 id（两个节点各命中一个）。 */
function defaultKeyOf(row) {
    if (!row || typeof row !== "object") {
        return "";
    }
    for (const field of DEFAULT_KEY_FIELDS) {
        const value = String(row[field] || "").trim();
        if (value) {
            return value;
        }
    }
    return "";
}

function resolveKeyOf(options) {
    const keyOf = options && options.keyOf;
    return typeof keyOf === "function" ? keyOf : defaultKeyOf;
}

/** 组 id 只接受非空字符串，其他一律视为未分组。 */
function normalizeGroupId(value) {
    if (typeof value !== "string") {
        return null;
    }
    const id = value.trim();
    return id || null;
}

/** 只改 `group` 字段，其它字段原样保留（引用能不动就不动）。 */
function withGroup(row, groupId) {
    if (!row || typeof row !== "object") {
        return row;
    }
    const current = normalizeGroupId(row.group);
    if (current === groupId) {
        return row;
    }
    return { ...row, group: groupId };
}

function copyRow(row) {
    return row && typeof row === "object" ? row : row;
}

/**
 * 组的「序列号」：建组时分配，之后永不改变、永不复用。
 *
 * 它是这一组的身份：界面要指代某一组（比如工具栏上「只作用于这一组」）
 * 只念这个号，不念用户起的名字——名字可以很长、可以随时改，念名字会
 * 把界面撑变形。
 */
function groupSeqOf(record) {
    const value = Number(record && record.seq);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/** 下一个可用的序列号（现有最大值 + 1，删掉的号不回收）。 */
function nextGroupSeq(groups) {
    let max = 0;
    for (const record of Array.isArray(groups) ? groups : []) {
        max = Math.max(max, groupSeqOf(record));
    }
    return max + 1;
}

function normalizeGroupRecords(groups) {
    if (!Array.isArray(groups)) {
        return [];
    }
    const seen = new Set();
    const output = [];
    for (const entry of groups) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const id = normalizeGroupId(entry.id);
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        output.push({
            ...entry,
            id,
            name: String(entry.name == null ? "" : entry.name),
            collapsed: entry.collapsed === true,
            seq: groupSeqOf(entry),
        });
    }
    // 老数据没有序列号：按出现顺序补「最小的空号」。已经有号的一律不动，
    // 所以重复整理（每次渲染都会走一遍）不会把号打乱。
    // 注意这里用「最小空号」而不是「最大号 + 1」：老数据本身就是按建组
    // 顺序排的，补出来正好是 1、2、3…，不会莫名其妙从 6 开始。
    const used = new Set(output.map((record) => record.seq).filter(Boolean));
    let free = 1;
    for (const record of output) {
        if (record.seq) {
            continue;
        }
        while (used.has(free)) {
            free += 1;
        }
        record.seq = free;
        used.add(free);
    }
    return output;
}

/**
 * 把被打断的同组成员聚拢到第一次出现的位置，段内相对顺序不变。
 *
 * 正常操作不会触发（拖拽规则按构造保证连续），这里处理的是
 * 旧数据、撤销快照、外部手改 JSON 这类异常来源。
 */
function gatherGroupRuns(rows) {
    const members = new Map();
    const first = new Map();
    const last = new Map();
    rows.forEach((row, index) => {
        const id = normalizeGroupId(row && row.group);
        if (!id) {
            return;
        }
        if (!members.has(id)) {
            members.set(id, []);
            first.set(id, index);
        }
        members.get(id).push(row);
        last.set(id, index);
    });
    let split = false;
    for (const [id, list] of members) {
        if (last.get(id) - first.get(id) + 1 > list.length) {
            split = true;
            break;
        }
    }
    if (!split) {
        return rows.slice();
    }
    const emitted = new Set();
    const output = [];
    for (const row of rows) {
        const id = normalizeGroupId(row && row.group);
        if (!id) {
            output.push(row);
            continue;
        }
        if (emitted.has(id)) {
            continue;
        }
        emitted.add(id);
        for (const member of members.get(id)) {
            output.push(member);
        }
    }
    return output;
}

/**
 * 剔除没有成员的组记录。
 *
 * 返回的 `dissolved` 是组记录数组，调用方负责把名字变成提示文案。
 */
function dissolveIfEmpty(items, groups) {
    const rows = Array.isArray(items) ? items : [];
    const records = normalizeGroupRecords(groups);
    const alive = new Set();
    for (const row of rows) {
        const id = normalizeGroupId(row && row.group);
        if (id) {
            alive.add(id);
        }
    }
    const kept = [];
    const dissolved = [];
    for (const record of records) {
        if (alive.has(record.id)) {
            kept.push(record);
        } else {
            dissolved.push(record);
        }
    }
    return { items: rows, groups: kept, dissolved };
}

/**
 * 落地不变量：清掉失效引用 → 聚拢同组行 → 剔除空组。
 *
 * 传进来的数据可能来自旧版本（没有 groups、行上没有 group），
 * 这里必须能安静地接受，并且不打乱原有顺序。
 */
function normalizeGroups(items, groups) {
    const rows = Array.isArray(items) ? items : [];
    const records = normalizeGroupRecords(groups);
    const valid = new Set(records.map((record) => record.id));
    const cleaned = rows.map((row) => {
        const id = normalizeGroupId(row && row.group);
        if (!id || !valid.has(id)) {
            return withGroup(row, null);
        }
        return withGroup(row, id);
    });
    const gathered = gatherGroupRuns(cleaned);
    return dissolveIfEmpty(gathered, records);
}

/**
 * 缝隙归属：认**上方那一行**所属的组。
 *
 * 最顶上的缝隙没有上方行，所以是未分组——这也是「把某行移出
 * 分组」最直接的手段（拖到列表最上面）。
 */
function groupOfGap(items, gapIndex) {
    const rows = Array.isArray(items) ? items : [];
    const index = Math.trunc(Number(gapIndex));
    if (!Number.isFinite(index) || index <= 0) {
        return null;
    }
    const above = rows[Math.min(index, rows.length) - 1];
    return normalizeGroupId(above && above.group);
}

/**
 * 缝隙序号 → 落点序号。
 *
 * 往下拖时被拖的行还占着位置，抽走自己后目标要往前挪一格；
 * 往上拖时两者相等。漏掉这一步的表现是「插入线比真实落点低一行」。
 */
function moveTargetFromGap(gapIndex, fromIndex) {
    const gap = Math.trunc(Number(gapIndex));
    const from = Math.trunc(Number(fromIndex));
    if (!Number.isFinite(gap) || !Number.isFinite(from)) {
        return 0;
    }
    const target = gap > from ? gap - 1 : gap;
    return Math.max(0, target);
}

/** 组里最少要有一名成员，才谈得上「插到组的第一位」。 */
function validGroupIds(groups) {
    return new Set(normalizeGroupRecords(groups).map((record) => record.id));
}

function moveRowToGap(items, groups, fromIndex, gapIndex, options) {
    const rows = Array.isArray(items) ? items : [];
    const from = Math.trunc(Number(fromIndex));
    if (!Number.isFinite(from) || from < 0 || from >= rows.length) {
        return {
            items: rows.slice(),
            groups: normalizeGroupRecords(groups),
            dissolved: [],
        };
    }
    const valid = validGroupIds(groups);
    const rest = rows.slice();
    const [row] = rest.splice(from, 1);
    const target = Math.min(
        moveTargetFromGap(gapIndex, from),
        rest.length
    );
    // 归属默认跟「上方那一行」走；调用方如果知道用户指的就是某一组
    // （指针停在那组的行上），可以用 groupId 直接指定。
    const pinned = Boolean(options) && options.groupId !== undefined;
    const above = target > 0 ? rest[target - 1] : null;
    const wanted = pinned
        ? normalizeGroupId(options.groupId)
        : normalizeGroupId(above && above.group);
    const owner = wanted && valid.has(wanted) ? wanted : null;
    rest.splice(target, 0, withGroup(row, owner));
    const merged = dissolveIfEmpty(rest, groups);
    const keyOf = resolveKeyOf(options);
    return {
        items: merged.items,
        groups: merged.groups,
        dissolved: merged.dissolved,
        key: keyOf(row),
        groupId: owner,
    };
}

/**
 * 拖到组头：展开的组放最前面，折叠的组追加到末尾。
 *
 * `append` 为 true 时插到该组最后一名成员之后，否则插到第一名成员之前。
 */
function moveRowIntoGroup(items, groups, fromIndex, groupId, options) {
    const rows = Array.isArray(items) ? items : [];
    const records = normalizeGroupRecords(groups);
    const valid = new Set(records.map((record) => record.id));
    const target = normalizeGroupId(groupId);
    const from = Math.trunc(Number(fromIndex));
    const append = Boolean(options && options.append);
    if (
        !target
        || !valid.has(target)
        || !Number.isFinite(from)
        || from < 0
        || from >= rows.length
    ) {
        return { items: rows.slice(), groups: records, dissolved: [] };
    }
    const rest = rows.slice();
    const [row] = rest.splice(from, 1);
    let insertAt = -1;
    if (append) {
        for (let index = rest.length - 1; index >= 0; index -= 1) {
            if (normalizeGroupId(rest[index].group) === target) {
                insertAt = index + 1;
                break;
            }
        }
    } else {
        for (let index = 0; index < rest.length; index += 1) {
            if (normalizeGroupId(rest[index].group) === target) {
                insertAt = index;
                break;
            }
        }
    }
    if (insertAt < 0) {
        insertAt = Math.min(from, rest.length);
    }
    rest.splice(insertAt, 0, withGroup(row, target));
    const merged = dissolveIfEmpty(rest, records);
    return {
        items: merged.items,
        groups: merged.groups,
        dissolved: merged.dissolved,
        groupId: target,
    };
}

/** 某一组成员在数组里的下标区间 `[start, end)`，空组返回 `{start: -1, end: -1}`。 */
function groupRange(rows, groupId) {
    let start = -1;
    let end = -1;
    rows.forEach((row, index) => {
        if (normalizeGroupId(row && row.group) !== groupId) {
            return;
        }
        if (start < 0) {
            start = index;
        }
        end = index + 1;
    });
    return { start, end };
}

/**
 * 把一整组搬到别的缝隙。
 *
 * 跟单行拖动的区别：搬的是连续一整段，成员之间的顺序完全不变，
 * 也不会「加入」别的组 —— 组不能套组，所以落点如果落在别的组
 * 中间，就顺到那个组后面去。
 *
 * 返回值里 `gap` 是落点在**原数组坐标**里的缝隙，供插入线定位；
 * `moved` 为 false 表示原地不动（例如把一组拖到它自己身上）。
 */
function moveGroupToGap(items, groups, groupId, gapIndex) {
    const rows = Array.isArray(items) ? items : [];
    const records = normalizeGroupRecords(groups);
    const target = normalizeGroupId(groupId);
    const raw = Math.trunc(Number(gapIndex));
    const clamped = Number.isFinite(raw)
        ? Math.min(Math.max(raw, 0), rows.length)
        : 0;
    const stay = {
        items: rows.slice(),
        groups: records,
        dissolved: [],
        moved: false,
        gap: clamped,
        insertAt: -1,
    };
    if (!target || !Number.isFinite(raw)) {
        return stay;
    }
    const { start, end } = groupRange(rows, target);
    if (start < 0) {
        return stay;
    }
    const block = rows.slice(start, end);
    const rest = rows.slice(0, start).concat(rows.slice(end));
    // 缝隙换算成「抽走整块之后」的下标：块里位于缝隙上方的行要减掉
    const above = Math.min(Math.max(clamped - start, 0), block.length);
    const at = snapOutsideGroupRun(
        rest,
        Math.min(Math.max(clamped - above, 0), rest.length)
    );
    if (at === start) {
        return { ...stay, gap: clamped };
    }
    const merged = rest.slice(0, at).concat(block, rest.slice(at));
    // 落点在原数组坐标里的位置：数一遍「抽走整块后第 at 行」原本在哪
    let gap = rows.length;
    let cursor = 0;
    for (let index = 0; index < rows.length; index += 1) {
        if (index >= start && index < end) {
            continue;
        }
        if (cursor === at) {
            gap = index;
            break;
        }
        cursor += 1;
    }
    const result = dissolveIfEmpty(merged, records);
    return {
        items: result.items,
        groups: result.groups,
        dissolved: result.dissolved,
        moved: true,
        gap,
        insertAt: at,
    };
}

/**
 * 插入点不能落在某一组的中间，否则会把那一组拆成两段。
 *
 * 建组时最容易踩到：被选中的行原本夹在自己那一组里，抽走它以后
 * 原来的位置恰好落在同组剩下两行之间。
 */
function snapOutsideGroupRun(rows, index) {
    if (index <= 0 || index >= rows.length) {
        return index;
    }
    const above = normalizeGroupId(rows[index - 1].group);
    const below = normalizeGroupId(rows[index].group);
    if (!above || above !== below) {
        return index;
    }
    let cursor = index;
    while (
        cursor < rows.length
        && normalizeGroupId(rows[cursor].group) === above
    ) {
        cursor += 1;
    }
    return cursor;
}

/** 下一个可用的组 id（g1、g2……，跳过已被占用的）。 */
function nextGroupId(groups) {
    const used = new Set(
        normalizeGroupRecords(groups).map((record) => record.id)
    );
    let index = 1;
    while (used.has(`g${index}`)) {
        index += 1;
    }
    return `g${index}`;
}

/**
 * 用选中的文件建组。
 *
 * 选中的行会聚拢到「最上面那个选中行」的位置——因为同组必须连续，
 * 这一步不动的话组会被别的行打断。没选中任何行时原样返回。
 */
function createGroupFromSelection(items, groups, keys, name, options) {
    const rows = Array.isArray(items) ? items : [];
    const records = normalizeGroupRecords(groups);
    const keyOf = resolveKeyOf(options);
    const wanted = new Set(
        (Array.isArray(keys) ? keys : []).map((key) => String(key))
    );
    let firstIndex = -1;
    let insertAt = 0;
    const picked = [];
    const rest = [];
    rows.forEach((row, index) => {
        const key = String(keyOf(row));
        if (wanted.has(key)) {
            if (firstIndex < 0) {
                firstIndex = index;
            }
            picked.push(row);
            return;
        }
        if (firstIndex < 0) {
            insertAt += 1;
        }
        rest.push(row);
    });
    if (firstIndex < 0) {
        return { items: rows.slice(), groups: records, id: null };
    }
    const id = nextGroupId(records);
    const label = String(name == null ? "" : name).trim() || id;
    const block = picked.map((row) => withGroup(row, id));
    const merged = rest.slice();
    const at = snapOutsideGroupRun(rest, insertAt);
    merged.splice(at, 0, ...block);
    const mergedGroups = [
        ...records,
        { id, name: label, collapsed: false, seq: nextGroupSeq(records) },
    ];
    const result = dissolveIfEmpty(merged, mergedGroups);
    return {
        items: result.items,
        groups: result.groups,
        dissolved: result.dissolved,
        id,
        insertAt: at,
    };
}

function renameGroup(groups, id, name) {
    const target = normalizeGroupId(id);
    const label = String(name == null ? "" : name);
    return normalizeGroupRecords(groups).map((record) => {
        if (record.id !== target) {
            return record;
        }
        return { ...record, name: label };
    });
}

function setCollapsed(groups, id, collapsed) {
    const target = normalizeGroupId(id);
    return normalizeGroupRecords(groups).map((record) => {
        if (record.id !== target) {
            return record;
        }
        return { ...record, collapsed: collapsed === true };
    });
}

/**
 * 删除一个组。
 *
 * - `mode: "ungroup"`：文件留在原位置，变成未分组（顺序完全不变）
 * - `mode: "delete"`：连同组内文件一起删掉
 *
 * 返回的 `removed` 是被处理掉的文件数，供确认文案与撤销提示使用。
 */
function deleteGroup(items, groups, id, mode) {
    const rows = Array.isArray(items) ? items : [];
    const records = normalizeGroupRecords(groups);
    const target = normalizeGroupId(id);
    if (!target) {
        return { items: rows.slice(), groups: records, removed: 0 };
    }
    const dropFiles = mode === "delete";
    const kept = [];
    let removed = 0;
    for (const row of rows) {
        if (normalizeGroupId(row && row.group) === target) {
            removed += 1;
            if (!dropFiles) {
                kept.push(withGroup(row, null));
            }
            continue;
        }
        kept.push(row);
    }
    return {
        items: kept,
        groups: records.filter((record) => record.id !== target),
        removed,
    };
}

/** 只读查询：某个组的成员（按数组顺序）。 */
function groupMembers(items, id) {
    const target = normalizeGroupId(id);
    const rows = Array.isArray(items) ? items : [];
    if (!target) {
        return [];
    }
    return rows.filter(
        (row) => normalizeGroupId(row && row.group) === target
    );
}

/**
 * 摊平成渲染用的行序列：组头 + 成员行。
 *
 * - 组头只在第一次遇到该组成员时出现一次
 * - 折叠的组只出组头，不出成员行（成员行仍然留在数组里）
 * - 行的 `index` 始终是它在数组里的真实下标，拖拽与删除靠它定位
 * - `seq` 是「实际会加载的第几个」，由调用方传入 `willLoad` 判定；
 *   不加载的行 `seq` 为 0
 */
function buildRenderList(items, groups, options) {
    const rows = Array.isArray(items) ? items : [];
    const records = normalizeGroupRecords(groups);
    const byId = new Map(records.map((record) => [record.id, record]));
    const membersByGroup = new Map();
    for (const row of rows) {
        const id = normalizeGroupId(row && row.group);
        if (!id) {
            continue;
        }
        if (!membersByGroup.has(id)) {
            membersByGroup.set(id, []);
        }
        membersByGroup.get(id).push(row);
    }
    const willLoad = options && typeof options.willLoad === "function"
        ? options.willLoad
        : null;
    // 序号先把整个数组数一遍再渲染：折叠起来的组虽然不出行，它的文件
    // 照样会被加载，号码必须留着，否则下面那些行的号会集体往前缩，
    // 跟真实的加载顺序对不上。
    const seqByIndex = new Map();
    let seq = 0;
    rows.forEach((row, index) => {
        const loads = willLoad ? Boolean(willLoad(row, index)) : true;
        if (loads) {
            seq += 1;
            seqByIndex.set(index, seq);
        }
    });
    const entries = [];
    const started = new Set();
    rows.forEach((row, index) => {
        const id = normalizeGroupId(row && row.group);
        const record = id ? byId.get(id) : null;
        if (record && !started.has(record.id)) {
            started.add(record.id);
            const members = membersByGroup.get(record.id) || [];
            entries.push({
                type: "group",
                groupId: record.id,
                group: record,
                members,
                memberCount: members.length,
                collapsed: record.collapsed === true,
            });
        }
        if (record && record.collapsed === true) {
            return;
        }
        entries.push({
            type: "row",
            index,
            row: copyRow(row),
            groupId: record ? record.id : null,
            seq: seqByIndex.get(index) || 0,
        });
    });
    return entries;
}

export {
    buildRenderList,
    createGroupFromSelection,
    deleteGroup,
    dissolveIfEmpty,
    groupMembers,
    groupOfGap,
    groupSeqOf,
    nextGroupSeq,
    moveGroupToGap,
    moveRowIntoGroup,
    moveRowToGap,
    moveTargetFromGap,
    nextGroupId,
    normalizeGroups,
    renameGroup,
    setCollapsed,
};
