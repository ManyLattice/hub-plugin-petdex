"""Каталог Petdex: копия раз в сутки, без сети — старая копия, только картинки с assets.petdex.dev, поиск."""
import json
import os
import shutil
import tempfile
import unittest

from catalog import Catalog, Images, trusted

PETS = {"pets": [
    {"slug": "lulu-capybara", "displayName": "Lulu", "kind": "creature", "submittedBy": "a", "spriteVersionNumber": 1,
     "spritesheetUrl": "https://assets.petdex.dev/pets/lulu/sprite.webp"},
    {"slug": "boba", "displayName": "Boba the Cat", "kind": "creature", "submittedBy": "b", "spriteVersionNumber": 2,
     "spritesheetUrl": "https://assets.petdex.dev/pets/boba/sprite.png"},
    {"slug": "evil", "displayName": "Evil", "kind": "object", "spritesheetUrl": "https://evil.example/sprite.png"},
]}


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="petdex-")
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.path = os.path.join(self.dir, "petdex", "manifest.json")
        self.now, self.calls = 1_000_000.0, []

    def catalog(self, fail=False):
        def download():
            self.calls.append(1)
            if fail:
                raise OSError("нет сети")
            return PETS
        return Catalog(self.path, clock=lambda: self.now, download=download)

    def test_searches_by_name_and_slug_only_trusted_hosts(self):
        c = self.catalog()
        self.assertEqual([p["slug"] for p in c.search("cat")], ["boba"])
        self.assertEqual([p["slug"] for p in c.search("LULU")], ["lulu-capybara"])
        self.assertEqual(c.search("evil"), [])                                  # чужой адрес картинки — нет
        boba = c.get("boba")
        self.assertEqual((boba["rows"], boba["page"]), (11, "https://petdex.dev/pets/boba"))
        self.assertEqual(c.get("lulu-capybara")["rows"], 9)

    def test_downloads_once_a_day_and_keeps_the_old_copy_offline(self):
        self.catalog().load()
        os.utime(self.path, (self.now, self.now))
        self.catalog().load()
        self.assertEqual(len(self.calls), 1)                                    # свежая копия — без сети
        self.now += 25 * 3600
        c = self.catalog(fail=True)
        self.assertEqual(len(c.load()), 2)                                      # сети нет — старая копия
        self.assertEqual(len(self.calls), 2)

    def test_empty_query_gives_the_same_random_pets_all_day(self):
        c = self.catalog()
        self.assertEqual(len(c.search("")), 2)
        self.assertEqual(c.search(""), c.search(""))

    def test_trusted(self):
        self.assertTrue(trusted("https://assets.petdex.dev/x.png"))
        for bad in ("http://assets.petdex.dev/x.png", "https://assets.petdex.dev.evil.com/x", "javascript:alert(1)", None):
            self.assertFalse(trusted(bad))



class ImagesTest(unittest.TestCase):
    def test_downloads_once_only_catalog_pets(self):
        d = tempfile.mkdtemp(prefix="petdex-img-")
        self.addCleanup(shutil.rmtree, d, True)
        c = Catalog(os.path.join(d, "manifest.json"), download=lambda: PETS)
        got = []
        imgs = Images(d, c, download=lambda url: got.append(url) or b"RIFFxxxxWEBP")
        self.assertEqual(imgs.get("sprite", "lulu-capybara"), (b"RIFFxxxxWEBP", "image/webp"))
        self.assertEqual(imgs.get("sprite", "lulu-capybara")[1], "image/webp")
        self.assertEqual(imgs.get("thumb", "boba")[1], "image/webp")              # миниатюра — всегда webp
        self.assertEqual(got, ["https://assets.petdex.dev/pets/lulu/sprite.webp",
                               "https://assets.petdex.dev/pets/boba/thumb.webp"])   # второй раз — с диска
        for what, slug in (("sprite", "evil"), ("sprite", "nope"), ("../x", "boba"), ("sprite", "../../etc")):
            self.assertIsNone(imgs.get(what, slug))


if __name__ == "__main__":
    unittest.main()
