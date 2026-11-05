"""Crow Food for Home Assistant's Assist and AI.

Three ways of answering questions about the food at home, all from the same lookups:

* quick answers - "do we have tuna?", "where's the butter?", "when does the ham go off?", "what's going off?"
  are answered straight from the stock, with no AI (Ask AI on the card, and Assist)
* AI tools      - an LLM API called "Crow Food" with a few small tools (search the stock, what's going off,
  what's open, the lists, add to a list). Ticked in an Assist agent's settings (Control Home Assistant), the
  agent looks up only what it needs. Ask AI on the card gives the same tools to the AI Task, where Home
  Assistant supports it.
* Assist phrases - the quick answers as sentences for Assist, so they work with Home Assistant's own agent
  (no AI at all), or before the AI when "Prefer handling commands locally" is on.

Each person only sees the storages and lists they can see on the card. Nothing here deletes or uses up food.
"""
from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any

import voluptuous as vol

from homeassistant.core import HomeAssistant
from homeassistant.helpers import llm
from homeassistant.util import dt as dt_util

from .const import DOMAIN, KIND_LIST, KIND_STORAGE, PURPOSE_BUY

if TYPE_CHECKING:
    from .store import CrowFood

_LOGGER = logging.getLogger(__name__)

MAX_ROWS = 20   # the most any lookup gives back, so answers stay quick

# words that don't say what the food is ("any tins of tuna" → tuna)
_FILLER = {"any", "some", "the", "a", "an", "our", "of", "tin", "tins", "can", "cans", "packet", "packets", "pack", "packs",
           "bag", "bags", "bottle", "bottles", "jar", "jars", "box", "boxes", "carton", "cartons", "tub", "tubs",
           "left", "at", "home", "in", "house", "please", "still", "more"}
# questions that need thinking (what to cook, enough for...), so they go to the AI
_NEEDS_AI = {"anything", "something", "enough", "ingredients", "make", "cook", "cooking", "dinner", "lunch", "breakfast",
             "tea", "recipe", "recipes", "meal", "meals", "snack", "snacks", "healthy", "vegetarian", "vegan", "why", "should"}


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower().replace("’", "'").replace("'s", ""))


def _stem(w: str) -> str:
    """tomatoes → tomato, eggs → egg, sausages → sausage (good enough for matching names)."""
    if len(w) > 4 and w.endswith("oes"):
        return w[:-2]
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def query_words(text: str) -> list[str]:
    return [_stem(w) for w in _words(text) if w not in _FILLER]


def _today() -> date:
    return dt_util.now().date()


def _home_items(food: CrowFood, uid: str | None) -> list[tuple[dict, dict, dict]]:
    """(item, product, storage) for everything in the storages this person can see."""
    vis = food.visible_storages(uid)
    out = []
    for it in food.data["items"].values():
        st = vis.get(it.get("storage"))
        if st and st.get("kind") == KIND_STORAGE:
            out.append((it, food.data["products"].get(it.get("product")) or {}, st))
    return out


def matches(product: dict, words: list[str], cats: dict | None = None) -> bool:
    """Every word of the question is in the product's name (or its category)."""
    if not words:
        return False
    name = {_stem(w) for w in _words(product.get("name", ""))}
    cat = {_stem(w) for w in _words((cats or {}).get(product.get("category"), {}).get("name", ""))} if cats else set()
    have = name | cat
    return all(w in have or any(n.startswith(w) for n in name if len(w) >= 3) for w in words)


def _qty(food: CrowFood, it: dict) -> str:
    q = float(it.get("qty") or 0)
    unit = it.get("unit") or "package"
    c = float(it.get("content") or 0)
    cu = it.get("content_unit") or ""
    plural = {"package": "packages", "piece": "pieces", "bottle": "bottles", "can": "tins", "tin": "tins", "bag": "bags",
              "box": "boxes", "jar": "jars", "pack": "packs", "tub": "tubs", "carton": "cartons", "loaf": "loaves"}
    u = unit if abs(q - 1) < 1e-6 else plural.get(unit, unit + ("s" if not unit.endswith("s") else ""))
    if unit == "package":
        u = "pack" if abs(q - 1) < 1e-6 else "packs"
    size = f" of {c:g}{cu}" if c > 0 and cu in ("g", "kg", "ml", "l", "cl", "mg") else ""
    return f"{q:g} {u}{size}"


def _date_text(d: str | None) -> str:
    if not d:
        return ""
    try:
        x = date.fromisoformat(d)
    except ValueError:
        return d
    t = _today()
    n = (x - t).days
    if n == 0:
        return "today"
    if n == 1:
        return "tomorrow"
    if n == -1:
        return "yesterday"
    if 1 < n < 7:
        return x.strftime("%A")
    return f"{x.day} {x.strftime('%B')}" + (f" {x.year}" if x.year != t.year else "")


def _row(food: CrowFood, it: dict, p: dict, st: dict) -> dict:
    return {"product": p.get("name") or "Product", "quantity": _qty(food, it), "storage": st.get("name", ""),
            "best_before": it.get("expires") or None, "opened": it.get("opened") or None}


# ── lookups (used by everything below) ─────────────────────────────────────────
def search(food: CrowFood, uid: str | None, text: str) -> list[dict]:
    words = query_words(text)
    cats = food.data["categories"]
    rows = [(it, p, st) for it, p, st in _home_items(food, uid) if matches(p, words, cats)]
    rows.sort(key=lambda r: (not r[0].get("opened"), r[0].get("expires") or "9999"))
    return [_row(food, *r) for r in rows[:MAX_ROWS]]


def on_lists(food: CrowFood, uid: str | None, text: str = "") -> list[dict]:
    vis = food.visible_storages(uid)
    words = query_words(text) if text else []
    out = []
    for it in food.data["items"].values():
        st = vis.get(it.get("storage"))
        if not st or st.get("kind") != KIND_LIST:
            continue
        p = food.data["products"].get(it.get("product")) or {}
        if words and not matches(p, words):
            continue
        out.append({"product": p.get("name") or "Product", "list": st["name"], "purpose": food.purpose(st["id"]),
                    "quantity": _qty(food, it), "ticked": bool(it.get("bought"))})
    return out[:MAX_ROWS * 2]


def expiring(food: CrowFood, uid: str | None, days: int = 7) -> list[dict]:
    end = (_today() + timedelta(days=max(0, min(days, 60)))).isoformat()
    rows = [(it, p, st) for it, p, st in _home_items(food, uid) if it.get("expires") and it["expires"] <= end]
    rows.sort(key=lambda r: r[0]["expires"])
    return [_row(food, *r) for r in rows[:MAX_ROWS]]


def opened(food: CrowFood, uid: str | None) -> list[dict]:
    rows = [(it, p, st) for it, p, st in _home_items(food, uid) if it.get("opened")]
    rows.sort(key=lambda r: r[0]["opened"])
    return [_row(food, *r) for r in rows[:MAX_ROWS]]


def _join(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


def _where(rows: list[dict], with_dates: bool = True) -> str:
    bits = []
    for r in rows[:5]:
        b = f"{r['quantity']} of {r['product']} in the {r['storage']}"
        if r.get("opened"):
            b += " (open)"
        elif with_dates and r.get("best_before"):
            b += f", best before {_date_text(r['best_before'])}"
        bits.append(b)
    more = f", and {len(rows) - 5} more" if len(rows) > 5 else ""
    return _join(bits) + more


# ── quick answers ──────────────────────────────────────────────────────────────
_HAVE = re.compile(r"^(?:do|have) we (?:have|got|still have) (?P<q>.+?)$|^(?:have we got|is there|are there|got|any) (?P<q2>.+?)$")
_MANY = re.compile(r"^how (?:many|much) (?P<q>.+?)(?: do we have| have we got| is there| are there| are left| is left| left)?$")
_WHERE = re.compile(r"^where(?: is| are|s| abouts is| abouts are)? (?P<q>.+?)(?: kept)?$")
_WHEN = re.compile(r"^when (?:does|do|will|is|are) (?P<q>.+?) (?:expire|go off|go out of date|out of date|due|best before|use by)$")
_GOING = re.compile(r"^what(?:s| is| are|re)? (?:going off|expiring|going out of date|about to expire|due to expire|out of date|expired|use first|should we use first|needs using)(?P<rest>.*)$")
_OPEN = re.compile(r"^what(?:s| is)? (?:open|opened)(?: at the moment| right now| now)?$")


def _clean_q(text: str) -> str:
    t = text.lower().replace("’", "'").replace("what's", "whats").replace("where's", "wheres").replace("there's", "theres")
    t = re.sub(r"[?!.,]", " ", t)
    t = t.replace("wheres", "where").replace("whats", "what").replace("theres", "there is")
    return re.sub(r"\s+", " ", t).strip()


def quick_answer(food: CrowFood, uid: str | None, question: str) -> str | None:
    """An answer straight from the stock, or None when the question needs the AI."""
    t = _clean_q(question)
    if not t:
        return None
    if m := _GOING.match(t):
        rest = m.group("rest")
        days = 14 if "fortnight" in rest or "two weeks" in rest else 0 if "today" in rest else 1 if "tomorrow" in rest else 7
        rows = expiring(food, uid, days)
        if not rows:
            return "Nothing's going out of date " + ("today." if days == 0 else "by tomorrow." if days == 1 else "this week." if days == 7 else "in the next two weeks.")
        return f"Use first: {_where(rows)}."
    if _OPEN.match(t):
        rows = opened(food, uid)
        return f"Open at the moment: {_where(rows, False)}." if rows else "Nothing's marked as open."
    kind, q = None, None
    for k, rx in (("when", _WHEN), ("many", _MANY), ("where", _WHERE), ("have", _HAVE)):
        if m := rx.match(t):
            kind, q = k, m.groupdict().get("q") or m.groupdict().get("q2")
            break
    if not kind or not q:
        return None
    q = re.sub(r"\b(?:left|at home|in the house|in stock|in)$", "", q).strip()
    words = query_words(q)
    raw = _words(q)
    # "do we have anything for dinner?", "do we have enough for a lasagne?": the AI's job
    if not words or len(words) > 4 or any(w in _NEEDS_AI for w in raw):
        return None
    name = " ".join(w for w in _words(q) if w not in _FILLER) or q
    rows = search(food, uid, q)
    if not rows:
        listed = on_lists(food, uid, q)
        tail = f" It's on {_join(sorted({r['list'] for r in listed}))}." if listed else ""
        return f"No, there's no {name} at home.{tail}"
    if kind == "when":
        dated = [r for r in rows if r.get("best_before")]
        if not dated:
            return f"{_where(rows, False)}. There's no best-before date on it."
        r = dated[0]
        when = _date_text(r["best_before"])
        past = r["best_before"] < _today().isoformat()
        return f"{r['product']} in the {r['storage']} {'went out of date' if past else 'is best before'} {when}." + (
            f" There's more: {_where(dated[1:4])}." if len(dated) > 1 else "")
    if kind == "where":
        return f"{_where(rows, False)}."
    return f"Yes: {_where(rows)}." if kind == "have" else f"{_where(rows)}."


# ── the AI's tools ─────────────────────────────────────────────────────────────
def _uid(llm_context: llm.LLMContext, fixed: str | None) -> str | None:
    if fixed:
        return fixed
    ctx = getattr(llm_context, "context", None)
    return getattr(ctx, "user_id", None) if ctx else None


def _food(hass: HomeAssistant) -> CrowFood | None:
    return hass.data.get(DOMAIN)


class _FoodTool(llm.Tool):
    def __init__(self, uid: str | None) -> None:
        self.uid = uid

    async def async_call(self, hass, tool_input, llm_context):
        food = _food(hass)
        if food is None:
            return {"error": "Crow Food isn't running."}
        try:
            return self.run(food, _uid(llm_context, self.uid), tool_input.tool_args)
        except Exception as err:  # noqa: BLE001 - the AI gets a message, not a crash
            _LOGGER.warning("Crow Food tool %s failed: %s", self.name, err)
            return {"error": str(err)}

    def run(self, food: CrowFood, uid: str | None, args: dict) -> dict:
        raise NotImplementedError


class SearchStock(_FoodTool):
    name = "crow_food_search_stock"
    description = ("Finds food at home in Crow Food (in the fridge, freezer, cupboards and other storages) by name or "
                   "category, e.g. 'tuna', 'cheese', 'frozen peas'. Gives how much, where it is, best-before and if it's "
                   "open. Use a short name, not a sentence; search again with another word if nothing is found.")
    parameters = vol.Schema({vol.Required("query"): str})

    def run(self, food, uid, args):
        rows = search(food, uid, str(args.get("query") or ""))
        return {"found": rows, "count": len(rows), "on_lists": on_lists(food, uid, str(args.get("query") or ""))[:10]}


class Expiring(_FoodTool):
    name = "crow_food_expiring"
    description = "Food at home that goes out of date within the next number of days (already out of date first)."
    parameters = vol.Schema({vol.Optional("days", default=7): vol.All(vol.Coerce(int), vol.Range(min=0, max=60))})

    def run(self, food, uid, args):
        rows = expiring(food, uid, int(args.get("days", 7)))
        return {"today": _today().isoformat(), "items": rows, "count": len(rows)}


class Opened(_FoodTool):
    name = "crow_food_opened"
    description = "Food at home that's been opened, oldest opened first (good to use up)."

    def run(self, food, uid, args):
        rows = opened(food, uid)
        return {"today": _today().isoformat(), "items": rows, "count": len(rows)}


class Lists(_FoodTool):
    name = "crow_food_lists"
    description = ("What's on the household's lists in Crow Food. A list's purpose says what it's for: 'buy' (shopping), "
                   "'eat' (chosen to eat from what's at home) or 'ideas'. Optionally only things matching a name.")
    parameters = vol.Schema({vol.Optional("query"): str})

    def run(self, food, uid, args):
        vis = food.visible_storages(uid)
        lists = [{"name": s["name"], "purpose": food.purpose(s["id"])} for s in vis.values() if s.get("kind") == KIND_LIST]
        return {"lists": lists, "items": on_lists(food, uid, str(args.get("query") or ""))}


class AddToList(_FoodTool):
    name = "crow_food_add_to_list"
    description = ("Adds a product to a list in Crow Food (a shopping list unless another is named). Only when the "
                   "person asks for something to be added.")
    parameters = vol.Schema({vol.Required("product"): str, vol.Optional("list"): str,
                             vol.Optional("quantity", default=1): vol.All(vol.Coerce(float), vol.Range(min=0.01, max=999))})

    async def async_call(self, hass, tool_input, llm_context):
        food = _food(hass)
        if food is None:
            return {"error": "Crow Food isn't running."}
        uid = _uid(llm_context, self.uid)
        args = tool_input.tool_args
        try:
            return await add_to_list(food, uid, str(args.get("product") or ""), args.get("list"), float(args.get("quantity") or 1))
        except Exception as err:  # noqa: BLE001
            return {"error": str(getattr(err, "message", None) or err)}


async def add_to_list(food: CrowFood, uid: str | None, product: str, list_name: str | None, qty: float = 1) -> dict:
    product = product.strip()[:120]
    if not product:
        return {"error": "Which product?"}
    vis = food.visible_storages(uid)
    lists = sorted((s for s in vis.values() if s.get("kind") == KIND_LIST), key=lambda s: s.get("sort", 0))
    if not lists:
        return {"error": "There are no lists yet."}
    target = None
    if list_name:
        want = query_words(list_name)
        target = next((s for s in lists if query_words(s["name"]) == want), None) or \
            next((s for s in lists if all(w in query_words(s["name"]) for w in want)), None)
        if not target:
            return {"error": f"There's no list called {list_name}.", "lists": [s["name"] for s in lists]}
    target = target or next((s for s in lists if food.purpose(s["id"]) == PURPOSE_BUY), lists[0])
    words = query_words(product)
    known = [p for p in food.data["products"].values() if matches(p, words)]
    # the closest name: the shortest that has every word (so "milk" is Milk, not Milk Chocolate Buttons)
    known.sort(key=lambda p: (p.get("name", "").lower() != product.lower(), len(p.get("name", ""))))
    if known:
        await food.async_add_to_list(uid, known[0]["id"], target["id"], qty)
        return {"added": known[0]["name"], "list": target["name"]}
    await food.async_save_item(uid, {"product": {"name": product[:1].upper() + product[1:]}, "storage": target["id"], "qty": qty})
    return {"added": product, "list": target["name"], "new_product": True}


PROMPT = ("Crow Food keeps track of the food in this home: what's in the fridge, freezer, cupboards and other storages "
          "(how much, best-before dates, what's open) and the household's lists. Use the crow_food tools to look things "
          "up instead of guessing; they only give back what's asked for. Use short product names when searching. "
          "Answer briefly, in plain sentences.")


class CrowFoodAPI(llm.API):
    """The tools as an LLM API. `uid` fixes whose storages are seen (Ask AI on the card); otherwise the person
    talking to Assist."""

    def __init__(self, hass: HomeAssistant, uid: str | None = None, api_id: str = DOMAIN) -> None:
        super().__init__(hass=hass, id=api_id, name="Crow Food")
        self._uid = uid

    async def async_get_api_instance(self, llm_context: llm.LLMContext) -> llm.APIInstance:
        uid = _uid(llm_context, self._uid)
        tools = [SearchStock(uid), Expiring(uid), Opened(uid), Lists(uid), AddToList(uid)]
        return llm.APIInstance(api=self, api_prompt=f"{PROMPT} Today is {_today().isoformat()}.",
                               llm_context=llm_context, tools=tools)


def register_api(hass: HomeAssistant):
    """Offers Crow Food to Assist agents (ticked under Control Home Assistant). Returns how to take it away."""
    try:
        return llm.async_register_api(hass, CrowFoodAPI(hass))
    except Exception as err:  # noqa: BLE001 - an older Home Assistant, or already there
        _LOGGER.debug("Crow Food: couldn't offer the AI tools: %s", err)
        return None


# ── Assist phrases (no AI needed) ──────────────────────────────────────────────
SENTENCES = [
    "do we have [any] {product}", "have we got [any] {product}", "do we still have [any] {product}",
    "is there [any] {product} [left]", "are there [any] {product} [left]",
    "how many {product} [do we have|have we got|are left]", "how much {product} [do we have|have we got|is left]",
    "where is [the] {product}", "where are [the] {product}", "where's [the] {product}",
    "when does [the] {product} (expire|go off)", "when do [the] {product} (expire|go off)",
    "what's (going off|expiring) [soon|this week|today|tomorrow]", "what is (going off|expiring) [soon|this week|today|tomorrow]",
    "what (needs|should we) (using|use) first", "what's open", "what is open",
]


def register_sentences(hass: HomeAssistant):
    """Adds the quick answers to Assist. Returns how to take them away (None if Assist isn't there)."""
    try:
        from homeassistant.components.conversation.agent_manager import get_agent_manager
        from homeassistant.components.conversation.trigger import TriggerDetails
    except ImportError:
        return None

    async def answer(user_input, result) -> str | None:
        food = _food(hass)
        if food is None:
            return None
        uid = getattr(getattr(user_input, "context", None), "user_id", None)
        text = getattr(user_input, "text", "") or ""
        reply = quick_answer(food, uid, text)
        if reply is None:
            # the phrase matched, but the question needs thinking: a plain search of what was said
            prod = (result.entities.get("product").value if getattr(result, "entities", None) and result.entities.get("product") else "") or text
            rows = search(food, uid, str(prod))
            reply = f"Yes: {_where(rows)}." if rows else f"I couldn't find {prod} in Crow Food."
        return reply

    try:
        return get_agent_manager(hass).register_trigger(TriggerDetails(sentences=SENTENCES, callback=answer))
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Crow Food: couldn't add Assist phrases: %s", err)
        return None


def relevant_lines(food: CrowFood, uid: str | None, question: str, limit: int = 60) -> tuple[list[str], int]:
    """For the AI without tools: only what the question is about, what's open and what's going off soon.
    Answers (lines, how many things are at home altogether)."""
    items = _home_items(food, uid)
    words = [w for w in query_words(question) if w not in _NEEDS_AI and len(w) > 2]
    cats = food.data["categories"]
    soon = (_today() + timedelta(days=7)).isoformat()

    def line(it, p, st):
        bits = [p.get("name", "?"), _qty(food, it), f"in {st['name']}"]
        if it.get("expires"):
            bits.append(f"best before {it['expires']}")
        if it.get("opened"):
            bits.append(f"opened {it['opened']}")
        if p.get("category") in cats:
            bits.append(f"category {cats[p['category']]['name']}")
        return " · ".join(bits)

    picked, seen = [], set()
    def take(rows):
        for r in rows:
            if r[0]["id"] not in seen and len(picked) < limit:
                seen.add(r[0]["id"])
                picked.append(line(*r))
    # anything named in the question (any of its words), then what's open, then what's going off
    take([r for r in items if words and any(matches(r[1], [w], cats) for w in words)])
    take(sorted((r for r in items if r[0].get("opened")), key=lambda r: r[0]["opened"]))
    take(sorted((r for r in items if r[0].get("expires") and r[0]["expires"] <= soon), key=lambda r: r[0]["expires"]))
    # a general question (what can I make?): fill up with the rest, soonest date first
    if not words or len(picked) < 15:
        take(sorted(items, key=lambda r: r[0].get("expires") or "9999"))
    return picked, len(items)
