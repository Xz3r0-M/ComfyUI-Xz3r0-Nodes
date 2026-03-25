"""
XStringGet 节点模块 (V3 API)
==========================

从 XDataHub 接收文本并输出字符串。
"""

from __future__ import annotations

from comfy_api.latest import io


class XStringGet(io.ComfyNode):
    """
    XStringGet 从 XDataHub 接收文本内容。
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="XStringGet",
            display_name="XStringGet",
            description="Load latest text sent from XDataHub",
            category="♾️ Xz3r0/File-Processing",
            inputs=[
                io.String.Input(
                    "text_value",
                    default="",
                    multiline=True,
                    tooltip=(
                        "XDataHub text content "
                        "(empty means no output)"
                    ),
                    socketless=True,
                    extra_dict={"hidden": True},
                ),
            ],
            outputs=[
                io.String.Output(
                    "STRING",
                    display_name="STRING",
                    tooltip="Latest text received from XDataHub",
                ),
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, text_value: str = "") -> int:
        if not text_value:
            return 0
        return cls._fingerprint_text(text_value)

    @classmethod
    def execute(cls, text_value: str = "") -> io.NodeOutput:
        return io.NodeOutput(str(text_value or ""))

    @staticmethod
    def _fingerprint_text(text_value: str) -> int:
        import hashlib

        digest = hashlib.sha1(
            str(text_value).encode("utf-8", errors="ignore")
        ).hexdigest()
        return int(digest, 16)


def NODE_CLASS_MAPPINGS():
    return [XStringGet]
