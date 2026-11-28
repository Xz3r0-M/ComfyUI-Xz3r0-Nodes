"""按「人看着顺眼」的顺序比名字（数字按大小比，不按字符比）。

直接比字符串会把数字拆成字符逐个比，于是 ``10`` 排在 ``2`` 前面::

    1, 10, 11, 110, 2, 20, 200     ← 直接比字符串

人期待的是按数值比::

    1, 2, 10, 11, 20, 110, 200     ← 这里干的事

做法：把名字切成「文字段」和「数字段」，文字段按小写逐字比，数字段按
数值比（先去掉前导零，再比位数、再逐位比——这样再长的数字也不会比错）。

前端有一份逐字对应的实现（``web/core/natural-sort.js``）。两份规则必须
一致：否则「服务器排好的顺序」和「浏览器自己重排的顺序」会打架，翻页时
看着像乱跳。所以两边都用这份**可复现**的规则，而不用各自语言的本地排序表。
"""

from __future__ import annotations

import re
from typing import Any

# 名字里连续的数字算一段，其余算文字段。用捕获分组切分，数字段会被单独
# 留下来（这是 ``re.split`` 的行为）。
_CHUNK_PATTERN = re.compile(r"(\d+)")

#: SQLite 排序规则名（注册与使用必须一致）。
#:
#: 不能叫 ``natural``：那是 SQLite 的关键字（``NATURAL JOIN``），
#: 写成 ``ORDER BY name COLLATE natural`` 会直接报语法错。
NATURAL_COLLATION = "xz3r0_natural"


def natural_key(text: Any) -> tuple[tuple[int, Any], ...]:
    """把名字转成可比较的键。

    每段带上类型标记（0 = 数字，1 = 文字），保证比较时永远是同类型相比：
    ``(1, 0, "abc")`` 和 ``(0, 1, "5")`` 先比标记，比到具体值的时候类型
    一定相同。数字排在文字前面（``1.png`` < ``a.png``），和资源管理器、
    浏览器的语言排序表都一致。

    文字段统一转小写，这样 ``A.png`` 和 ``a.png`` 算同级。数字段是
    ``(1, 位数, 去零数字串)``：先比位数再逐位比，等价于按数值比，但再长
    的数字也不会比错。

    返回的键可以直接当 ``sort(key=...)`` 用（元组本身就是可比较的），
    前端那边逐字对应的比较函数也是同一套语义。
    """
    chunks: list[tuple[int, int, str]] = []
    for part in _CHUNK_PATTERN.split(str(text or "")):
        if not part:
            continue
        if part.isdigit():
            digits = part.lstrip("0") or "0"
            # 中间那位放位数：先比位数再逐位比 ≈ 按数值比，但没有精度问题
            # 类型 0 = 数字：数字排在文字前面，和资源管理器 / ICU 一致
            chunks.append((0, len(digits), digits))
        else:
            chunks.append((1, 0, part.lower()))
    return tuple(chunks)


def compare_natural(left: Any, right: Any) -> int:
    """比较两个名字，返回 −1 / 0 / 1（和 JS 比较器同一套语义）。"""
    a = str(left or "")
    b = str(right or "")
    if a == b:
        return 0
    left_chunks = natural_key(a)
    right_chunks = natural_key(b)
    if left_chunks == right_chunks:
        return 0
    return -1 if left_chunks < right_chunks else 1


def natural_collate(left: Any, right: Any) -> int:
    """给 sqlite3 的 ``create_collation`` 用的三值比较。

    SQLite 里 ``ORDER BY filename`` 默认按字节比，所以数字同样是错的。
    注册成 ``natural`` 排序规则后，SQL 里写 ``filename COLLATE natural``
    就能拿到自然顺序，而且分页（LIMIT/OFFSET）仍然由 SQLite 在排序之后
    做，不用把整张表捞到 Python 里再切页。
    """
    return compare_natural(left, right)
