"""Процесс плагина: выбор питомца — постом в канал плагина от его имени; говорит только со страницей хаба."""
import json
import unittest

import main

PAGE = f"http://127.0.0.1:{main.WEB_PORT}"


class FakeCatalog:
    PET = {"slug": "boba", "name": "Boba", "kind": "creature", "by": "b", "sprite": "https://assets.petdex.dev/b.png",
           "rows": 9, "page": "https://petdex.dev/pets/boba"}

    def search(self, q, kind):
        return [self.PET] if q in ("", "bo") else []

    def get(self, slug):
        return self.PET if slug == "boba" else None

    def load(self):
        return [self.PET]


class PluginTest(unittest.TestCase):
    def setUp(self):
        self.posts = []
        self.p = main.Plugin("/nonexistent", catalog=FakeCatalog(), put=self.posts.append)

    def test_search_and_choose_go_to_the_plugin_channel(self):
        code, out = self.p.act("GET", "/search?q=bo", PAGE)
        self.assertEqual((code, [x["slug"] for x in out["pets"]], out["total"]), (200, ["boba"], 1))
        code, out = self.p.act("POST", "/choose", PAGE, {"slug": "boba"})
        self.assertEqual(code, 200)
        (post,) = self.posts
        self.assertEqual((post["plugin"], post["channel"], post["sender"], post["owner"]),
                         (main.CHANNEL, "plugin", main.NAME, False))
        self.assertEqual(json.loads(post["text"])["sprite"], FakeCatalog.PET["sprite"])

    def test_unknown_pet_is_refused(self):
        self.assertEqual(self.p.act("POST", "/choose", PAGE, {"slug": "nope"})[0], 404)
        self.assertEqual(self.posts, [])

    def test_only_the_hub_page_may_talk_to_it(self):
        for origin in ("", "https://evil.example", "http://127.0.0.1:9999"):
            self.assertEqual(self.p.act("POST", "/choose", origin, {"slug": "boba"})[0], 403)
            self.assertEqual(self.p.act("GET", "/search", origin)[0], 403)
        self.assertEqual(self.posts, [])


if __name__ == "__main__":
    unittest.main()
