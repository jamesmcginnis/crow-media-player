"""Open Food Facts: what a barcode is, when Crow Food doesn't know it yet.

Home Assistant asks Open Food Facts itself (not the card), so phones never have to reach it and the
product photo is saved straight into Crow Food. Answers are remembered for a week.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time

from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .store import CrowFood

_LOGGER = logging.getLogger(__name__)
URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
FIELDS = "product_name,product_name_en,generic_name,brands,quantity,product_quantity,product_quantity_unit,categories_tags,image_front_url,image_url,nutriments,serving_size"
KEEP = 7 * 86400
_cache: dict[str, tuple[float, dict | None]] = {}

# Open Food Facts category → one of the household's categories (by words in its name)
CATEGORY_WORDS = (
    ("dairies", "Dairy"), ("milks", "Dairy"), ("cheeses", "Dairy"), ("yogurts", "Dairy"), ("butters", "Dairy"),
    ("breads", "Bakery"), ("bakery", "Bakery"), ("biscuits", "Snacks"), ("snacks", "Snacks"), ("sweets", "Snacks"),
    ("chocolates", "Snacks"), ("crisps", "Snacks"), ("beverages", "Beverages"), ("drinks", "Beverages"),
    ("waters", "Beverages"), ("juices", "Beverages"), ("meats", "Meat"), ("sausages", "Meat"), ("hams", "Meat"),
    ("fishes", "Fish"), ("seafood", "Fish"), ("eggs", "Eggs"), ("fruits", "Fruit"), ("vegetables", "Vegetables"),
    ("pastas", "Pasta"), ("noodles", "Noodles"), ("rices", "Rice"), ("sauces", "Sauce"), ("condiments", "Sauce"),
    ("soups", "Soup"), ("spices", "Spices"), ("frozen", "Frozen"), ("meals", "Ready Meals"), ("pizzas", "Ready Meals"),
    ("cereals", "Cereal"), ("pet-food", "Pet"), ("dog", "Dog"), ("cat", "Cat"),
)
UNIT_MAP = {"g": "g", "gr": "g", "gram": "g", "grams": "g", "kg": "kg", "ml": "ml", "cl": "cl", "l": "l", "ltr": "l", "litre": "l", "liter": "l"}


def _category(food: CrowFood, tags: list[str]) -> str | None:
    cats = {c["name"].lower(): c["id"] for c in food.data["categories"].values()}
    for tag in reversed(tags or []):
        tag = tag.split(":", 1)[-1]
        for word, name in CATEGORY_WORDS:
            if word in tag:
                for cname, cid in cats.items():
                    if name.lower() in cname or cname in name.lower():
                        return cid
    return None


def _size(p: dict) -> tuple[float, str]:
    try:
        qty = float(p.get("product_quantity") or 0)
    except (TypeError, ValueError):
        qty = 0
    unit = UNIT_MAP.get(str(p.get("product_quantity_unit") or "").lower(), "")
    if qty and unit:
        if unit == "cl":
            return qty * 10, "ml"
        return qty, unit
    m = re.search(r"([\d.,]+)\s*(kg|g|gr|ml|cl|l|ltr)\b", str(p.get("quantity") or ""), re.I)
    if m:
        n = float(m.group(1).replace(",", "."))
        u = UNIT_MAP.get(m.group(2).lower(), "")
        return (n * 10, "ml") if u == "cl" else (n, u)
    m = re.search(r"(\d+)\s*(x|pack|pieces|pcs|slices)", str(p.get("quantity") or ""), re.I)
    if m:
        return float(m.group(1)), "slice" if "slice" in m.group(2).lower() else "piece"
    return 0.0, ""


async def async_lookup(food: CrowFood, code: str) -> dict | None:
    code = re.sub(r"\D", "", code or "")
    if not code:
        return None
    hit = _cache.get(code)
    if hit and time.time() - hit[0] < KEEP:
        return dict(hit[1]) if hit[1] else None
    session = async_get_clientsession(food.hass)
    try:
        async with asyncio.timeout(12):
            resp = await session.get(URL.format(code=code), params={"fields": FIELDS},
                                     headers={"User-Agent": "CrowFood/0.0.2 (Home Assistant integration)"})
            if resp.status == 404:
                _cache[code] = (time.time(), None)
                return None
            data = await resp.json(content_type=None)
    except Exception as err:  # noqa: BLE001 - offline, slow, odd answer
        _LOGGER.debug("Open Food Facts lookup for %s failed: %s", code, err)
        return None
    p = (data or {}).get("product") if (data or {}).get("status") in (1, "success_with_warnings", "success") or data.get("product") else None
    if not p:
        _cache[code] = (time.time(), None)
        return None
    name = (p.get("product_name") or p.get("product_name_en") or p.get("generic_name") or "").strip()
    brand = (p.get("brands") or "").split(",")[0].strip()
    if brand and name and brand.lower() not in name.lower():
        name = f"{brand} {name}"
    if not name:
        _cache[code] = (time.time(), None)
        return None
    content, content_unit = _size(p)
    if p.get("quantity") and content and str(int(content)) not in name:
        name = f"{name} {p['quantity']}".strip()
    photo = None
    img = p.get("image_front_url") or p.get("image_url")
    if img:
        try:
            async with asyncio.timeout(15):
                r = await session.get(img)
                if r.status == 200:
                    photo = await food.async_save_photo(await r.read())
        except Exception:  # noqa: BLE001
            photo = None
    nut = p.get("nutriments") or {}
    nutrition = {k: nut.get(f"{k}_100g") for k in ("energy-kcal", "fat", "saturated-fat", "carbohydrates", "sugars", "proteins", "salt")
                 if nut.get(f"{k}_100g") is not None} or None
    out = {"name": name[:160], "barcode": code, "category": _category(food, p.get("categories_tags") or []),
           "photo": photo, "photo_url": food.photo_url(photo), "thumb_url": food.photo_url(photo, True),
           "unit": "package", "content": content, "content_unit": content_unit, "source": "openfoodfacts", "nutrition": nutrition}
    _cache[code] = (time.time(), {k: v for k, v in out.items() if k not in ("photo", "photo_url", "thumb_url")})
    return out
