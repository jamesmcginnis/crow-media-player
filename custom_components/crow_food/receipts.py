"""Reading a receipt or an online order's text without the AI, then matching it to the household's products.

1. strip: drop what isn't a product line (email headers, addresses, delivery slots, policies, "Was £5.45, now
   £3.65", payment summaries, the Unavailable list)
2. parse: each product line's quantity, name, total paid and the receipt's section (Fridge, Freezer, Cupboard)
   - online orders: "2 † Dairylea Cheese Spread 270G £2.90 £5.64 -£0.16", names wrapped over lines
   - till receipts: "DAIRYLEA SPREAD 270G   £2.90", with "2 @ £1.45" lines and savings lines under them
   - substitutes are kept (with the price charged), what they replaced isn't
   - a line repeated across a page break counts once
3. match: a link remembered from an earlier receipt, the same name, or a very close one; otherwise the few
   likeliest of the household's products go to the AI with the line (receipt_match), in small batches

Only what the AI is good at is left to it: which product a line is when the name isn't clear, a new product's
full name and size, where it's kept, and how long it keeps.
"""
from __future__ import annotations

import math
import re
from typing import Any

from .const import KIND_STORAGE
from .store import CrowFood

SECTIONS = {
    "fridge": "fridge", "chilled": "fridge", "fresh": "fridge", "fresh food": "fridge", "dairy": "fridge",
    "freezer": "freezer", "frozen": "freezer", "frozen food": "freezer",
    "cupboard": "cupboard", "food cupboard": "cupboard", "ambient": "cupboard", "bakery": "cupboard",
    "drinks": "cupboard", "household": "cupboard", "health & beauty": "cupboard", "health and beauty": "cupboard",
    "baby": "cupboard", "pets": "cupboard", "home": "cupboard", "toiletries": "cupboard",
}
# lines that are never products, whatever else they say
JUNK = re.compile(
    r"\b(sub ?total|total|balance|change due|cash|visa|mastercard|amex|debit|credit|card ending|expiry|vat\b|"
    r"delivery|deliver|carrier bag|bag charge|basket|voucher|coupon|clubcard|nectar|points|payment|paid|refund|"
    r"saving|savings|you saved|offers?\b|multibuy|minimum|charge|order number|receipt|tesco\.com|www\.|https?:|"
    r"@[a-z0-9.-]+\.[a-z]{2,}|subject|from ?:|to ?:|date ?:|thank you|items marked)", re.I)
WAS = re.compile(r"^\s*was\s+£", re.I)
PRICE = re.compile(r"(-)?£\s?(\d{1,4}(?:,\d{3})*\.\d{2})(-)?")
BARE_END = re.compile(r"\s(-)?(\d{1,4}\.\d{2})(-)?\s*[A-Z*]?\s*$")
QTY_START = re.compile(r"^(\d{1,2})\s+(?:x\s+|×\s*)?(?:[†‡*#]\s*)?(?=[A-Za-z(][A-Za-z('])")
# on an online order's product line, only these say it isn't a product ("2 for £6 Clubcard Price"); a name can
# have "Total" in it (Bodyform Total Protection)
JUNK_ITEM = re.compile(r"\b(clubcard|nectar|voucher|coupon|delivery|basket|charge|multibuy|offers?\b.*£|\d+ for £)", re.I)
AT_LINE = re.compile(r"^\s*(\d{1,3})\s*(?:@|x|×)\s*£?\s?(\d+\.\d{2})", re.I)
TOTAL = re.compile(r"\b(total paid|amount paid|balance due|total)\b\s*:?\s*£\s?(\d{1,5}(?:,\d{3})*\.\d{2})", re.I)
SHOPS = ("tesco", "asda", "sainsbury's", "sainsburys", "morrisons", "aldi", "lidl", "waitrose", "co-op", "coop",
         "iceland", "ocado", "m&s", "marks & spencer", "farmfoods", "home bargains", "b&m", "costco", "spar")


def _prices(line: str) -> list[float]:
    out = []
    for neg1, num, neg2 in PRICE.findall(line):
        v = float(num.replace(",", ""))
        out.append(-v if (neg1 or neg2) else v)
    if not out:
        m = BARE_END.search(line)
        if m:
            v = float(m.group(2))
            out.append(-v if (m.group(1) or m.group(3)) else v)
    return out


def _name_part(line: str) -> str:
    m = PRICE.search(line)
    text = line[:m.start()] if m else (line[:BARE_END.search(line).start()] if BARE_END.search(line) else line)
    return text.strip(" -:\t")


def _clean_name(name: str) -> str:
    name = re.sub(r"[†‡#*]", " ", name)
    name = re.sub(r"\s+", " ", name).strip(" -,:")
    return name


def _section(line: str) -> str | None:
    t = line.strip().lower().rstrip(":")
    return SECTIONS.get(t)


def strip_lines(text: str) -> list[str]:
    """The text's lines, without what's never a product (a blank line marks a page break)."""
    out = []
    skipping = False
    for raw in str(text or "").splitlines():
        line = raw.strip()
        low = line.lower()
        if not line:
            if out and out[-1] != "":
                out.append("")
            continue
        # the online order's list of things that weren't delivered: up to the next list
        if low in ("unavailable", "not available", "unavailable items"):
            skipping = True
            continue
        if skipping:
            if low.startswith(("the rest of your items", "your items", "qty product unit", "substitutions")) or _section(line):
                skipping = False
            else:
                continue
        if WAS.match(line):
            continue
        out.append(line)
    return out


def parse(text: str) -> dict:
    """Product lines read from a receipt's text: [{qty, name, total, section}], the shop and the receipt's total."""
    lines = strip_lines(text)
    low_text = str(text or "").lower()
    # the receipt's total: "Total paid" if it says, else the last total
    totals = [(m.group(1).lower(), float(m.group(2).replace(",", ""))) for m in TOTAL.finditer(str(text or ""))]
    paid = next((v for k, v in totals if k in ("total paid", "amount paid", "balance due")), None)
    receipt_total = paid if paid is not None else (totals[-1][1] if totals else 0.0)
    shop = ""
    best = 0
    for s in SHOPS:
        n = low_text.count(s)
        if n > best:
            shop, best = s, n
    # online orders start each product with how many ("2 Dairylea..."); till receipts don't
    priced = [l for l in lines if l and _prices(l) and not JUNK.search(l)]
    online = sum(1 for l in lines if QTY_START.match(l) and not JUNK.search(l)) >= max(2, len(priced) * 0.4)
    items: list[dict] = []
    section = None
    open_item: dict | None = None
    carry: float | None = None       # a substitute's charge, on the line before it
    page_break = False
    pending_name: str | None = None   # a till receipt's name on a line of its own, priced on the next

    def close(it: dict, prices: list[float]) -> None:
        nonlocal carry
        pos = [p for p in prices if p > 0]
        neg = [p for p in prices if p < 0]
        if not pos:
            return
        total = pos[-1] if len(pos) > 1 else pos[0]
        if carry is not None and len(pos) == 1:
            total = carry
        carry = None
        it["total"] = round(total, 2)
        it["unit"] = round(pos[0], 2) if len(pos) > 1 else None
        it["saved"] = round(-sum(neg), 2) if neg else 0
        it["name"] = _clean_name(it["name"])
        if not it["name"] or len(it["name"]) < 2:
            return
        # the same line again just after a page break: once
        if items and it.get("after_break"):
            prev = items[-1]
            same = prev["qty"] == it["qty"] and abs(prev["total"] - it["total"]) < 0.005
            if same and (it["name"].lower().startswith(prev["name"].lower()) or prev["name"].lower().startswith(it["name"].lower())):
                if len(it["name"]) > len(prev["name"]):
                    items[-1] = {**it, "after_break": False}
                return
        it.pop("after_break", None)
        it.pop("more", None)
        items.append(it)

    for line in lines:
        if line == "":
            page_break = True
            continue
        sec = _section(line)
        if sec:
            section, open_item = line.strip().rstrip(":"), None
            continue
        low = line.lower()
        if "substituted with" in low or "substitute:" in low:
            # what was ordered is replaced by what's on the next line, at this line's price
            if items and not open_item:
                items.pop()
            ps = [p for p in _prices(line) if p > 0]
            carry = ps[0] if ps else None
            open_item = None
            continue
        prices = _prices(line)
        # a till receipt's saving under the line it belongs to ("Clubcard Price -£0.40"): off that line
        if not online and prices and prices[0] < 0 and len(prices) == 1 and items and -prices[0] < items[-1]["total"] \
                and not re.search(r"\b(total|coupon|voucher|points)\b", low):
            items[-1]["total"] = round(items[-1]["total"] + prices[0], 2)
            items[-1]["saved"] = round(items[-1].get("saved", 0) - prices[0], 2)
            continue
        at = AT_LINE.match(line)
        if at and not online:
            # "2 @ £1.45" (and perhaps the line's total): how many of the line above, or of a name on its own above
            pos = [p for p in prices if p > 0]
            if pending_name:
                close({"qty": int(at.group(1)), "name": pending_name, "section": section, "after_break": False},
                      [pos[-1]] if len(pos) > 1 else [int(at.group(1)) * float(at.group(2))])
                pending_name = None
            elif items:
                items[-1]["qty"] = int(at.group(1))
                if len(pos) > 1:
                    items[-1]["total"] = pos[-1]
            continue
        if online and (open_item is not None or QTY_START.match(line)):
            # an item that never got its prices runs into a payment line ("Total: £392.09"): it wasn't one
            if JUNK_ITEM.search(line) or (open_item is not None and not QTY_START.match(line) and JUNK.search(line)):
                open_item = None
                continue
        elif JUNK.search(line):
            open_item = None
            continue
        if online:
            # a product's name can wrap ("Hovis Soft White Medium Sliced Bread" / "800g"): until its prices come,
            # a line is more of its name, even one starting with a number ("16 Long Rolls")
            m = QTY_START.match(line) if open_item is None or open_item.get("more", 0) >= 4 else None
            if m:
                open_item = {"qty": int(m.group(1)), "name": line[m.end():], "section": section, "after_break": page_break}
                page_break = False
                if prices:
                    open_item["name"] = _name_part(line[m.end():])
                    close(open_item, prices)
                    open_item = None
                continue
            if open_item is not None:
                if prices:
                    part = _name_part(line)
                    if part:
                        open_item["name"] += " " + part
                    close(open_item, prices)
                    open_item = None
                else:
                    if len(open_item["name"]) < 200:
                        open_item["name"] += " " + line
                    open_item["more"] = open_item.get("more", 0) + 1
                continue
            page_break = False
            continue
        # a till receipt: a name with a price at the end, or a saving under the line it belongs to
        if prices:
            name = _name_part(line)
            if prices[0] < 0 and items and not re.search(r"[a-z]{3}", name.lower().replace("saving", "")):
                items[-1]["total"] = round(max(0.0, items[-1]["total"] + prices[0]), 2)
                continue
            if prices[0] < 0:
                if items:
                    items[-1]["total"] = round(max(0.0, items[-1]["total"] + prices[0]), 2)
                continue
            m = re.match(r"^(\d{1,2})\s*[x×]\s+", name, re.I)
            qty = int(m.group(1)) if m else 1
            if m:
                name = name[m.end():]
            if name:
                close({"qty": qty, "name": name, "section": section, "after_break": page_break}, prices)
            pending_name = None
        elif re.search(r"[A-Za-z]{3}", line) and not JUNK.search(line):
            pending_name = line
        page_break = False
    for it in items:
        it["qty"] = max(1, int(it.get("qty") or 1))
        it["price"] = round(it["total"] / it["qty"], 2)
    return {"lines": items, "shop": shop, "receipt_total": round(receipt_total or 0.0, 2), "online": online}


# ── matching ────────────────────────────────────────────────────────────────────
_SIZE = re.compile(r"(\d+(?:\.\d+)?)\s?(kg|g|ml|l|ltr|lt|litre|liter|cl|pack|pk|x)\b", re.I)
_FILL = {"the", "and", "with", "for", "in", "of", "a", "pack", "pk", "x"}


def norm(name: str) -> str:
    """A name reduced for comparing: lower case, sizes written one way, no punctuation."""
    t = str(name or "").lower().replace("’", "'")
    t = re.sub(r"(\d)\s+(kg|g|ml|l|cl)\b", r"\1\2", t)
    t = re.sub(r"\b(litre|liter|ltr|lt)s?\b", "l", t)
    t = re.sub(r"[^a-z0-9.]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def _tokens(name: str) -> set[str]:
    out = set()
    for w in norm(name).split():
        if w in _FILL or len(w) < 2:
            continue
        if w.endswith("s") and len(w) > 3 and not w.endswith("ss") and not re.search(r"\d", w):
            w = w[:-1]
        out.add(w)
    return out


def _sizes(name: str) -> set[str]:
    return {re.sub(r"\s", "", m.group(0).lower()) for m in _SIZE.finditer(norm(name))}


def links(food: CrowFood) -> dict[str, str]:
    return food.data.setdefault("receipt_links", {})


def remember(food: CrowFood, receipt_name: str, pid: str) -> None:
    """A confirmed link from a receipt's wording to a product: next time it's matched without asking."""
    key = norm(receipt_name)
    if key and pid in food.data["products"]:
        lk = links(food)
        lk[key] = pid
        if len(lk) > 3000:
            for k in list(lk)[: len(lk) - 3000]:
                lk.pop(k, None)


def match(food: CrowFood, lines: list[dict]) -> None:
    """Fills each line's product when it's sure (remembered, the same name, or very nearly), else up to 4 candidates."""
    prods = list(food.data["products"].values())
    toks = {p["id"]: _tokens(p.get("name", "")) for p in prods}
    df: dict[str, int] = {}
    for ts in toks.values():
        for w in ts:
            df[w] = df.get(w, 0) + 1
    n = max(1, len(prods))
    by_norm = {norm(p.get("name", "")): p["id"] for p in prods}
    lk = links(food)
    for line in lines:
        name = line["name"]
        key = norm(name)
        line["product"], line["how"], line["candidates"] = None, "", []
        pid = lk.get(key)
        if pid in food.data["products"]:
            line["product"], line["how"] = pid, "remembered"
            continue
        if key in by_norm:
            line["product"], line["how"] = by_norm[key], "same"
            continue
        want = _tokens(name)
        if not want:
            continue
        sizes = _sizes(name)
        scored = []
        for p in prods:
            have = toks[p["id"]]
            shared = want & have
            if not shared:
                continue
            w = sum(math.log(1 + n / df[t]) for t in shared)
            allw = sum(math.log(1 + n / df.get(t, 1)) for t in want | have)
            scored.append((w / allw if allw else 0, w, p))
        scored.sort(key=lambda x: (-x[0], -x[1]))
        top = scored[:4]
        if top:
            sim, _w, p = top[0]
            psizes = _sizes(p.get("name", ""))
            sizes_ok = not sizes or not psizes or bool(sizes & psizes)
            clear = len(top) == 1 or top[0][0] - top[1][0] > 0.15
            if sim >= 0.82 and sizes_ok and clear:
                line["product"], line["how"] = p["id"], "close"
                continue
        line["candidates"] = [p["id"] for s, _w, p in top if s >= 0.12]


def storage_for(food: CrowFood, uid: str, section: str | None) -> str | None:
    """The household's storage for a receipt section: Fridge, Freezer, or a cupboard/pantry."""
    kind = SECTIONS.get(str(section or "").strip().lower())
    if not kind:
        return None
    sts = [s for s in food.visible_storages(uid).values() if s.get("kind") == KIND_STORAGE]
    words = {"fridge": ("fridge", "chill"), "freezer": ("freez", "frozen"), "cupboard": ("cupboard", "pantry", "larder", "kitchen", "shelf")}[kind]
    for s in sts:
        if any(w in s["name"].lower() for w in words):
            return s["id"]
    return None


def prepare(food: CrowFood, uid: str, text: str | None = None, lines: list[dict] | None = None,
            shop_name: str = "", receipt_total: float = 0.0) -> dict:
    """Read (or take) the lines, match them, and say which still need the AI."""
    if lines is None:
        got = parse(text or "")
        lines, shop_name, receipt_total = got["lines"], shop_name or got["shop"], receipt_total or got["receipt_total"]
    clean = []
    for r in lines:
        try:
            qty = max(1, int(float(r.get("qty") or 1)))
            total = round(max(0.0, float(r.get("total") or 0)), 2)
        except (TypeError, ValueError):
            continue
        name = _clean_name(str(r.get("name") or ""))[:160]
        if name:
            clean.append({"qty": qty, "name": name, "total": total, "price": round(total / qty, 2) if total else 0.0,
                          "section": r.get("section") or None})
    match(food, clean)
    samples = food.shelf_samples()
    pending = []
    for i, line in enumerate(clean):
        line["i"] = i
        sec_storage = storage_for(food, uid, line["section"])
        pid = line["product"]
        line["storage"] = (food.usual_storage(pid, uid) if pid else None) or sec_storage
        # how long it keeps here: the typical one of the recent packs kept the same way (freezer or not)
        days, n = food.usual_days(samples.get(pid), food._is_freezer(line["storage"])) if pid else (None, 0)
        line["days"], line["hist_n"] = days, n
        line["date_from"] = "history" if days else ""
        line["category"] = (food.data["products"][pid].get("category") if pid else None)
        # the AI is still needed: which product it is, a new one's details, how long it keeps, or where it goes
        if not pid or not days or not line["storage"]:
            pending.append(i)
    # the shop: one of theirs, if the receipt names it
    shop = None
    if shop_name:
        low = shop_name.lower().replace("’", "'")
        shop = next((s["id"] for s in food.data["shops"].values() if s["name"].lower() == low
                     or low in s["name"].lower() or s["name"].lower() in low), None)
        if not shop:
            shop_name = {"sainsburys": "Sainsbury's", "coop": "Co-op", "m&s": "M&S"}.get(low, shop_name.title() if shop_name.islower() else shop_name)
    return {"lines": clean, "pending": pending, "shop": shop, "shop_name": shop_name, "receipt_total": receipt_total,
            "read": "local" if clean else "none"}


def chunks(text: str, size: int = 60) -> list[str]:
    """The stripped text in pieces small enough for the AI to list the products in each."""
    lines = [l for l in strip_lines(text) if l]
    return ["\n".join(lines[i:i + size]) for i in range(0, len(lines), size)]


def candidates_text(food: CrowFood, line: dict) -> list[tuple[str, dict]]:
    letters = "abcd"
    out = []
    ids = [line["product"]] if line.get("product") else line.get("candidates") or []
    for k, pid in enumerate(ids[:4]):
        p = food.data["products"].get(pid)
        if p:
            out.append((letters[k], p))
    return out


def as_rows(food: CrowFood, out: Any) -> list:
    return out if isinstance(out, list) else []
