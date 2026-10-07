"""Каталог Petdex (petdex.dev): копия публичного списка питомцев и поиск по ней.

Список отдаётся без CORS, поэтому страница хаба сама его прочитать не может: процесс плагина держит копию в
<папка состояния>/petdex/manifest.json и перечитывает её раз в сутки. Берём только картинки с assets.petdex.dev —
как и CLI Petdex: другой адрес в списке не доверяем."""
import json
import os
import random
import threading
import time
import urllib.parse
import urllib.request

MANIFEST = "https://petdex.dev/api/manifest"
ASSET_HOST = "assets.petdex.dev"
REFRESH = 24 * 3600
LIMIT = 48


def trusted(url):
    try:
        u = urllib.parse.urlparse(str(url or ""))
    except ValueError:
        return False
    return u.scheme == "https" and u.hostname == ASSET_HOST


def pet_view(p):
    """Питомец для страницы: только то, что нужно показать и нарисовать."""
    return {"slug": p["slug"], "name": p.get("displayName") or p["slug"], "kind": p.get("kind") or "",
            "by": p.get("submittedBy") or "", "sprite": p["spritesheetUrl"],
            "thumb": f"https://{ASSET_HOST}/pets/{urllib.parse.quote(p['slug'])}/thumb.webp",
            "rows": 11 if p.get("spriteVersionNumber") == 2 else 9,
            "page": f"https://petdex.dev/pets/{urllib.parse.quote(p['slug'])}"}


def fetch(url=MANIFEST):
    return json.loads(fetch_bytes(url, limit=64 << 20))


def fetch_bytes(url, limit=8 << 20):
    req = urllib.request.Request(url, headers={"User-Agent": "hub-plugin-petdex"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"{url}: больше {limit} байт")
    return data


class Catalog:
    def __init__(self, path, clock=time.time, download=fetch):
        self.path, self.clock, self.download = path, clock, download
        self.pets, self.loaded = None, 0

    def load(self):
        """Список питомцев: из копии, а раз в сутки (или если копии нет) — заново с petdex.dev."""
        try:
            fresh = self.clock() - os.path.getmtime(self.path) < REFRESH
        except OSError:
            fresh = False
        if not fresh:
            try:
                data = self.download()
                os.makedirs(os.path.dirname(self.path), exist_ok=True)
                tmp = self.path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(data, f)
                os.replace(tmp, self.path)
                self.pets = None
            except (OSError, ValueError):
                pass   # нет сети — старая копия лучше пустого каталога
        if self.pets is None:
            try:
                with open(self.path, encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, ValueError):
                return []
            self.pets = [p for p in (data.get("pets") or []) if isinstance(p, dict) and p.get("slug")
                         and trusted(p.get("spritesheetUrl"))]
        return self.pets

    def search(self, q="", kind="", limit=LIMIT):
        q, pets = str(q or "").strip().lower(), self.load()
        found = [p for p in pets if (not kind or p.get("kind") == kind)
                 and (not q or q in p["slug"].lower() or q in str(p.get("displayName") or "").lower())]
        if not q:   # без запроса — случайные, но одни и те же весь день: листать не мешает
            found = random.Random(int(self.clock() // 86400)).sample(found, min(limit, len(found)))
        return [pet_view(p) for p in found[:limit]]

    def get(self, slug):
        return next((pet_view(p) for p in self.load() if p["slug"] == slug), None)


class Images:
    """Картинки питомцев с assets.petdex.dev — один раз в <папка>/<вид>/<slug>.<расширение>, дальше с диска."""

    def __init__(self, root, catalog, download=fetch_bytes):
        self.root, self.catalog, self.download = root, catalog, download

    def get(self, what, slug):
        """(байты, тип) или None: what — sprite или thumb, только для питомцев из каталога."""
        pet = self.catalog.get(slug)
        if not pet or what not in ("sprite", "thumb"):
            return None
        url = pet[what]
        ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lower()
        if ext not in (".webp", ".png") or not trusted(url):
            return None
        path = os.path.join(self.root, what, urllib.parse.quote(slug, safe="") + ext)
        if not os.path.exists(path):
            try:
                data = self.download(url)
            except (OSError, ValueError):
                return None
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = f"{path}.{threading.get_ident()}.tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, path)
        with open(path, "rb") as f:
            return f.read(), "image/webp" if ext == ".webp" else "image/png"
