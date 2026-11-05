"""AI features for Crow Food, done by an AI Task entity set up in Home Assistant.

AI Tasks have no access to your devices, so nothing in the house can be switched on or off by them.
Nothing is sent to an AI unless an administrator has turned AI Features on and someone uses a feature.

Features:
* expiry     - estimates a best-before date for something without one (from its name, category and storage)
* categorise - suggests a category for a product
* photo      - Photo to Product: reads the name, size and best-before date from a photo of the packet
* barcode    - reads a barcode's number from a photo when the card couldn't (for phones without live scanning)
* use_up     - a short "use these first" summary of what's open or expiring
* shopping   - suggests things to add to a shopping list from what usually gets bought and what's low
* ask        - answers questions about what's in the house ("do we have tuna?")
* info       - About This Food (in info.py): storage, how long it keeps, a typical serving, dietary notes, ideas
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date, timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from . import assist
from .const import DOMAIN, KIND_LIST, KIND_STORAGE
from .store import CrowFood, FoodError

_LOGGER = logging.getLogger(__name__)

TIMEOUT = 90
ASK_TIMEOUT = 75   # Ask AI gives up before the card does (100 seconds), so the card shows why
FEATURES = ("expiry", "categorise", "photo", "barcode", "use_up", "shopping", "ask", "info", "recap", "catchup", "receipt", "voice")
NEEDS_PHOTOS = ("photo", "barcode")

FRIENDLY = {
    "busy": "The AI is busy or has reached its usage limit right now. Try again in a little while.",
    "auth": "The AI service isn’t signed in properly. Whoever looks after Home Assistant can check the AI integration’s settings.",
    "offline": "Couldn’t reach the AI service. Check the internet connection and try again.",
    "slow": "The AI is taking too long to answer. Try again in a moment.",
    "refused": "The AI wouldn’t help with that one.",
    "no_photos": "This AI can’t look at photos. An administrator can choose one that can in the card’s AI settings.",
    "garbled": "The AI’s answer came back in a muddle. Try again.",
    "too_long": "The AI’s answer was too long for it. Crow Food will read it in smaller parts.",
    "not_set_up": "AI Features aren’t set up yet. An administrator can turn them on in the card’s AI settings.",
    "off": "That AI feature is switched off. An administrator can switch it on in the card’s AI settings.",
    "other": "The AI couldn’t do that just now. Try again in a moment.",
}
_PATTERNS = (
    ("busy", r"quota|rate.?limit|too many requests|\b429\b|overloaded|capacity|resource.?exhausted|\b503\b"),
    ("auth", r"api.?key|unauthori[sz]ed|authenticat|\b401\b|\b403\b|permission|forbidden"),
    ("offline", r"connect|network|unreachable|resolve|dns|offline|ssl|certificate"),
    ("slow", r"timeout|timed out|deadline"),
    ("refused", r"safety|blocked|content.?polic|refus|moderation"),
    ("no_photos", r"attachment|image|vision|multimodal|mime"),
    ("too_long", r"max.?tokens|max_output|truncat|too long|context.?window|token limit|length limit|finish.?reason"),
)


def friendly(err: BaseException | str | None) -> str:
    if isinstance(err, TimeoutError):
        return FRIENDLY["slow"]
    text = str(err or "").lower()
    for key, pattern in _PATTERNS:
        if re.search(pattern, text):
            return FRIENDLY[key]
    # something else: say what the AI service said, so it can be looked into
    said = re.sub(r"\s+", " ", str(err or "")).strip()
    return FRIENDLY["other"] + (f" (It said: {said[:160]}{'…' if len(said) > 160 else ''})" if said else "")


def task_entities(hass: HomeAssistant) -> list[dict]:
    out = []
    for st in hass.states.async_all("ai_task"):
        feats = int(st.attributes.get("supported_features") or 0)
        out.append({"entity_id": st.entity_id, "name": st.attributes.get("friendly_name") or st.entity_id,
                    "photos": bool(feats & 2)})
    return out


def task_entity(hass: HomeAssistant, food: CrowFood) -> str | None:
    chosen = (food.settings.get("ai", {}).get("task_entity") or "").strip()
    if chosen:
        return chosen if hass.states.get(chosen) else None
    try:
        from homeassistant.components.ai_task.const import DATA_PREFERENCES

        prefs = hass.data.get(DATA_PREFERENCES)
        return getattr(prefs, "gen_data_entity_id", None)
    except Exception:  # noqa: BLE001 - AI Task isn't set up
        return None


def supports_photos(hass: HomeAssistant, entity_id: str | None) -> bool:
    st = hass.states.get(entity_id) if entity_id else None
    return bool(int((st.attributes.get("supported_features") if st else 0) or 0) & 2)


# the steps of reading a receipt, switched on and off with it
STEPS = {"transcribe": "receipt", "receipt_lines": "receipt", "receipt_match": "receipt"}


def feature_on(food: CrowFood, feature: str) -> bool:
    ai = food.settings.get("ai", {}) or {}
    feature = STEPS.get(feature, feature)
    return bool(ai.get("enabled")) and (ai.get("features", {}) or {}).get(feature) is not False


def capabilities(hass: HomeAssistant, food: CrowFood) -> dict:
    ent = task_entity(hass, food)
    out = {}
    for f in FEATURES:
        on = feature_on(food, f) and bool(ent)
        if f in NEEDS_PHOTOS:
            on = on and supports_photos(hass, ent)
        out[f] = on
    return out


def tools_supported() -> bool:
    """AI Tasks can use tools (an LLM API) from Home Assistant 2025.x on."""
    try:
        import inspect
        from homeassistant.components.ai_task import async_generate_data
        return "llm_api" in inspect.signature(async_generate_data).parameters
    except Exception:  # noqa: BLE001
        return False


async def _task(hass: HomeAssistant, food: CrowFood, name: str, instructions: str, attachments: list | None = None,
                timeout: int = TIMEOUT, llm_api: Any = None) -> str:
    ent = task_entity(hass, food)
    if not ent:
        raise FoodError("ai_unavailable", FRIENDLY["not_set_up"])
    try:
        from homeassistant.components.ai_task import async_generate_data
    except ImportError as err:
        raise FoodError("ai_unavailable", FRIENDLY["not_set_up"]) from err
    try:
        async with asyncio.timeout(timeout):
            extra = {"llm_api": llm_api} if llm_api is not None else {}
            result = await async_generate_data(hass, task_name=name, entity_id=ent, instructions=instructions,
                                               attachments=attachments, **extra)
    except TimeoutError as err:
        raise FoodError("ai_failed", FRIENDLY["slow"]) from err
    except FoodError:
        raise
    except Exception as err:  # noqa: BLE001 - providers raise all sorts
        _LOGGER.warning("Crow Food AI task %s failed: %s", name, err)
        raise FoodError("ai_failed", friendly(err)) from err
    data = result.data
    return data if isinstance(data, str) else json.dumps(data)


# words that say little about what a product is (shops, brands that sell everything, sizes)
_NOISE = {"tesco", "asda", "aldi", "lidl", "iceland", "sainsbury", "sainsburys", "morrisons", "waitrose", "coop", "co",
          "op", "ocado", "finest", "everyday", "essentials", "value", "best", "the", "and", "with", "for", "in", "of",
          "pack", "pk", "x", "g", "kg", "ml", "l", "cl", "mg", "oz", "lb", "multipack", "large", "small", "medium",
          "mini", "extra", "new", "free", "from", "british", "classic", "original", "family", "frozen", "fresh"}


def _words(name: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z]+", str(name).lower().replace("’", "'")):
        if len(w) < 3 or w in _NOISE:
            continue
        # chips/chip, fries/fry: one form
        if w.endswith("ies") and len(w) > 4:
            w = w[:-3] + "y"
        elif w.endswith("es") and len(w) > 4 and w[-3] in "sxz":
            w = w[:-2]
        elif w.endswith("s") and not w.endswith("ss") and len(w) > 3:
            w = w[:-1]
        out.add(w)
    return out


def similar_products(food: CrowFood, name: str, exclude: str | None = None) -> list[tuple[float, dict]]:
    """The household's products whose names share telling words with this one (rarer words count for more)."""
    import math

    want = _words(name)
    if not want:
        return []
    prods = [p for p in food.data["products"].values() if p.get("category") and p.get("id") != exclude]
    df: dict[str, int] = {}
    words = {}
    for p in prods:
        ws = _words(p.get("name", ""))
        words[p["id"]] = ws
        for w in ws:
            df[w] = df.get(w, 0) + 1
    n = max(1, len(prods))
    out = []
    for p in prods:
        shared = want & words[p["id"]]
        if shared:
            score = sum(math.log(1 + n / df[w]) for w in shared)
            out.append((round(score, 3), p))
    out.sort(key=lambda x: -x[0])
    return out


def _json(text: str) -> Any:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip(), flags=re.S).strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    for a_, b_ in (("{", "}"), ("[", "]")):
        a, b = text.find(a_), text.rfind(b_)
        if a != -1 and b > a:
            try:
                return json.loads(text[a:b + 1])
            except ValueError:
                continue
    raise FoodError("ai_failed", FRIENDLY["garbled"])


def gtin_ok(code: str) -> bool:
    """A barcode number whose last digit checks out (EAN-8, UPC-A, EAN-13, GTIN-14)."""
    if not re.fullmatch(r"\d{8}|\d{12,14}", code or ""):
        return False
    digits = [int(c) for c in code]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(digits[:-1])))
    return (10 - total % 10) % 10 == digits[-1]


def _clean(text: str) -> str:
    return re.sub(r"^```\w*\s*|\s*```$", "", (text or "").strip(), flags=re.S).strip()


def _inventory_lines(food: CrowFood, uid: str, limit: int = 250) -> list[str]:
    storages = food.visible_storages(uid)
    cats = food.data["categories"]
    lines = []
    for it in sorted(food.data["items"].values(), key=lambda i: i.get("expires") or "9999"):
        st = storages.get(it.get("storage"))
        if not st or st.get("kind") != KIND_STORAGE:
            continue
        p = food.data["products"].get(it["product"]) or {}
        bits = [f"{p.get('name', '?')}", f"{it['qty']:g} {it.get('unit') or 'package'}", f"in {st['name']}"]
        if it.get("expires"):
            bits.append(f"best before {it['expires']}")
        if it.get("opened"):
            bits.append(f"opened {it['opened']}")
        if p.get("category") in cats:
            bits.append(f"category {cats[p['category']]['name']}")
        lines.append(" · ".join(bits))
        if len(lines) >= limit:
            break
    return lines


# how long answers are kept (None: for as long as the same photo exists)
DAY = 86400000
KEEP = {"expiry": 30 * DAY, "categorise": 90 * DAY, "use_up": 6 * 3600000, "shopping": 12 * 3600000,
        "ask": 30 * 60000, "photo": None, "barcode": None, "recap": 7 * DAY, "catchup": DAY, "receipt": 7 * DAY,
        "voice": DAY, "transcribe": None, "receipt_lines": 7 * DAY, "receipt_match": 7 * DAY}


def _fp(*parts: Any) -> str:
    import hashlib

    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:16]


def _stock_fp(food: CrowFood) -> list:
    """What's in the house right now (a kept answer about it is only good while this stays the same)."""
    return sorted((i.get("product"), i.get("storage"), round(float(i.get("qty") or 0), 3), i.get("expires"), i.get("opened"),
                   bool(i.get("bought"))) for i in food.data["items"].values())


def _cache_key(food: CrowFood, user, feature: str, data: dict) -> tuple[str, str] | None:
    """(key, fingerprint) for a question that can be answered from memory, or None."""
    low = lambda k: str(data.get(k) or "").strip().lower()  # noqa: E731
    if feature == "expiry":
        return f"expiry|{low('name')}|{low('storage')}|{low('category')}|{bool(data.get('opened'))}", ""
    if feature == "categorise":
        cats = sorted(c["name"] for c in food.data["categories"].values())
        return f"categorise|{low('name')}", _fp(cats)
    if feature in ("photo", "barcode"):
        meta = food.data.get("photos", {}).get(str(data.get("photo") or "")) or {}
        return (f"{feature}|{meta['hash']}", "") if meta.get("hash") else None
    if feature == "use_up":
        return f"use_up|{getattr(user, 'id', '')}", _fp(_stock_fp(food), dt_util.now().date().isoformat())
    if feature == "shopping":
        return f"shopping|{getattr(user, 'id', '')}|{data.get('list_id')}", _fp(_stock_fp(food))
    if feature == "recap":
        # kept until anything new happens (a new history entry), up to a week
        logs = food.data.get("logs") or []
        return f"recap|{getattr(user, 'id', '')}|{low('month')}", _fp(len(logs), logs[-1].get("id") if logs else "")
    if feature == "catchup":
        # kept until something new happens that's worth telling (by anyone else), or the day changes
        uid = getattr(user, "id", "")
        others = [l for l in food.data.get("logs") or [] if l.get("user") and l.get("user") != uid]
        return f"catchup|{uid}", _fp(others[-1].get("id") if others else "", _stock_fp(food), dt_util.now().date().isoformat())
    if feature == "receipt":
        if str(data.get("text") or "").strip():
            return f"receipt|t|{_fp(str(data['text']).strip())}", _fp(len(food.data["products"]))
        hashes = [(food.data.get("photos", {}).get(str(p)) or {}).get("hash") for p in data.get("photos") or []]
        return (f"receipt|{'|'.join(hashes)}", _fp(len(food.data["products"]))) if hashes and all(hashes) else None
    if feature == "transcribe":
        meta = food.data.get("photos", {}).get(str(data.get("photo") or "")) or {}
        return (f"transcribe|{meta['hash']}", "") if meta.get("hash") else None
    if feature == "receipt_lines":
        return f"receipt_lines|{_fp(str(data.get('text') or ''))}", ""
    if feature == "receipt_match":
        return f"receipt_match|{_fp(data.get('lines'))}", _fp(len(food.data["products"]), len(food.data["storages"]), len(food.data["categories"]))
    if feature == "voice":
        return f"voice|{getattr(user, 'id', '')}|{low('text')}", _fp(len(food.data["products"]))
    if feature == "ask":
        return f"ask|{getattr(user, 'id', '')}|{low('question')}", _fp(_stock_fp(food), dt_util.now().date().isoformat())
    return None


async def async_run(hass: HomeAssistant, food: CrowFood, user, feature: str, data: dict) -> dict:
    """Answers from memory when the same thing was asked recently, otherwise asks the AI (and remembers)."""
    if feature not in FEATURES and feature not in STEPS:
        raise FoodError("bad", "Unknown AI feature.")
    if not feature_on(food, feature):
        if feature == "ask":
            # with the AI off, questions like "do we have tuna?" are still answered from what's at home
            quick = assist.quick_answer(food, user.id, str(data.get("question") or "").strip()[:500])
            if quick:
                return {"text": quick, "local": True}
            raise FoodError("ai_off", "Crow Food can answer “Do we have tuna?”, “What’s going off?” and the like. "
                                      "For anything else, turn on Ask AI.")
        raise FoodError("ai_off", FRIENDLY["off"] if (food.settings.get("ai") or {}).get("enabled") else FRIENDLY["not_set_up"])
    ck = _cache_key(food, user, feature, data) if feature in KEEP else None
    if ck and not data.get("refresh"):
        hit = food.ai_cache_get(ck[0], KEEP[feature], ck[1])
        if hit:
            out = dict(hit["v"])
            if feature == "expiry" and "days" in out:   # the date moves on with today
                out["expires"] = (dt_util.now().date() + timedelta(days=int(out["days"]))).isoformat()
            if feature in ("receipt", "voice"):   # the dates move on with today too
                out["items"] = [{**r, "expires": (dt_util.now().date() + timedelta(days=int(r["days"]))).isoformat() if r.get("days") else None}
                                for r in out.get("items") or []]
            if feature == "categorise" and out.get("category") not in food.data["categories"]:
                out = None
            if out is not None:
                out["cached_ts"] = hit["ts"]
                return out
    # The AI runs on its own: if the phone drops the connection (the app sleeps), it still finishes and is
    # remembered, so asking again gets the answer straight away. Asking again while it's still working waits
    # for the same answer rather than starting another.
    jobs = getattr(food, "_ai_jobs", None)
    if jobs is None:
        jobs = food._ai_jobs = {}
    job_key = ck[0] if ck else None
    job = jobs.get(job_key) if job_key and not data.get("refresh") else None
    if job is None:
        job = hass.async_create_background_task(_run_and_remember(hass, food, user, feature, data, ck), f"crow_food ai {feature}")
        if job_key:
            jobs[job_key] = job
        job.add_done_callback(lambda t, k=job_key: _job_done(jobs, k, t))
    return dict(await asyncio.shield(job))


def _job_done(jobs: dict, key: str | None, task: asyncio.Task) -> None:
    if key and jobs.get(key) is task:
        jobs.pop(key, None)
    if not task.cancelled():
        task.exception()   # seen, so a failure nobody waited for isn't reported as unhandled


async def _run_and_remember(hass: HomeAssistant, food: CrowFood, user, feature: str, data: dict, ck) -> dict:
    out = await _run(hass, food, user, feature, data)
    remember = ck and not out.pop("_local", False) and not (feature == "categorise" and not out.get("category"))
    out["cached_ts"] = food.ai_cache_put(ck[0], out, ck[1]) if remember else None
    if remember:
        food.ai_cache[ck[0]]["v"] = {k: v for k, v in out.items() if k != "cached_ts"}
    return out


async def _run(hass: HomeAssistant, food: CrowFood, user, feature: str, data: dict) -> dict:
    today = dt_util.now().date()
    lang = hass.config.language or "en"
    country = hass.config.country or ""

    if feature == "expiry":
        name = str(data.get("name") or "")[:160]
        storage = str(data.get("storage") or "")[:60]
        category = str(data.get("category") or "")[:60]
        opened = bool(data.get("opened"))
        info = (food.data["products"].get(data.get("product_id") or "") or {}).get("info") or {}
        keeps = "; ".join(f"{k}: {info[v]}" for k, v in (("unopened", "keeps_unopened"), ("once opened", "keeps_opened"),
                                                         ("frozen", "keeps_frozen")) if info.get(v))
        text = await _task(hass, food, "Crow Food: estimate best-before", (
            f"Today is {today.isoformat()}. Estimate a sensible use-by or best-before date for this food, as a typical "
            f"household would keep it.\nFood: {name}\nCategory: {category or 'unknown'}\nKept in: {storage or 'unknown'}\n"
            + (f"How long it usually keeps: {keeps}\n" if keeps else "")
            + f"{'It has been opened today.' if opened else 'It is unopened and was bought today.'}\n"
            + CAREFUL
            + 'Answer with JSON only: {"days": <whole number of days from today>, "reason": "<one short sentence>"}'))
        out = _json(text)
        try:
            days = max(0, min(3650, int(out.get("days"))))
        except (TypeError, ValueError, AttributeError) as err:
            raise FoodError("ai_failed", FRIENDLY["garbled"]) from err
        return {"expires": (today + timedelta(days=days)).isoformat(), "days": days, "reason": str(out.get("reason") or "")[:200]}

    if feature == "categorise":
        name = str(data.get("name") or "")[:160]
        if not name.strip():
            raise FoodError("no_name", "Add the product’s name first.")
        categories = food.data["categories"]
        # 1. the household's own products: something very like this one already has a category
        similar = similar_products(food, name, exclude=data.get("product_id"))
        votes: dict[str, float] = {}
        count: dict[str, int] = {}
        for score, prod in similar[:6]:
            votes[prod["category"]] = votes.get(prod["category"], 0) + score
            count[prod["category"]] = count.get(prod["category"], 0) + 1
        if votes:
            best = max(votes, key=votes.get)
            share = votes[best] / sum(votes.values())
            top = next(prod for _s, prod in similar if prod["category"] == best)
            # sure enough: most of the near matches agree, and it's more than one stray word in common
            sure = len(_words(name) & _words(top["name"])) >= 2 or (share > 0.99 and count[best] >= 2)
            if share >= 0.6 and similar[0][0] >= 1.5 and sure and best in categories:
                return {"category": best, "category_name": categories[best]["name"], "reason": f"Like {top['name']}", "_local": True}
        # 2. the AI, shown how this household files things
        examples = []
        for c in sorted(categories.values(), key=lambda c: c.get("sort", 0)):
            names = [p["name"] for p in food.data["products"].values() if p.get("category") == c["id"]][:6]
            examples.append(f"- {c['name']}: {'; '.join(names) if names else '(nothing yet)'}")
        near = "\n".join(f"- {prod['name']} → {categories[prod['category']]['name']}" for _s, prod in similar[:8] if prod["category"] in categories)
        storage = str(data.get("storage") or "")[:60]
        text = await _task(hass, food, "Crow Food: categorise", (
            "Choose the category this household would put a product in. Follow how they already file things "
            "(their categories and examples are below) rather than general rules: for example, if they keep chips "
            "under Vegetables, chips go in Vegetables. Only choose a 'Miscellaneous' or 'Other' kind of category "
            "if nothing else fits at all.\n"
            f"Product: {name}\n" + (f"Kept in: {storage}\n" if storage else "")
            + "Their categories, with some of their products in each:\n" + "\n".join(examples)
            + (f"\nTheir products with similar names:\n{near}" if near else "")
            + '\nAnswer with JSON only: {"category": "<one of the categories, exactly as written>", "reason": "<a few words>"}'))
        out = _json(text)
        cat = str(out.get("category") or "")
        cid = next((c["id"] for c in categories.values() if c["name"].lower() == cat.lower()), None)
        return {"category": cid, "category_name": cat if cid else "", "reason": str(out.get("reason") or "")[:80]}

    if feature == "barcode":
        pid = str(data.get("photo") or "")
        if not pid or not await hass.async_add_executor_job(food.photo_path(pid).is_file):
            raise FoodError("bad", "Take a photo first.")
        if not supports_photos(hass, task_entity(hass, food)):
            raise FoodError("ai_failed", FRIENDLY["no_photos"])
        text = await _task(hass, food, "Crow Food: read a barcode", (
            "This is a photo of a barcode on a food product or household item, perhaps blurred, tilted or in poor light.\n"
            "Read the barcode's number: the digits printed under the bars (usually 13 digits, sometimes 8 or 12). "
            "Only give digits you can actually see; if you can't read all of them, leave it empty. "
            "If the product's name can be seen too, give it.\n"
            'Answer with JSON only: {"barcode": "digits or empty", "name": "product name or empty"}'),
            attachments=[{"media_content_id": f"media-source://{DOMAIN}/{pid}", "media_content_type": food.photo_mime(pid)}])
        out = _json(text)
        code = re.sub(r"\D", "", str(out.get("barcode") or ""))
        return {"barcode": code if gtin_ok(code) else None, "name": str(out.get("name") or "").strip()[:160]}

    if feature == "photo":
        pid = str(data.get("photo") or "")
        if not pid or not await hass.async_add_executor_job(food.photo_path(pid).is_file):
            raise FoodError("bad", "Take a photo first.")
        if not supports_photos(hass, task_entity(hass, food)):
            raise FoodError("ai_failed", FRIENDLY["no_photos"])
        cats = [c["name"] for c in food.data["categories"].values()]
        text = await _task(hass, food, "Crow Food: photo to product", (
            f"This is a photo of a food product or household item. Today is {today.isoformat()}.\n"
            "Read the product's full name as it would appear on a shop's website (brand, product and size), the size "
            "of one package, and any best-before or use-by date printed on it (convert it to YYYY-MM-DD; if only a month "
            f"and year are shown, use the last day of that month). Choose a category from: {', '.join(cats)}.\n"
            'Answer with JSON only: {"name": "...", "content": <number or 0>, "content_unit": "g|kg|ml|l|piece|slice|" , '
            '"expires": "YYYY-MM-DD or empty", "category": "..."}'),
            attachments=[{"media_content_id": f"media-source://{DOMAIN}/{pid}", "media_content_type": food.photo_mime(pid)}])
        out = _json(text)
        cat = str(out.get("category") or "")
        cid = next((c["id"] for c in food.data["categories"].values() if c["name"].lower() == cat.lower()), None)
        expires = str(out.get("expires") or "")
        try:
            content = float(out.get("content") or 0)
        except (TypeError, ValueError):
            content = 0.0
        return {"name": str(out.get("name") or "")[:160], "content": content,
                "content_unit": str(out.get("content_unit") or "")[:10].lower(),
                "expires": expires if re.match(r"^\d{4}-\d{2}-\d{2}$", expires) else None,
                "category": cid}

    if feature == "use_up":
        # two or three meals that use up what's going off or open, with what's missing to buy
        soon_days = int(food.settings.get("soon_days", 3) or 3)
        first, rest = [], []
        for it in sorted(food.data["items"].values(), key=lambda i: i.get("expires") or "9999"):
            st = food.visible_storages(user.id).get(it.get("storage"))
            if not st or st.get("kind") != KIND_STORAGE:
                continue
            p = food.data["products"].get(it["product"]) or {}
            left = (date.fromisoformat(it["expires"]) - today).days if it.get("expires") else None
            line = f"{p.get('name', '?')} ({it['qty']:g} {it.get('unit') or 'package'}, {st['name']}" + (
                f", best before {it['expires']}" if it.get("expires") else "") + (", opened" if it.get("opened") else "") + ")"
            (first if (left is not None and left <= soon_days) or it.get("opened") else rest).append((p.get("name", ""), it, line))
        if not first:
            return {"meals": [], "text": "Nothing needs using up right now: nothing’s open or going off soon.", "_local": True}
        out = _json(await _task(hass, food, "Crow Food: use it up", (
            f"Today is {today.isoformat()}{f' in {country}' if country else ''}. A household needs to use these up first "
            "(going off soon or already open):\n" + "\n".join(x[2] for x in first[:40]) +
            "\n\nThey also have:\n" + ("\n".join(x[2] for x in rest[:120]) or "(nothing else)") +
            f"\n\nSuggest 3 simple, realistic home meals (in {lang}) that between them use up as many of the first list as "
            "possible, using what else they have and as few bought extras as possible. Reply with JSON only: "
            '{"note": "one short friendly sentence", "meals": [{"title": "...", "minutes": 25, '
            '"uses": ["names copied exactly from the first list"], "also": ["names copied exactly from what else they have"], '
            '"missing": ["short names of things to buy, if any"], "steps": ["3 to 5 short steps"]}]}')))
        if not isinstance(out, dict) or not isinstance(out.get("meals"), list):
            raise FoodError("ai_failed", FRIENDLY["other"])
        pool = first + rest

        def find(name: str) -> dict:
            n = str(name or "").strip()
            low = n.lower()
            hit = next((x for x in pool if x[0].lower() == low), None) or next((x for x in pool if low and (low in x[0].lower() or x[0].lower() in low)), None)
            if not hit:
                words = assist.query_words(n)
                hit = next((x for x in pool if words and assist.matches(food.data["products"].get(x[1]["product"]) or {}, words)), None)
            return {"name": hit[0] if hit else n[:80], "product": hit[1]["product"] if hit else None, "item": hit[1]["id"] if hit else None,
                    "expires": hit[1].get("expires") if hit else None, "opened": bool(hit and hit[1].get("opened"))}

        meals = []
        for m in out["meals"][:3]:
            if not isinstance(m, dict) or not m.get("title"):
                continue
            meals.append({"title": str(m["title"])[:80], "minutes": int(m["minutes"]) if str(m.get("minutes", "")).isdigit() else None,
                          "uses": [find(x) for x in (m.get("uses") or [])[:8]], "also": [find(x) for x in (m.get("also") or [])[:8]],
                          "missing": [str(x)[:60] for x in (m.get("missing") or [])[:8] if str(x).strip()],
                          "steps": [str(x)[:220] for x in (m.get("steps") or [])[:6] if str(x).strip()]})
        if not meals:
            raise FoodError("ai_failed", FRIENDLY["other"])
        used = {u["item"] for m in meals for u in m["uses"] if u["item"]}
        return {"note": str(out.get("note") or "")[:200], "meals": meals, "first": len({x[1]["product"] for x in first}),
                "covered": len({x[1]["product"] for x in first if x[1]["id"] in used}),
                "text": "\n".join(f"• {m['title']}" for m in meals)}

    if feature == "shopping":
        list_id = data.get("list_id")
        on_list = {i["product"] for i in food.data["items"].values() if i.get("storage") == list_id}
        counts: dict[str, int] = {}
        for log in food.data["logs"][-3000:]:
            if log.get("status") in ("bought", "consumed") and log.get("product"):
                counts[log["product"]] = counts.get(log["product"], 0) + 1
        frequent = sorted(counts, key=counts.get, reverse=True)[:80]
        rows = []
        for pid in frequent:
            p = food.data["products"].get(pid)
            if not p or pid in on_list:
                continue
            rows.append(f"{p['name']} [id {pid}] · bought or used {counts[pid]} times · {food.stock(pid):g} left at home")
        if not rows:
            return {"suggestions": [], "_local": True}
        text = await _task(hass, food, "Crow Food: shopping suggestions", (
            "From this household's usual products, pick up to 10 that most likely need buying now: things used often "
            "with little or none left at home.\n" + "\n".join(rows) +
            '\n\nAnswer with JSON only: {"suggestions": [{"id": "<the id>", "reason": "<a few words>"}]}'))
        out = _json(text)
        sug = []
        for s in (out.get("suggestions") or [])[:10]:
            pid = str((s or {}).get("id") or "")
            if pid in food.data["products"] and pid not in on_list:
                sug.append({"product": pid, "reason": str(s.get("reason") or "")[:80]})
        return {"suggestions": sug}

    if feature == "recap":
        from . import reports

        rep = await reports.async_report(food, user, "month", month=str(data.get("month") or "") or None)
        prev = "n/a" if rep["prev_consumed_pct"] is None else f"{100 - rep['prev_consumed_pct']:.0f}%"
        used = ", ".join(x["name"] for x in rep["top_used"][:5]) or "none"
        thrown = ", ".join(x["name"] for x in rep["top_thrown"][:5]) or "none"
        figures = (f"Month: {rep['month']}. Eaten or used: {rep['consumed']} things; thrown away: {rep['thrown']} "
                   f"({100 - rep['consumed_pct']:.0f}% wasted; the month before: {prev}). Bought: {rep['bought']}. "
                   f"Value thrown away: {rep['value_thrown']}. Spent: {rep['spent']}.\n"
                   f"Most used: {used}.\nMost thrown away: {thrown}.")
        text = await _task(hass, food, "Crow Food: monthly recap", (
            f"These are a household's food figures for a month.\n{figures}\n\nIn {lang}, write a short, warm recap "
            "(3 or 4 sentences, plain text, no markdown): how the month went, one thing that went well, and one practical "
            "tip to waste less next month based on what was thrown away."))
        return {"text": _clean(text)}

    if feature == "catchup":
        return await _catchup(hass, food, user, lang, today)

    if feature == "transcribe":
        return await _transcribe(hass, food, data)
    if feature == "receipt_lines":
        return await _receipt_lines(hass, food, data)
    if feature == "receipt_match":
        return await _receipt_match(hass, food, user, data, today)

    if feature in ("receipt", "voice"):
        return await _read_items(hass, food, user, feature, data, today)

    # ask
    question = str(data.get("question") or "").strip()[:500]
    if not question:
        raise FoodError("bad", "Ask a question first.")
    # "do we have tuna?" and the like: answered from the stock straight away, no AI
    quick = assist.quick_answer(food, user.id, question)
    if quick:
        return {"text": quick, "local": True, "_local": True}
    # only what the question is about (and what's open or going off), not everything: much quicker
    lines, total = assist.relevant_lines(food, user.id, question)
    words = assist.query_words(question)
    lists = [f"{r['product']} on {r['list']} ({r['purpose']}){' (ticked)' if r['ticked'] else ''}"
             for r in (assist.on_lists(food, user.id, question) if words else [])][:30]
    api = assist.CrowFoodAPI(hass, user.id, api_id=f"{DOMAIN}_ask") if tools_supported() else None
    more = ("Use the crow_food tools to look up anything else at home." if api else
            "That's only part of what's at home: say so if the answer might be in the rest.")
    text = await _task(hass, food, "Crow Food: ask", (
        f"Today is {today.isoformat()}{f' in {country}' if country else ''}. You help a household with the food they have.\n"
        f"Some of what's in their storages ({len(lines)} of {total} things: anything the question names, what's open and "
        f"what's going off soon):\n" + ("\n".join(lines) or "(nothing)") +
        ("\n\nOn their lists:\n" + "\n".join(lists) if lists else "") +
        f"\n\n{more}\nAnswer this in {lang}, briefly and in plain text (no markdown): {question}"),
        timeout=ASK_TIMEOUT, llm_api=api)
    return {"text": _clean(text)}


# dates as printed on a fresh pack: not too short (a date that's too early wastes good food too)
CAREFUL = ("Give the best-before or use-by date usually printed on a pack bought fresh today, not the shortest it could "
           "be: many chilled packs keep for weeks (bacon, cooked and sliced meats in sealed packs and hard cheese often "
           "have two to five weeks; fresh cream, milk, fresh meat and fish less). Frozen, tinned, dried and cupboard food "
           "keep for months or years.\n")


# ── What Did I Miss? ──────────────────────────────────────────────────────────
CATCHUP_FIRST_DAYS = 3
CATCHUP_MAX_DAYS = 14


async def _catchup(hass: HomeAssistant, food: CrowFood, user, lang: str, today) -> dict:
    """What others did since you last caught up, what's going off, and what's running out, in a few lines."""
    uid = user.id
    seen = food.data.setdefault("catchup", {})
    now = int(dt_util.utcnow().timestamp() * 1000)
    since = max(int(seen.get(uid) or 0) or now - CATCHUP_FIRST_DAYS * DAY, now - CATCHUP_MAX_DAYS * DAY)
    names = {u["id"]: u["name"] for u in await food.async_users()}
    storages = food.visible_storages(uid)
    verbs = {"added": "added", "bought": "bought", "consumed": "used", "thrown": "threw away", "moved": "moved"}
    lines = []
    for log in food.data.get("logs") or []:
        if log.get("ts", 0) <= since or not log.get("user") or log.get("user") == uid:
            continue
        if log.get("status") not in verbs or (log.get("storage") and log["storage"] not in storages):
            continue
        when = dt_util.as_local(dt_util.utc_from_timestamp(log["ts"] / 1000)).strftime("%a %H:%M")
        lines.append(f"{when}: {names.get(log['user'], 'Someone')} {verbs[log['status']]} {log.get('name') or 'something'}"
                     f" ({float(log.get('qty') or 1):g})")
    smart = food.smart(uid)
    t, tomorrow = today.isoformat(), (today + timedelta(days=1)).isoformat()
    going = [f"{food.name_of(i)} ({'expired ' + i['expires'] if i['expires'] < t else 'today' if i['expires'] == t else 'tomorrow'})"
             for i in sorted(smart["all"], key=lambda i: i.get("expires") or "9999") if i.get("expires") and i["expires"] <= tomorrow]
    low = [f"{r['name']} ({r['stock']:g} left)" for r in smart["low"]]
    new_on_lists = []
    for it in food.data["items"].values():
        st = storages.get(it.get("storage"))
        if st and st.get("kind") == KIND_LIST and not it.get("bought") and it.get("by") not in (None, uid) and int(it.get("created") or 0) > since:
            new_on_lists.append(f"{food.name_of(it)} on {st['name']} (added by {names.get(it['by'], 'someone')})")
    seen[uid] = now
    food._save()
    if not lines and not going and not low and not new_on_lists:
        return {"text": "You’re all caught up. Nothing’s going off today or tomorrow, and nothing’s running low.", "since": since}
    text = await _task(hass, food, "Crow Food: what did I miss", (
        f"Today is {today.isoformat()}. Catch this person up on their household's food since they last looked, in {lang}.\n"
        "What others did:\n" + ("\n".join(lines[-80:]) or "(nothing)") +
        "\n\nAdded to shopping lists by others:\n" + ("\n".join(new_on_lists[:30]) or "(nothing)") +
        "\n\nGoing off (expired, today or tomorrow):\n" + ("\n".join(going[:30]) or "(nothing)") +
        "\n\nRunning low:\n" + ("\n".join(low[:30]) or "(nothing)") +
        "\n\nWrite at most 6 short bullet points starting with •, most useful first: what to eat or use first, "
        "what needs buying, and who did what (group it, e.g. 'Keeva used the last of the milk and bread'). "
        "Plain text, no headings, no markdown, no greeting."))
    return {"text": _clean(text), "since": since}


# ── Reading a receipt, an order email or what was said out loud ─────────────────
async def _read_items(hass: HomeAssistant, food: CrowFood, user, feature: str, data: dict, today) -> dict:
    uid = user.id
    storages = [s for s in food.visible_storages(uid).values() if s.get("kind") == KIND_STORAGE]
    if not storages:
        raise FoodError("no_storage", "Make a storage first.")
    cats = food.data["categories"]
    # the household's products, most recently used first, numbered so the AI can say which one it is
    prods = sorted(food.data["products"].values(), key=lambda p: -(p.get("last_used") or p.get("modified") or 0))[:700]
    known = "\n".join(f"{n}. {p['name']}" for n, p in enumerate(prods, 1))
    shops = ", ".join(s["name"] for s in food.data["shops"].values()) or "(none yet)"
    ask = (
        f"Today is {today.isoformat()}.\n"
        "List EVERY food or household product that was bought, one entry per product line, all the way to the end: "
        "don't stop early or summarise, a big order can have over 100 lines. Leave out carrier bags, delivery or "
        "service charges, deposits, vouchers, payments and totals.\n"
        "Online orders: where a product was substituted, list the substitute that was delivered, not the one ordered. "
        "Leave out anything marked unavailable or not delivered.\n"
        "qty is how many were bought. price is what ONE cost after any savings: the line's total paid divided by qty "
        "(for '2 Dairylea £2.90 £5.64' that is 2.82). line_total is the line's total paid (5.64).\n"
        "receipt_name is the product exactly as written on the receipt.\n"
        "This household's products are numbered below. Give a number only when it is the SAME product: same brand, "
        "same kind of food and, where both say, the same size (shortened names are fine: 'TESCO HAM 120G' is "
        "'Tesco British Cooked Ham 120g'). Something merely similar is not the same: 'Roast Cooked Chicken Breast "
        "Fillets' is not 'Chicken and stuffing', and 400g is not 120g. If unsure, give 0 and write the product's full "
        "name as the shop's website would (brand, product, size).\n"
        f"Their storages: {', '.join(s['name'] for s in storages)}. Choose where each product would be kept: use the "
        "receipt's own sections if it has them (Fridge, Freezer, Cupboard...), otherwise frozen food in a freezer, "
        "chilled food in a fridge, the rest in a cupboard or pantry; household things (cleaning, toiletries) where "
        "they'd best fit.\n"
        f"Their categories: {', '.join(c['name'] for c in cats.values()) or '(none)'}.\n"
        f"Their shops: {shops}.\n"
        "For each, estimate how many days it keeps from today where it's stored (unopened).\n" + CAREFUL +
        "receipt_total is the total paid on the receipt or order, if it shows one.\n"
        f"Their products:\n{known or '(none yet)'}\n\n"
        'Answer with JSON only: {"shop": "shop name or empty", "receipt_total": <number or 0>, "items": [{"known": <number or 0>, '
        '"name": "...", "receipt_name": "...", "qty": <how many>, "price": <one, after savings>, "line_total": <number>, '
        '"content": <size of one pack or 0>, "content_unit": "g|kg|ml|l|piece|slice|", "storage": "...", "category": "...", '
        '"keeps_days": <whole number>}]}')
    if feature == "receipt" and str(data.get("text") or "").strip():
        # the text of an order email or a PDF: far more accurate than a picture of it
        doc = str(data["text"]).strip()[:80000]
        text = await _task(hass, food, "Crow Food: read a receipt", (
            "This is the text of a shopping receipt or an online order confirmation (an email or a PDF).\n"
            f"--- start ---\n{doc}\n--- end ---\n" + ask), timeout=240)
    elif feature == "receipt":
        pids = [str(p) for p in (data.get("photos") or [])][:12]
        if not pids:
            raise FoodError("bad", "Take a photo first.")
        if not supports_photos(hass, task_entity(hass, food)):
            raise FoodError("ai_failed", FRIENDLY["no_photos"])
        for pid in pids:
            if not await hass.async_add_executor_job(food.photo_path(pid).is_file):
                raise FoodError("bad", "That photo has gone. Take it again.")
        text = await _task(hass, food, "Crow Food: read a receipt", (
            "These pictures are a shopping receipt or an online order confirmation (an email or a PDF), perhaps over "
            "several pictures that overlap; count anything shown twice only once. Read the shop's name from it.\n" + ask),
            attachments=[{"media_content_id": f"media-source://{DOMAIN}/{pid}", "media_content_type": food.photo_mime(pid)} for pid in pids],
            timeout=240)
    else:
        said = str(data.get("text") or "").strip()[:1500]
        if not said:
            raise FoodError("bad", "Say what you’re adding first.")
        text = await _task(hass, food, "Crow Food: add by voice", (
            f"Someone said this while putting food away: \"{said}\"\nIf they said where it goes (\"in the freezer\"), "
            "use that storage. If they said a shop, give it. Numbers like 'two' are the quantity.\n" + ask))
    out = _json(text)
    if not isinstance(out, dict) or not isinstance(out.get("items"), list):
        raise FoodError("ai_failed", FRIENDLY["garbled"])
    by_name = {s["name"].lower(): s["id"] for s in storages}
    samples = food.shelf_samples()
    rows = []
    for r in out["items"][:200]:
        if not isinstance(r, dict):
            continue
        try:
            n = int(r.get("known") or 0)
        except (TypeError, ValueError):
            n = 0
        prod = prods[n - 1] if 0 < n <= len(prods) else None
        name = prod["name"] if prod else str(r.get("name") or "").strip()[:160]
        if not name:
            continue
        num = lambda k, d=0.0: _float(r.get(k), d)  # noqa: E731
        storage = (food.usual_storage(prod["id"], uid) if prod else None) or by_name.get(str(r.get("storage") or "").lower())
        storage = storage or next((sid for nm, sid in by_name.items() if str(r.get("storage") or "").lower() in nm), None) or storages[0]["id"]
        cat = str(r.get("category") or "").lower()
        cid = prod.get("category") if prod else next((c["id"] for c in cats.values() if c["name"].lower() == cat), None)
        # the date: how long it usually keeps in this house, or the AI's guess
        hist, n = food.usual_days(samples.get(prod["id"]), food._is_freezer(storage)) if prod else (None, 0)
        try:
            guess = max(1, min(3650, int(r.get("keeps_days"))))
        except (TypeError, ValueError):
            guess = None
        # how long their own packs kept, when there are any; otherwise the AI's guess
        if hist:
            days, source = hist, "history"
        elif guess:
            days, source = guess, "ai"
        else:
            days, source = None, ""
        qty = max(1.0, round(num("qty", 1.0), 2))
        line = round(max(0.0, num("line_total")), 2)
        price = round(line / qty, 2) if line else round(max(0.0, num("price")), 2)
        rows.append({"product": prod["id"] if prod else None, "name": name, "qty": qty, "price": price, "line_total": line or round(price * qty, 2),
                     "receipt_name": str(r.get("receipt_name") or r.get("name") or "").strip()[:160],
                     "new_name": str(r.get("name") or "").strip()[:160] if prod else "",
                     "content": max(0.0, num("content")),
                     "content_unit": str(r.get("content_unit") or "")[:10].lower() if not prod else (prod.get("content_unit") or str(r.get("content_unit") or "")[:10].lower()),
                     "storage": storage, "category": cid, "hist_n": n,
                     "expires": (today + timedelta(days=days)).isoformat() if days else None, "days": days, "date_from": source})
    shop_name = str(out.get("shop") or data.get("shop") or "").strip()[:60]
    shop = None
    if shop_name:
        low = shop_name.lower()
        shop = next((s["id"] for s in food.data["shops"].values() if s["name"].lower() == low
                     or low in s["name"].lower() or s["name"].lower() in low), None)
    return {"items": rows, "shop": shop, "shop_name": shop_name, "receipt_total": round(max(0.0, _float(out.get("receipt_total"))), 2)}


def _float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


# ── Receipts, step by step: the card reads the lines itself (receipts.py); these are the AI's parts ──
async def _transcribe(hass: HomeAssistant, food: CrowFood, data: dict) -> dict:
    """One picture of a receipt written out as text, line by line (one picture at a time keeps answers short)."""
    pid = str(data.get("photo") or "")
    if not pid or not await hass.async_add_executor_job(food.photo_path(pid).is_file):
        raise FoodError("bad", "That photo has gone. Take it again.")
    if not supports_photos(hass, task_entity(hass, food)):
        raise FoodError("ai_failed", FRIENDLY["no_photos"])
    text = await _task(hass, food, "Crow Food: write out a receipt", (
        "This is a picture of part of a shopping receipt or an online order. Write out every line of it exactly as "
        "printed, top to bottom, one line per line, with every price (keep the £ signs and minus signs). Don't "
        "explain, summarise, correct or add anything. Plain text only."),
        attachments=[{"media_content_id": f"media-source://{DOMAIN}/{pid}", "media_content_type": food.photo_mime(pid)}],
        timeout=150)
    return {"text": _clean(text)}


async def _receipt_lines(hass: HomeAssistant, food: CrowFood, data: dict) -> dict:
    """For a receipt the card couldn't follow: the AI lists one piece's product lines, in a short form."""
    piece = str(data.get("text") or "").strip()[:12000]
    if not piece:
        return {"lines": [], "_local": True}
    text = await _task(hass, food, "Crow Food: list a receipt's products", (
        "This is part of a shopping receipt or online order.\n--- start ---\n" + piece + "\n--- end ---\n"
        "List each product line bought, in order. Leave out totals, payments, charges, discounts and vouchers. "
        "For a substituted product, the substitute. Leave out anything unavailable.\n"
        "Answer with JSON only, one short row per product: "
        '{"r": [[<qty>, "<name as written>", <total paid for the line>, "<receipt section or empty>"], ...]}'), timeout=150)
    out = _json(text)
    rows = out.get("r") if isinstance(out, dict) else out
    lines = []
    for r in rows if isinstance(rows, list) else []:
        if isinstance(r, list) and len(r) >= 3:
            lines.append({"qty": _float(r[0], 1), "name": str(r[1] or ""), "total": _float(r[2]), "section": str(r[3] or "") if len(r) > 3 else ""})
    return {"lines": lines}


async def _receipt_match(hass: HomeAssistant, food: CrowFood, user, data: dict, today) -> dict:
    """Up to about 20 lines the card couldn't settle: which product each is (from a few likely ones), or a new
    product's name and size, where it goes, its category, and how long it keeps. The answer is one short row each."""
    from . import receipts

    uid = user.id
    lines = [l for l in (data.get("lines") or []) if isinstance(l, dict)][:30]
    if not lines:
        return {"rows": [], "_local": True}
    storages = [s for s in food.visible_storages(uid).values() if s.get("kind") == KIND_STORAGE]
    cats = sorted(food.data["categories"].values(), key=lambda c: c.get("sort", 0))
    st_no = {s["id"]: n for n, s in enumerate(storages, 1)}
    body = []
    for l in lines:
        cands = receipts.candidates_text(food, l)
        known = " (this is a)" if l.get("product") else ""
        cand = "; ".join(f"{k}) {p['name']}" for k, p in cands) or "none"
        sec = f" [section: {l['section']}]" if l.get("section") else ""
        body.append(f"{l.get('i')}. {l.get('name')}{sec} - their products: {cand}{known}")
    text = await _task(hass, food, "Crow Food: match a receipt", (
        f"Today is {today.isoformat()}. These lines are from a shopping receipt. For each, say which of the household's "
        "products listed with it is the SAME product (same brand, same kind of food, same size where both say; shortened "
        "names are fine, merely similar is not), or none.\n"
        "Storages: " + "; ".join(f"{n}={s['name']}" for s, n in ((s, st_no[s["id"]]) for s in storages)) + "\n"
        "Categories: " + "; ".join(f"{n}={c['name']}" for n, c in enumerate(cats, 1)) + "\n"
        + CAREFUL +
        "Lines:\n" + "\n".join(body) + "\n\n"
        "Answer with JSON only, one short row per line: "
        '{"r": [[<line number>, "<letter of the same product, or empty>", "<if none: its full name as the shop\'s website '
        'writes it, else empty>", <storage number>, <category number or 0>, <days it keeps unopened from today>, '
        '<size of one pack or 0>, "<g|kg|ml|l|piece|slice or empty>"], ...]}'), timeout=150)
    out = _json(text)
    rows = out.get("r") if isinstance(out, dict) else out
    by_i = {str(l.get("i")): l for l in lines}
    result = []
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, list) or len(r) < 6 or str(r[0]) not in by_i:
            continue
        l = by_i[str(r[0])]
        cands = dict(receipts.candidates_text(food, l))
        letter = str(r[1] or "").strip().lower()[:1]
        prod = cands.get(letter)
        try:
            sn = int(r[3])
            storage = storages[sn - 1]["id"] if 0 < sn <= len(storages) else None
        except (TypeError, ValueError):
            storage = None
        try:
            cn = int(r[4])
            cat = cats[cn - 1]["id"] if 0 < cn <= len(cats) else None
        except (TypeError, ValueError):
            cat = None
        try:
            days = max(1, min(3650, int(r[5])))
        except (TypeError, ValueError):
            days = None
        result.append({"i": l.get("i"), "product": prod["id"] if prod else None,
                       "name": prod["name"] if prod else (str(r[2] or "").strip()[:160] or l.get("name")),
                       "storage": storage, "category": prod.get("category") if prod else cat, "days": days,
                       "content": _float(r[6]) if len(r) > 6 else 0.0, "content_unit": str(r[7] or "")[:10].lower() if len(r) > 7 else ""})
    if lines and not result:
        raise FoodError("ai_failed", FRIENDLY["garbled"])
    return {"rows": result}
