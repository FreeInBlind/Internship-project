"""不访问网络的命令行客户端单元测试。"""

import unittest

from cli import build_content


class CliContentTests(unittest.TestCase):
    def test_text_only_request_uses_a_string(self):
        self.assertEqual(build_content("你好", None, None), "你好")

    def test_image_and_video_are_mutually_exclusive(self):
        with self.assertRaises(ValueError):
            build_content("描述内容", "image.jpg", "video.mp4")


if __name__ == "__main__":
    unittest.main()
