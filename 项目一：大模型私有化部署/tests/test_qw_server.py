"""不加载模型权重的 API 输入与安全边界测试。"""

import base64
from pathlib import Path
import unittest

try:
    from qw_server import ChatMessage, cleanup, convert_messages, is_safe_remote_host
    SERVER_IMPORT_ERROR = None
except ModuleNotFoundError as error:
    # 本地文档/客户端环境可能没有安装 GPU 依赖；AutoDL 安装 requirements 后会执行这些测试。
    SERVER_IMPORT_ERROR = error


@unittest.skipIf(SERVER_IMPORT_ERROR is not None, f"server dependencies unavailable: {SERVER_IMPORT_ERROR}")
class MediaConversionTests(unittest.TestCase):
    def test_data_url_is_written_and_cleaned_up(self):
        encoded = base64.b64encode(b"example-image-bytes").decode("ascii")
        data_url = "data" + ":image/png;base64," + encoded
        messages = [
            ChatMessage(
                role="user",
                content=[
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": "描述图片"},
                ],
            )
        ]

        converted, temporary_files = convert_messages(messages)
        try:
            self.assertEqual(converted[0]["content"][0]["type"], "image")
            self.assertTrue(Path(temporary_files[0]).is_file())
        finally:
            cleanup(temporary_files)
        self.assertFalse(Path(temporary_files[0]).exists())


@unittest.skipIf(SERVER_IMPORT_ERROR is not None, f"server dependencies unavailable: {SERVER_IMPORT_ERROR}")
class RemoteHostSafetyTests(unittest.TestCase):
    def test_private_and_loopback_hosts_are_rejected(self):
        for host in ("localhost", "127.0.0.1", "10.0.0.1", "192.168.1.1", "::1"):
            with self.subTest(host=host):
                self.assertFalse(is_safe_remote_host(host))

    def test_public_ip_is_allowed_when_remote_media_is_enabled(self):
        self.assertTrue(is_safe_remote_host("8.8.8.8"))


if __name__ == "__main__":
    unittest.main()
