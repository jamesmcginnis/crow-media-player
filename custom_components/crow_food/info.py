"""About This Food and Find a Photo.

* About This Food - the AI looks a product up once: what it is in general, storage tips and how long it keeps
  (unopened, once opened, frozen), a typical serving with approximate carbs, GI and calories, dietary notes,
  typical ingredients and a fun fact. Serving and cooking ideas are fetched the first time someone opens them.
  Everything is saved with the product, so each product costs one AI call and everyone shares the answer.
* Find a Photo - a general picture of the food for products without a photo: the lead image of the best
  matching Wikipedia article (never a raw image search, which matches unrelated things), saved as WebP the same
  way as every other product photo. It isn't the brand's packet, just a picture of the food.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .store import CrowFood, FoodError, now_ms

_LOGGER = logging.getLogger(__name__)

SCHEMA = 1
USER_AGENT = "CrowFood/0.0.2 (Home Assistant integration; https://github.com/jamesmcginnis/crow-food)"
GI = ("low", "medium", "high", "unknown")

# ── Asking the photo and product services ─────────────────────────────────────────────────────────────
# They're free services run on donated servers, so they're sometimes busy. Each request is tried twice (a busy
# service often answers the second time); a service that still fails is left out of Find Photos for a while, so
# the others aren't kept waiting for it. The health check always asks, and a good answer brings it back.
REST_SECS = 30 * 60
_RESTING: dict[str, float] = {}


class ServiceError(FoodError):
    """A service answered with an error, or didn't answer."""

    def __init__(self, status: int | None, msg: str) -> None:
        super().__init__("http", msg)
        self.status = status


def resting(service: str) -> float | None:
    """When the service comes back into Find Photos, if it's being left out."""
    import time
    until = _RESTING.get(service)
    if until and until > time.time():
        return until
    _RESTING.pop(service, None)
    return None


def mark(service: str, ok: bool) -> None:
    import time
    if ok:
        _RESTING.pop(service, None)
    else:
        _RESTING[service] = time.time() + REST_SECS


async def get_json(session, service: str, url: str, params: dict | None = None, tries: int = 2, timeout: float = 15) -> Any:
    """The service's answer as JSON, tried again once after a second if it's busy (5xx) or doesn't answer.
    Raises ServiceError when it still fails, and leaves the service out for a while."""
    status: int | None = None
    err_name = ""
    for n in range(tries):
        if n:
            await asyncio.sleep(1)
        try:
            async with asyncio.timeout(timeout):
                r = await session.get(url, params=params, headers={"User-Agent": USER_AGENT})
                status = r.status
                if status == 200:
                    data = await r.json(content_type=None)
                    mark(service, True)
                    return data
        except Exception as err:  # noqa: BLE001 - offline, slow, not JSON
            status, err_name = None, type(err).__name__
            continue
        if status < 500 and status != 429:
            break   # a 4xx won't change by asking again
    if status is None or status >= 500 or status == 429:
        mark(service, False)
    raise ServiceError(status, f"HTTP {status}" if status else (err_name or "No answer"))


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f >= 0 else None


def _days(v: Any) -> int | None:
    n = _num(v)
    return int(round(n)) if n is not None and n <= 3650 else None


def _strs(v: Any, n: int, size: int = 80) -> list[str]:
    return [str(x).strip()[:size] for x in (v or []) if str(x).strip()][:n] if isinstance(v, list) else []


def _clean(out: dict) -> dict:
    """The AI's answer, tidied and size-limited, the way it's saved."""
    s = lambda k, n=200: (str(out.get(k)).strip()[:n] if out.get(k) not in (None, "") else None)  # noqa: E731
    gi = str(out.get("gi_category") or "unknown").lower()
    return {
        "v": SCHEMA, "ts": now_ms(),
        "name": s("name", 120), "generic": s("generic_search_term", 60), "category": s("category", 60),
        "serving": s("typical_serving", 80), "carbs_g": _num(out.get("approx_carbs_g")),
        "gi": gi if gi in GI else "unknown", "kcal": _num(out.get("calories_kcal")),
        "dietary": _strs(out.get("dietary_tags"), 8, 40),
        "storage_tip": s("storage_tip", 300), "where": s("where_to_keep", 40),
        "keeps_unopened": s("shelf_life_unopened", 60), "keeps_opened": s("shelf_life_opened", 60),
        "keeps_frozen": s("shelf_life_frozen", 60),
        "opened_days": _days(out.get("opened_days")), "frozen_days": _days(out.get("frozen_days")),
        "fun_fact": s("fun_fact", 300), "note": s("note", 300),
        "ingredients": _strs(out.get("ingredients"), 10, 60) or None,
    }


async def async_info(hass, food: CrowFood, pid: str, refresh: bool = False) -> dict:
    from . import ai

    p = food.product(pid)
    have = p.get("info") or {}
    if have.get("v") == SCHEMA and not refresh:
        return have
    if not ai.feature_on(food, "info"):
        raise FoodError("ai_off", ai.FRIENDLY["off"])
    name = p.get("name", "")
    cat = (food.data["categories"].get(p.get("category")) or {}).get("name", "")
    size = f"{p['content']:g} {p.get('content_unit', '')}".strip() if p.get("content") else ""
    country = hass.config.country or ""
    text = await ai._task(hass, food, "Crow Food: about this food", (
        "You are a general food, nutrition and storage reference, like a food-label lookup tool. "
        f'For the product "{name}"' + (f" ({size})" if size else "") + (f", which this household files under {cat}" if cat else "")
        + (f", bought in {country}" if country else "") + ", return ONLY a JSON object (no markdown, no commentary) with fields: "
        '{"name":"...","generic_search_term":"...","category":"...","typical_serving":"...","approx_carbs_g":number_or_null,'
        '"gi_category":"low"|"medium"|"high"|"unknown","calories_kcal":number_or_null,"dietary_tags":["..."],'
        '"storage_tip":"...","where_to_keep":"cupboard"|"fridge"|"freezer","shelf_life_unopened":"...",'
        '"shelf_life_opened":"..."_or_null,"opened_days":number_or_null,"shelf_life_frozen":"..."_or_null,'
        '"frozen_days":number_or_null,"fun_fact":"...","note":"...","ingredients":["..."]_or_null}. '
        "These are general estimates for a typical product of this kind, not this exact brand. "
        '"generic_search_term" is the single most common name for this food, 1 to 3 words, as its Wikipedia article '
        'would be titled ("French fries", not "Tesco French fries 1.5kg"); no brands or sizes. '
        '"approx_carbs_g" and "calories_kcal" are for the "typical_serving" amount, not per 100 g. '
        '"storage_tip" is one or two short sentences on keeping it well. "shelf_life_*" are short phrases like '
        '"18 months" or "3 to 5 days"; "opened_days" is how many days it keeps once opened (null if opening makes '
        'no difference) and "frozen_days" how many days it keeps well in a freezer (null if it shouldn\'t be frozen). '
        '"dietary_tags" are short, only when clearly true (vegetarian, vegan, gluten-free, dairy-free, contains nuts). '
        '"ingredients" are 4 to 8 typical ingredients, only for prepared foods and dishes (null for simple foods). '
        '"note" is one short sentence about how much brands or recipes vary. If you don\'t recognise it, still give '
        "your best general guess for name, generic_search_term, category and storage."))
    out = ai._json(text)
    if not isinstance(out, dict) or not out:
        raise FoodError("ai_failed", ai.FRIENDLY["garbled"])
    info = _clean(out)
    if not refresh:   # ideas fetched before (from Use It Up) are kept
        info.update({k: v for k, v in have.items() if k.startswith("ideas_")})
    p["info"] = info
    food._changed("products", [p])
    return info


async def async_ideas(hass, food: CrowFood, pid: str, kind: str) -> list[str]:
    from . import ai

    if kind not in ("serving", "cooking"):
        raise FoodError("bad", "Unknown kind of idea.")
    p = food.product(pid)
    info = p.get("info") or {}
    key = f"ideas_{kind}"
    if info.get(key):
        return info[key]
    if not ai.feature_on(food, "info"):
        raise FoodError("ai_off", ai.FRIENDLY["off"])
    name = info.get("name") or p.get("name", "")
    cat = info.get("category") or ""
    ask = ("suggest 3 or 4 short, appetising ways to serve or pair it: sides, sauces or occasions. Each under 12 words."
           if kind == "serving" else
           "suggest 3 or 4 short tips or variations for preparing it beyond the basic method: seasoning, flavour "
           "pairings or ways to make it better. Each under 14 words.")
    text = await ai._task(hass, food, f"Crow Food: {kind} ideas", (
        f'For the food "{name}"' + (f" (category: {cat})" if cat else "") + f", {ask} "
        'Return ONLY a JSON array of short strings (no markdown, no numbering), e.g. ["...", "..."].'))
    out = ai._json(text)
    if isinstance(out, dict):
        out = next((v for v in out.values() if isinstance(v, list)), [])
    ideas = _strs(out, 5, 120)
    if not ideas:
        raise FoodError("ai_failed", "Nothing to suggest for this one.")
    p["info"] = {**info, key: ideas} if info else {key: ideas}
    food._changed("products", [p])
    return ideas


# ── Find a Photo ───────────────────────────────────────────────────────────────
def search_term(food: CrowFood, name: str, pid: str | None = None) -> str:
    """The plain name of the food: from About This Food if it's known, otherwise the name without shops and sizes."""
    if pid and pid in food.data["products"]:
        g = (food.data["products"][pid].get("info") or {}).get("generic")
        if g:
            return g
    from .ai import _NOISE

    words = [w for w in re.findall(r"[A-Za-z][A-Za-z'’-]*", str(name)) if w.lower() not in _NOISE and len(w) > 1]
    return " ".join(words[:5])


# a Wikipedia page is only used when it's about a food, not a brand, a company, a restaurant or a person
_NOT_FOOD = re.compile(r"\b(company|corporation|brand|manufacturer|subsidiary|conglomerate|restaurant|chain|retailer|"
                       r"supermarket|business|brewery|person|actor|singer|band|album|song|film|television|series|video game|"
                       r"town|village|city|county|river|football|club|politician|footballer|magazine|newspaper|website|"
                       r"software|car|ship|aircraft|novel|character|mascot|logo)\b", re.I)
_FOOD = re.compile(r"\b(food|dish|sauce|soup|cheese|meat|bread|cake|biscuit|cookie|confection|chocolate|sweet|candy|"
                   r"beverage|drink|juice|water|milk|cream|butter|spread|vegetable|fruit|snack|crisp|ingredient|condiment|"
                   r"dessert|pudding|cereal|pasta|noodle|rice|spice|herb|seasoning|stock|broth|sausage|bacon|ham|fish|"
                   r"seafood|pie|pastry|egg|yogurt|yoghurt|lager|beer|wine|tea|coffee|salt|sugar|flour|oil|jam|marmalade|"
                   r"potato|onion|tomato|bean|pea|corn|nut|meal|mayonnaise|ketchup|custard|crackers?)\b", re.I)
_BAD_FILE = re.compile(r"logo|\.svg|wordmark|building|factory|headquarter|\bhq\b|store|shop|sign|office|plant|portrait|map|"
                       r"wagon|railway|train|locomotive|lorry|truck|\bvan\b|\bbus\b|museum|street|station|advert|poster|"
                       r"warehouse|works\b|mill\b|mine\b|ship|boat|livery|exhibition", re.I)


def _overlap(a: str, b: str) -> float:
    from .ai import _words

    wa, wb = _words(a), _words(b)
    return len(wa & wb) / max(1, len(wa)) if wa else 0.0


def _size_of(text: str) -> set[str]:
    out = set()
    for num, unit in re.findall(r"(\d+(?:[.,]\d+)?)\s?(kg|g|ml|cl|l|ltr|litre)\b", str(text).lower()):
        n = float(num.replace(",", "."))
        unit = {"ltr": "l", "litre": "l"}.get(unit, unit)
        if unit == "kg":
            n, unit = n * 1000, "g"
        elif unit == "l":
            n, unit = n * 1000, "ml"
        elif unit == "cl":
            n, unit = n * 10, "ml"
        out.add(f"{n:g}{unit}")
    return out


_SIZE_WORDS = re.compile(
    r"\b\d+(?:[.,]\d+)?\s?(?:x|×)\s?\d+(?:[.,]\d+)?\s?(?:kg|g|gr|ml|cl|ltr|litres?|liters?|l)?\b"      # 4 x 28g, 6 x 1 litre
    r"|\b\d+\s+(?:long|large|mega|big|super)\s+(?:rolls?|sheets?)\b"                    # 16 long rolls
    r"|\b(?:x|×)\s?\d+\b"                                                                 # x14
    r"|\b\d+(?:[.,]\d+)?\s?(?:kg|g|gr|grams?|ml|cl|l|ltr|litres?|liters?|oz|lb|pk|packs?|pcs|pieces|rolls?|sheets?|bags?|tins?|cans?|bottles?)\b"
    r"|\bmulti-?pack\b|\bfamily pack\b|\bbig pack\b|\bvalue pack\b"
    r"|\(\s*[A-Za-z]{0,2}\s*\)|\b\d+\b(?=\s*$)", re.I)


def without_sizes(name: str) -> str:
    """The name without its pack size and counts ("Saxa Salt 750G" -> "Saxa Salt", "Knorr Stock Pot 4 x 28g" -> "Knorr Stock Pot")."""
    t = _SIZE_WORDS.sub(" ", str(name or ""))
    t = re.sub(r"\(\s*[A-Za-z]{0,2}\s*$", "", t)        # "(L" left at the end
    return re.sub(r"\s+", " ", re.sub(r"[()\[\],/]+\s*$", "", t)).strip(" -,/(")


OFF_FIELDS = "code,product_name,product_name_en,brands,quantity,image_front_url,image_url,image_front_small_url"


async def _off_new_search(session, q: str, uk: bool, limit: int) -> list[dict]:
    """Search-a-licious, Open Food Facts' newer search (its index can be behind the website's)."""
    query = f'{q} countries_tags:"en:united-kingdom"' if uk else q
    data = await get_json(session, "off_search", "https://search.openfoodfacts.org/search",
                          {"q": query, "langs": "en", "page_size": str(limit), "fields": OFF_FIELDS})
    return (data or {}).get("hits") or []


async def _off_old_search(session, q: str, uk: bool, limit: int) -> list[dict]:
    """The website's own search (older, and often busy)."""
    params = {"search_terms": q, "search_simple": "1", "action": "process", "json": "1", "page_size": str(limit), "fields": OFF_FIELDS}
    if uk:
        params.update({"tagtype_0": "countries", "tag_contains_0": "contains", "tag_0": "united-kingdom"})
    data = await get_json(session, "off_old", "https://world.openfoodfacts.org/cgi/search.pl", params)
    return (data or {}).get("products") or []


async def _off_front(session, code: str) -> dict:
    """The packet photo for a barcode (when a search didn't give one): the barcode lookup is the reliable one."""
    try:
        data = await get_json(session, "off_barcode", f"https://world.openfoodfacts.org/api/v2/product/{code}.json",
                              {"fields": "image_front_url,image_url,image_front_small_url"}, tries=1, timeout=10)
    except ServiceError:
        return {}
    return (data or {}).get("product") or {}


async def _off_search(session, food: CrowFood, name: str, limit: int = 12) -> list[dict]:
    """Open Food Facts products like this one, best first: UK products first, then anywhere. Each scored on how
    much of the name (brand and product) it shares, with the pack size counting for or against. Asks the newer
    search first, and the older one only when that fails or finds nothing that's clearly the product."""
    if not food.settings.get("openfoodfacts", True):
        return []
    want_size = _size_of(name)
    seen, out = set(), []
    # Open Food Facts wants every word to match, so a size written differently ("750G" against "750 g") or not at
    # all finds nothing: search with the size and without it, UK products first
    plain = without_sizes(name)
    queries = [(name, True)] + ([(plain, True)] if plain and plain.lower() != str(name).lower() else []) + [(plain or name, False)]

    def take(prods: list[dict], uk: bool) -> None:
        for prod in prods:
            code = prod.get("code") or prod.get("image_front_url") or prod.get("image_url")
            if not code or code in seen:
                continue
            seen.add(code)
            brands = prod.get("brands") or ""
            brand = str(brands[0] if isinstance(brands, list) and brands else brands if isinstance(brands, str) else "").split(",")[0].strip()
            name_of = prod.get("product_name_en") or prod.get("product_name") or ""
            if isinstance(name_of, dict):   # the newer search can give the name in each language
                name_of = name_of.get("en") or name_of.get("main") or next(iter(name_of.values()), "")
            title = " ".join(str(x) for x in (brand, name_of, prod.get("quantity") or "") if x)
            score = _overlap(name, title)
            have = _size_of(title)
            if want_size and have:
                score += 0.15 if want_size & have else -0.1
            if uk:
                score += 0.05
            src = prod.get("image_front_url") or prod.get("image_url")
            out.append({"source": "off", "title": title, "url": src, "thumb": prod.get("image_front_small_url") or src,
                        "score": round(score, 3), "code": prod.get("code")})

    def good() -> bool:
        return bool(out) and max(c["score"] for c in out) >= 0.8

    for search, service in ((_off_new_search, "off_search"), (_off_old_search, "off_old")):
        if resting(service):
            continue
        for q, uk in queries:
            try:
                take(await search(session, q, uk, limit), uk)
            except ServiceError as err:
                _LOGGER.debug("Crow Food: Open Food Facts search (%s) for %s failed: %s", service, q, err)
                break   # it's busy: don't ask it again for the other spellings
            if good():
                break   # a UK product that's clearly the one: no need to look further
        if good():
            break
    out.sort(key=lambda c: -c["score"])
    # the newer search may not give the photo's address: ask the barcode lookup for the best few
    need = [c for c in out[:6] if not c["url"] and c.get("code")]
    if need:
        fronts = await asyncio.gather(*(_off_front(session, c["code"]) for c in need))
        for c, f in zip(need, fronts):
            c["url"] = f.get("image_front_url") or f.get("image_url")
            c["thumb"] = f.get("image_front_small_url") or c["url"]
    return [c for c in out if c["url"]]


async def _off_photo(session, food: CrowFood, name: str) -> tuple[bytes, str] | None:
    """A packet photo from Open Food Facts for a product of (nearly) the same name."""
    found = await _off_search(session, food, name, 8)
    best = found[0] if found else None
    # most of the name's telling words in the product's name and brand: the same product, near enough
    if not best or best["score"] < 0.6:
        return None
    async with asyncio.timeout(15):
        img = await session.get(best["url"], headers={"User-Agent": USER_AGENT})
        if img.status != 200:
            return None
        return await img.read(), best["title"]   # read() waits for the whole picture


async def _wiki_photo(session, term: str) -> tuple[bytes, str] | None:
    """A picture of the food itself from Wikipedia: the first of a few results that's about a food."""
    params = {"action": "query", "generator": "search", "gsrsearch": term, "gsrlimit": "5", "gsrnamespace": "0",
              "prop": "pageimages|description", "piprop": "thumbnail|name", "pithumbsize": "800", "format": "json"}
    headers = {"User-Agent": USER_AGENT}
    async with asyncio.timeout(15):
        r = await session.get("https://en.wikipedia.org/w/api.php", params=params, headers=headers)
        data = await r.json(content_type=None)
    pages = sorted(((data or {}).get("query", {}).get("pages") or {}).values(), key=lambda p: p.get("index", 99))
    for page in pages:
        src = (page.get("thumbnail") or {}).get("source")
        desc = str(page.get("description") or "")
        title = str(page.get("title") or "")
        if not src or _BAD_FILE.search(str(page.get("pageimage") or "")) or _BAD_FILE.search(src.rsplit("/", 1)[-1]):
            continue
        if _NOT_FOOD.search(desc) or not (_FOOD.search(desc) or _FOOD.search(title)):
            continue
        # the page's title is (mostly) words of the product's name: "Spaghetti" for spaghetti rings, not "McDonald's"
        if _overlap(title, term) < 0.5:
            continue
        async with asyncio.timeout(15):
            img = await session.get(src, headers=headers)
            if img.status == 200:
                return await img.read(), title
    return None


async def _wiki_candidates(session, term: str) -> list[dict]:
    """Wikipedia pages about the food (not brands, companies or restaurants), as photo choices."""
    params = {"action": "query", "generator": "search", "gsrsearch": term, "gsrlimit": "6", "gsrnamespace": "0",
              "prop": "pageimages|description", "piprop": "thumbnail|name", "pithumbsize": "800", "format": "json"}
    if resting("wiki"):
        return []
    try:
        data = await get_json(session, "wiki", "https://en.wikipedia.org/w/api.php", params)
    except ServiceError:
        return []
    out = []
    for page in sorted(((data or {}).get("query", {}).get("pages") or {}).values(), key=lambda p: p.get("index", 99)):
        src = (page.get("thumbnail") or {}).get("source")
        desc, title = str(page.get("description") or ""), str(page.get("title") or "")
        if not src or _BAD_FILE.search(str(page.get("pageimage") or "")) or _BAD_FILE.search(src.rsplit("/", 1)[-1]):
            continue
        if _NOT_FOOD.search(desc) or not (_FOOD.search(desc) or _FOOD.search(title)):
            continue
        out.append({"source": "wiki", "title": title, "url": src, "thumb": src.replace("/800px-", "/300px-")})
    return out


async def _commons_candidates(session, term: str, limit: int = 6) -> list[dict]:
    """Photos from Wikimedia Commons (free to use): pictures, not logos, maps or diagrams."""
    params = {"action": "query", "generator": "search", "gsrsearch": f"filetype:bitmap {term}", "gsrnamespace": "6", "gsrlimit": str(limit * 2),
              "prop": "imageinfo", "iiprop": "url|mime", "iiurlwidth": "800", "format": "json"}
    if resting("commons"):
        return []
    try:
        data = await get_json(session, "commons", "https://commons.wikimedia.org/w/api.php", params)
    except ServiceError:
        return []
    out = []
    for page in sorted(((data or {}).get("query", {}).get("pages") or {}).values(), key=lambda p: p.get("index", 99)):
        info = (page.get("imageinfo") or [{}])[0]
        title = str(page.get("title") or "").removeprefix("File:")
        if not info.get("thumburl") or not str(info.get("mime", "")).startswith("image/") or _BAD_FILE.search(title):
            continue
        out.append({"source": "commons", "title": re.sub(r"\.(jpe?g|png|webp|tiff?)$", "", title, flags=re.I).replace("_", " "),
                    "url": info["thumburl"], "thumb": info["thumburl"].replace("/800px-", "/300px-")})
        if len(out) >= limit:
            break
    return out


async def _openverse_candidates(session, term: str, limit: int = 6) -> list[dict]:
    """Openly licensed photos from Openverse (Flickr and other collections), no key needed."""
    params = {"q": term, "page_size": str(limit), "mature": "false", "extension": "jpg,jpeg,png,webp"}
    if resting("openverse"):
        return []
    try:
        data = await get_json(session, "openverse", "https://api.openverse.org/v1/images/", params)
    except ServiceError:
        return []
    out = []
    for res in (data or {}).get("results") or []:
        url, thumb = res.get("url"), res.get("thumbnail") or res.get("url")
        if url and str(url).startswith("https://") and not _BAD_FILE.search(str(res.get("title") or "")):
            out.append({"source": "openverse", "title": str(res.get("title") or "")[:120], "url": url, "thumb": thumb})
    return out


# photo choices waiting to be picked: the card only ever names one by its id (never a web address)
_CHOICES: dict[str, tuple[float, dict]] = {}
CHOICE_KEEP = 30 * 60


async def async_photo_choices(food: CrowFood, name: str, pid: str | None = None, query: str | None = None) -> dict:
    """Several photos to choose from: the packet (Open Food Facts, UK first), then pictures of the food
    (Wikipedia, Wikimedia Commons, Openverse)."""
    import secrets
    import time

    full = (query or name or "").strip()
    term = (query or "").strip() or search_term(food, name, pid)
    if not full and not term:
        raise FoodError("no_name", "Add the product’s name first.")
    session = async_get_clientsession(food.hass)
    off, wiki, commons, ov = await asyncio.gather(
        _off_search(session, food, full or term, 12), _wiki_candidates(session, term),
        _commons_candidates(session, term), _openverse_candidates(session, term), return_exceptions=True)
    pick: list[dict] = []
    good_off = [c for c in (off if isinstance(off, list) else []) if c["score"] >= 0.35]
    pick += good_off[:6]
    for group in (wiki, commons, ov):
        if isinstance(group, list):
            pick += group[:4]
    now = time.time()
    for k in [k for k, (t, _c) in _CHOICES.items() if now - t > CHOICE_KEEP]:
        _CHOICES.pop(k, None)
    out, seen = [], set()
    for c in pick:
        if c["url"] in seen:
            continue
        seen.add(c["url"])
        cid = secrets.token_hex(8)
        _CHOICES[cid] = (now, c)
        out.append({"id": cid, "source": c["source"], "title": c["title"], "thumb": c["thumb"]})
        if len(out) >= 12:
            break
    if not out and all(isinstance(g, Exception) for g in (off, wiki, commons, ov)):
        raise FoodError("offline", "Couldn’t reach the photo search. Check the internet connection and try again.")
    return {"choices": out, "term": term}


async def async_pick_photo(food: CrowFood, cid: str) -> dict:
    """The photo chosen from the choices, saved into Crow Food."""
    got = _CHOICES.get(cid)
    if not got:
        raise FoodError("expired", "Those photos are out of date. Search again.")
    c = got[1]
    session = async_get_clientsession(food.hass)

    async def fetch(url: str) -> bytes | None:
        """The whole picture (all of it, not just the first piece that arrives), or None if it isn't one."""
        async with asyncio.timeout(30):
            img = await session.get(url, headers={"User-Agent": USER_AGENT})
            if img.status != 200 or not str(img.headers.get("Content-Type", "image/")).startswith("image/"):
                return None
            raw = bytearray()
            async for chunk in img.content.iter_chunked(65536):
                raw += chunk
                if len(raw) > 20 * 1024 * 1024:
                    return None
            return bytes(raw)

    photo = None
    try:
        # the full-size photo, or if that won't do, its smaller copy
        for url in dict.fromkeys((c["url"], c.get("thumb") or c["url"])):
            raw = await fetch(url)
            if not raw:
                continue
            try:
                photo = await food.async_save_photo(raw)
                break
            except FoodError:
                continue
    except Exception as err:  # noqa: BLE001
        raise FoodError("offline", "Couldn’t fetch that photo. Check the internet connection and try again.") from err
    if not photo:
        raise FoodError("no_photo", "That photo couldn’t be saved. Choose another.")
    return {"photo": photo, "photo_url": food.photo_url(photo), "thumb_url": food.photo_url(photo, True), "title": c["title"], "source": c["source"]}


async def async_find_photo(food: CrowFood, name: str, pid: str | None = None) -> dict:
    """A photo for a product: its packet from Open Food Facts when it's there, otherwise a picture of the food
    from Wikipedia (never a brand's logo, a factory or a restaurant)."""
    term = search_term(food, name, pid)
    if not term:
        raise FoodError("no_name", "Add the product’s name first.")
    session = async_get_clientsession(food.hass)
    found, source = None, ""
    try:
        found = await _off_photo(session, food, str(name))
        source = "off" if found else ""
        if not found:
            found = await _wiki_photo(session, term)
            source = "wiki" if found else ""
        # a brand's own page can win the search: try again with just the kind of food (the last few words)
        if not found and len(term.split()) > 2:
            found = await _wiki_photo(session, " ".join(term.split()[-3:]))
            source = "wiki" if found else ""
    except Exception as err:  # noqa: BLE001 - offline, slow
        _LOGGER.debug("Crow Food: photo search for %s failed: %s", term, err)
        raise FoodError("offline", "Couldn’t reach the photo search. Check the internet connection and try again.") from err
    if not found:
        raise FoodError("no_photo", f"Couldn’t find a photo of {term}.")
    photo = await food.async_save_photo(found[0])
    return {"photo": photo, "photo_url": food.photo_url(photo), "thumb_url": food.photo_url(photo, True),
            "term": term, "title": found[1], "source": source}


async def async_auto_photo(food: CrowFood, pid: str) -> None:
    """A new product without a photo gets one in the background (when Find Photos is on)."""
    p = food.data["products"].get(pid)
    if not p or p.get("photo") or not food.settings.get("photo_finder", True):
        return
    try:
        found = await async_find_photo(food, p.get("name", ""), pid)
    except FoodError:
        return
    p = food.data["products"].get(pid)
    if p and not p.get("photo"):
        p["photo"] = found["photo"]
        p["photo_auto"] = found.get("source") or True
        food._changed("products", [p])


async def async_recheck_auto_photos(food: CrowFood) -> int:
    """Once, after this update: photos found automatically by the old search (which could pick a brand's logo or
    a factory) are looked for again with the new one; any that can't be found again are taken off."""
    if food.data.get("auto_photos_v2"):
        return 0
    redo = [p["id"] for p in food.data["products"].values() if p.get("photo_auto") is True and p.get("photo")]
    n = 0
    for pid in redo:
        p = food.data["products"].get(pid)
        if not p or p.get("photo_auto") is not True:
            continue
        old = p.get("photo")
        try:
            found = await async_find_photo(food, p.get("name", ""), pid)
        except FoodError as err:
            if err.code == "offline":
                return n     # try again next start
            found = None
        p = food.data["products"].get(pid)
        if not p or p.get("photo") != old:
            continue          # changed by someone meanwhile
        p["photo"] = found["photo"] if found else None
        p["photo_auto"] = (found.get("source") or True) if found else False
        food._changed("products", [p])
        n += 1
        await asyncio.sleep(1.5)   # gently: these are free services
    food.data["auto_photos_v2"] = True
    food._save()
    return n
