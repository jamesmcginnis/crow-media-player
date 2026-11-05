"""Reports: the figures behind Crow Food's Reports (the card draws the graphs).

Worked out here, from the history (kept for two years) and what's in the storages, so a phone gets just the
numbers. Every report also returns `rows`, a plain table for CSV and JSON exports.

* month    - Your Month in Food: consumed vs thrown, value, a calendar of the month, most used and thrown
* waste    - thrown per week, by category, storage and person, after its date or not, value, worst offenders
* use      - used per week, by category
* spending - bought per week, by shop and category, average shop
* habits   - Shopping Habits: from lists for buying only. Most bought, how often, what's probably due
* meals    - Meal Picks: from lists for eating only. Picked most, by day of the week, waiting, running low
* stock    - what's in each storage and category, its value, what's open, how old things are
* expiry   - what goes out of date over the next 30 days
* freezer  - what's been frozen longest, against how long it keeps frozen
* people   - consumed, thrown and bought per person
* product  - one product: use per month, buying to using, thrown, price
* items    - what's at home (or on a list for eating) right now, filtered: a storage, category, open, out of date,
             going off between dates, how long it's been in, the freezer and what's been frozen too long
* trips    - each shopping trip (a day at a shop): what it cost and how many things
* money    - Food Money: what was bought, used and thrown away in £, each week or month, running totals, against the
             period before, and what's at home now
* bin      - Money in the Bin: what thrown-away food cost, each month, the dearest things, after its date or not,
             and a yearly estimate
* daily    - Daily Cost: spending and eating per day and per week, by day of the week, and a usual week
* saved    - Saved in Time: used in the last days before its date, or frozen before it went off, and what that saved
* opened   - Open Too Long: how long opened things take to finish, what's usually thrown once opened, open now
* ranout   - Ran Out: when things ran out at home and how long until they were back; staples out now
* year     - Your Year in Food: a year's totals, months, favourites, best and worst months, against the year before
* seasons  - Food Through the Year: what's used each month of the year, and each season's favourites
* drill    - the details behind anything tapped in a report: the history filtered by person, product, category,
             storage, shop, what happened and when, with its own totals, weeks, top products and the entries
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from homeassistant.util import dt as dt_util

from .const import (KIND_LIST, KIND_STORAGE, PURPOSE_BUY, PURPOSE_EAT, STATUS_ADDED, STATUS_BOUGHT, STATUS_CONSUMED,
                    STATUS_MOVED, STATUS_PICKED, STATUS_THROWN)
from .store import CrowFood, FoodError

DAY = 86400000
NAMES = ("month", "waste", "use", "spending", "habits", "meals", "stock", "expiry", "freezer", "people", "product", "drill", "items", "trips", "money", "bin", "daily", "saved", "opened", "ranout", "year", "seasons")


def _day(ts: int) -> date:
    return dt_util.as_local(datetime.fromtimestamp(ts / 1000, dt_util.UTC)).date()


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _iso(s: Any) -> date | None:
    try:
        return date.fromisoformat(str(s)[:10]) if s else None
    except ValueError:
        return None


def _value(log: dict) -> float:
    return round(float(log.get("qty") or 0) * float(log.get("price") or 0), 2)


class _Ctx:
    """What every report needs: the logs this person may see, names of things, and the period."""

    def __init__(self, food: CrowFood, uid: str, days: int | None, since: date | None = None, until: date | None = None) -> None:
        self.food = food
        self.uid = uid
        self.today = dt_util.now().date()
        # a period: the last N days, or chosen dates (this month, last year, from–to)
        self.until = min(until, self.today) if until else None
        self.end = self.until or self.today
        if since:
            self.since = since
            self.days = (self.end - since).days + 1
        else:
            self.days = days
            self.since = (self.today - timedelta(days=days - 1)) if days else None
        storages = food.data["storages"]
        visible = food.visible_storages(uid)
        self.visible = visible
        self.logs = [l for l in food.data.get("logs", [])
                     if not (l.get("storage") in storages and l.get("storage") not in visible)]
        self.products = food.data["products"]
        self.cats = food.data["categories"]

    def in_period(self, log: dict) -> bool:
        d = _day(int(log.get("ts") or 0))
        return (self.since is None or d >= self.since) and (self.until is None or d <= self.until)

    def val(self, log: dict) -> float:
        """What a log was worth: its price, or the product's usual price when it had none."""
        price = float(log.get("price") or 0) or float((self.products.get(log.get("product") or "") or {}).get("price") or 0)
        return round(float(log.get("qty") or 0) * price, 2)

    def is_purchase(self, log: dict) -> bool:
        """Bought: off a list for buying, or added with a price or a shop (a receipt, or by hand from a shop)."""
        st = log.get("status")
        if st == STATUS_BOUGHT:
            return self.purpose(log) == PURPOSE_BUY
        return st == STATUS_ADDED and bool(float(log.get("price") or 0) or log.get("shop"))

    def period(self, *statuses: str) -> list[dict]:
        return [l for l in self.logs if l.get("status") in statuses and self.in_period(l)]

    def name(self, log_or_item: dict) -> str:
        p = self.products.get(log_or_item.get("product")) or {}
        return p.get("name") or log_or_item.get("name") or "Product"

    def cat(self, pid: str | None) -> str:
        p = self.products.get(pid or "") or {}
        return (self.cats.get(p.get("category")) or {}).get("name") or "No category"

    def storage(self, sid: str | None) -> str:
        return (self.food.data["storages"].get(sid or "") or {}).get("name") or "Storage"

    def purpose(self, log: dict) -> str:
        """What the list a log came from is for. A list deleted since (or an import's unknown list) counts as buying."""
        return self.food.purpose(log.get("storage")) or PURPOSE_BUY

    def buys(self) -> list[dict]:
        """Every time something came off a list for buying (not a Basket of meals, not things added by hand)."""
        return [l for l in self.logs if l.get("status") == STATUS_BOUGHT and self.purpose(l) == PURPOSE_BUY]

    def picks(self) -> list[dict]:
        """Every time something came off a list for eating."""
        return [l for l in self.logs if self.purpose(l) == PURPOSE_EAT and l.get("status") in (STATUS_PICKED, STATUS_BOUGHT)]

    def items(self) -> list[dict]:
        return [i for i in self.food.data["items"].values()
                if (self.visible.get(i.get("storage")) or {}).get("kind") == KIND_STORAGE]


def _top(counter: Counter, n: int = 8) -> list[dict]:
    return [{"name": k, "count": round(v, 2)} for k, v in counter.most_common(n)]


def _weeks(ctx: _Ctx, logs: list[dict], key: str = "count") -> list[dict]:
    """Logs counted per week (Monday), every week of the period, empty ones too."""
    start = _monday(ctx.since or min((_day(l["ts"]) for l in logs), default=ctx.today))
    out: dict[date, dict] = {}
    d = start
    while d <= ctx.end:
        out[d] = {"week": d.isoformat(), "consumed": 0, "thrown": 0, "bought": 0, "value": 0.0}
        d += timedelta(days=7)
    for l in logs:
        w = _monday(_day(l["ts"]))
        if w in out:
            st = l.get("status")
            if st in out[w]:
                out[w][st] += 1
            out[w]["value"] = round(out[w]["value"] + _value(l), 2)
    return list(out.values())


def _pct(a: int, b: int) -> float:
    return round(a * 100 / (a + b), 1) if a + b else 0.0


# ── the reports ────────────────────────────────────────────────────────────────
def r_month(ctx: _Ctx, month: str | None) -> dict:
    today = ctx.today
    y, m = (int(month[:4]), int(month[5:7])) if month and re.match(r"^\d{4}-\d{2}$", month) else (today.year, today.month)
    first = date(y, m, 1)
    nxt = date(y + (m == 12), m % 12 + 1, 1)
    prev_first = date(y - (m == 1), (m - 2) % 12 + 1, 1)

    def span(a: date, b: date) -> list[dict]:
        return [l for l in ctx.logs if a <= _day(int(l.get("ts") or 0)) < b]

    cur, prev = span(first, nxt), span(prev_first, first)
    cnt = lambda logs, st: sum(1 for l in logs if l.get("status") == st)  # noqa: E731
    c, t = cnt(cur, STATUS_CONSUMED), cnt(cur, STATUS_THROWN)
    pc, pt = cnt(prev, STATUS_CONSUMED), cnt(prev, STATUS_THROWN)
    days = []
    d = first
    per_day: dict[date, dict] = defaultdict(lambda: {"consumed": 0, "thrown": 0, "bought": 0})
    for l in cur:
        if l.get("status") in (STATUS_CONSUMED, STATUS_THROWN, STATUS_BOUGHT):
            per_day[_day(l["ts"])][l["status"]] += 1
    while d < nxt:
        days.append({"date": d.isoformat(), **per_day[d], "future": d > today})
        d += timedelta(days=1)
    weeks = defaultdict(lambda: [0, 0])
    for l in cur:
        if l.get("status") in (STATUS_CONSUMED, STATUS_THROWN):
            weeks[_monday(_day(l["ts"]))][0 if l["status"] == STATUS_CONSUMED else 1] += 1
    rated = [(w, v[0], v[1]) for w, v in weeks.items() if v[0] + v[1] >= 3]
    best = max(rated, key=lambda x: (_pct(x[1], x[2]), x[1]), default=None)
    worst = max(rated, key=lambda x: (x[2], -x[1]), default=None)
    months = []
    mm = date(today.year, today.month, 1)
    for _ in range(12):
        months.append(mm.strftime("%Y-%m"))
        mm = date(mm.year - (mm.month == 1), (mm.month - 2) % 12 + 1, 1)
    return {
        "month": first.strftime("%Y-%m"), "months": months,
        "consumed": c, "thrown": t, "consumed_pct": _pct(c, t), "prev_consumed_pct": _pct(pc, pt) if pc + pt else None,
        "bought": cnt(cur, STATUS_BOUGHT),
        "value_used": round(sum(_value(l) for l in cur if l.get("status") == STATUS_CONSUMED), 2),
        "value_thrown": round(sum(_value(l) for l in cur if l.get("status") == STATUS_THROWN), 2),
        "spent": round(sum(_value(l) for l in cur if l.get("status") == STATUS_BOUGHT), 2),
        "days": days,
        "top_used": _top(Counter(ctx.name(l) for l in cur if l.get("status") == STATUS_CONSUMED)),
        "top_thrown": _top(Counter(ctx.name(l) for l in cur if l.get("status") == STATUS_THROWN)),
        "best_week": {"week": best[0].isoformat(), "consumed": best[1], "thrown": best[2]} if best else None,
        "worst_week": {"week": worst[0].isoformat(), "consumed": worst[1], "thrown": worst[2]} if worst and worst[2] else None,
        "rows": [{"date": x["date"], "consumed": x["consumed"], "thrown": x["thrown"], "bought": x["bought"]} for x in days if not x["future"]],
    }


def r_waste(ctx: _Ctx, users: dict[str, str]) -> dict:
    thrown = ctx.period(STATUS_THROWN)
    used = ctx.period(STATUS_CONSUMED)
    after = inside = unknown = 0
    for l in thrown:
        exp = _iso((l.get("snap") or {}).get("expires"))
        if not exp:
            unknown += 1
        elif _day(l["ts"]) > exp:
            after += 1
        else:
            inside += 1
    return {
        "thrown": len(thrown), "consumed": len(used), "consumed_pct": _pct(len(used), len(thrown)),
        "value": round(sum(_value(l) for l in thrown), 2),
        "weeks": _weeks(ctx, thrown + used),
        "by_category": _top(Counter(ctx.cat(l.get("product")) for l in thrown)),
        "by_storage": _top(Counter(ctx.storage(l.get("storage")) for l in thrown)),
        "by_person": _top(Counter(users.get(l.get("user"), "Not recorded") if l.get("user") else "Not recorded" for l in thrown)),
        "after_date": after, "in_date": inside, "no_date": unknown,
        "top": _top(Counter(ctx.name(l) for l in thrown), 10),
        "rows": [{"date": _day(l["ts"]).isoformat(), "product": ctx.name(l), "qty": l.get("qty"), "unit": l.get("unit"),
                  "storage": ctx.storage(l.get("storage")), "value": _value(l)} for l in thrown],
    }


def r_use(ctx: _Ctx) -> dict:
    used = ctx.period(STATUS_CONSUMED)
    weeks = _weeks(ctx, used)
    return {
        "consumed": len(used), "per_week": round(len(used) / max(1, len(weeks)), 1), "weeks": weeks,
        "by_category": _top(Counter(ctx.cat(l.get("product")) for l in used), 10),
        "top": _top(Counter(ctx.name(l) for l in used), 10),
        "rows": [{"week": w["week"], "consumed": w["consumed"]} for w in weeks],
    }


def r_spending(ctx: _Ctx) -> dict:
    bought = [{**l, "status": STATUS_BOUGHT} for l in ctx.period(STATUS_BOUGHT, STATUS_ADDED) if ctx.is_purchase(l)]
    shops = ctx.food.data["shops"]
    trips: dict[tuple, float] = defaultdict(float)
    for l in bought:
        trips[(_day(l["ts"]), l.get("shop"))] += _value(l)
    by_shop: Counter = Counter()
    by_cat: Counter = Counter()
    for l in bought:
        by_shop[(shops.get(l.get("shop") or "") or {}).get("name") or "Without a shop"] += _value(l)
        by_cat[ctx.cat(l.get("product"))] += _value(l)
    total = round(sum(_value(l) for l in bought), 2)
    priced = sum(1 for l in bought if float(l.get("price") or 0) > 0)
    return {
        "total": total, "bought": len(bought), "priced": priced, "trips": len(trips),
        "per_trip": round(total / len(trips), 2) if trips else 0,
        "weeks": _weeks(ctx, bought),
        "by_shop": _top(by_shop), "by_category": _top(by_cat),
        "rows": [{"date": _day(l["ts"]).isoformat(), "product": ctx.name(l), "qty": l.get("qty"),
                  "shop": (shops.get(l.get("shop") or "") or {}).get("name", ""), "value": _value(l)} for l in bought],
    }


def _days_of(logs: list[dict]) -> dict[str, list[date]]:
    """product id -> the days it came off a list, oldest first, one per day. Entries brought in from elsewhere
    can also give the day it first went on the list."""
    out: dict[str, set[date]] = defaultdict(set)
    for l in logs:
        pid = l.get("product")
        if not pid:
            continue
        out[pid].add(_day(int(l["ts"])))
        if l.get("first"):
            out[pid].add(_day(int(l["first"])))
    return {k: sorted(v) for k, v in out.items()}


def _every(ds: list[date]) -> float | None:
    """The usual gap between days, from three or more (one gap isn't a habit)."""
    if len(ds) < 3:
        return None
    gaps = sorted((b - a).days for a, b in zip(ds, ds[1:]))
    mid = len(gaps) // 2
    every = float(gaps[mid]) if len(gaps) % 2 else (gaps[mid - 1] + gaps[mid]) / 2
    return max(every, 1.0)


def r_habits(ctx: _Ctx) -> dict:
    # Only what was bought from a list for buying: each Put Away is a purchase (once a day). Things eaten from
    # a Basket, or added by hand, aren't shopping.
    out = []
    for pid, ds in _days_of(ctx.buys()).items():
        if pid not in ctx.products:
            continue
        every = _every(ds)
        row = {"product": pid, "name": ctx.products[pid]["name"], "times": len(ds), "every_days": every,
               "last": ds[-1].isoformat(), "stock": round(ctx.food.stock(pid), 2), "due": None, "due_in": None}
        if every:
            due = ds[-1] + timedelta(days=round(every))
            row.update(due=due.isoformat(), due_in=(due - ctx.today).days)
        out.append(row)
    # the most often first: a usual gap from three or more purchases, shortest first; then by how many times
    often = sorted(out, key=lambda x: (x["every_days"] is None, x["every_days"] or 0, -x["times"], x["name"].lower()))
    # due within a week (or a little overdue), and none left at home; not things long since given up on
    due = sorted([x for x in out if x["due_in"] is not None and -14 <= x["due_in"] <= 7 and x["stock"] <= 0],
                 key=lambda x: x["due_in"])[:15]
    return {"most": often[:20], "due": due, "products": len(out), "habits": sum(1 for x in out if x["every_days"]),
            "purchases": sum(x["times"] for x in out),
            "rows": [{k: x[k] for k in ("name", "times", "every_days", "last", "due", "stock")} for x in often]}


def r_meals(ctx: _Ctx) -> dict:
    # From lists for eating: what's picked most, on which days, what's waiting on the list, and favourites
    # running low at home.
    picks = ctx.picks()
    days = _days_of(picks)
    out = []
    for pid, ds in days.items():
        if pid not in ctx.products:
            continue
        p = ctx.products[pid]
        stock = round(ctx.food.stock(pid), 2)
        out.append({"product": pid, "name": p["name"], "times": len(ds), "every_days": _every(ds),
                    "first": ds[0].isoformat(), "last": ds[-1].isoformat(), "stock": stock,
                    "low": stock <= max(float(p.get("min_qty") or 0), 0) + 1e-6})
    most = sorted(out, key=lambda x: (-x["times"], x["every_days"] or 9999, x["name"].lower()))
    # the day of the week, from picks made in Crow Food (an import's dates are when the list last changed)
    week = [0] * 7
    for l in picks:
        if not l.get("imported"):
            week[_day(int(l["ts"])).weekday()] += 1
    # what's on an eating list now, longest waiting first
    waiting = []
    for it in ctx.food.data["items"].values():
        st = ctx.visible.get(it.get("storage"))
        if st and st.get("kind") == KIND_LIST and ctx.food.purpose(st["id"]) == PURPOSE_EAT and it.get("product") in ctx.products:
            since = _day(int(it.get("created") or 0)) if it.get("created") else ctx.today
            waiting.append({"product": it["product"], "name": ctx.name(it), "list": st["name"], "since": since.isoformat(),
                            "days": (ctx.today - since).days, "stock": round(ctx.food.stock(it["product"]), 2)})
    waiting.sort(key=lambda x: -x["days"])
    # favourites (picked three or more times) with none left, or down to their minimum
    low = [x for x in most if x["times"] >= 3 and x["low"]][:10]
    used = sum(1 for l in picks if l.get("status") == STATUS_PICKED and l.get("used"))
    return {"most": most[:20], "products": len(out), "picks": sum(x["times"] for x in out), "week": week,
            "waiting": waiting[:20], "low": low, "used": used,
            "rows": [{k: x[k] for k in ("name", "times", "every_days", "first", "last", "stock")} for x in most]}


def r_stock(ctx: _Ctx) -> dict:
    items = ctx.items()
    by_storage: Counter = Counter()
    by_cat: Counter = Counter()
    value = 0.0
    ages = Counter()
    for it in items:
        by_storage[ctx.storage(it.get("storage"))] += 1
        by_cat[ctx.cat(it.get("product"))] += 1
        p = ctx.products.get(it.get("product")) or {}
        value += float(it.get("qty") or 0) * float(it.get("price") or p.get("price") or 0)
        stored = _iso(it.get("stored")) or (_day(int(it["created"])) if it.get("created") else None)
        age = (ctx.today - stored).days if stored else None
        band = ("Unknown" if age is None else "Under a week" if age < 7 else "1–4 weeks" if age < 28
                else "1–3 months" if age < 91 else "3–6 months" if age < 182 else "Over 6 months")
        ages[band] += 1
    order = ["Under a week", "1–4 weeks", "1–3 months", "3–6 months", "Over 6 months", "Unknown"]
    return {
        "items": len(items), "products": len({i.get("product") for i in items}), "value": round(value, 2),
        "opened": sum(1 for i in items if i.get("opened")),
        "by_storage": _top(by_storage, 12), "by_category": _top(by_cat, 12),
        "ages": [{"name": b, "count": ages[b]} for b in order if ages[b]],
        "rows": [{"product": ctx.name(i), "storage": ctx.storage(i.get("storage")), "category": ctx.cat(i.get("product")),
                  "qty": i.get("qty"), "unit": i.get("unit"), "stored": i.get("stored"), "expires": i.get("expires"),
                  "opened": i.get("opened")} for i in items],
    }


def r_expiry(ctx: _Ctx) -> dict:
    items = [i for i in ctx.items() if i.get("expires")]
    end = ctx.today + timedelta(days=29)
    per_day = Counter()
    expired, soon = [], []
    for it in items:
        d = _iso(it["expires"])
        if not d:
            continue
        row = {"item": it["id"], "product": it.get("product"), "name": ctx.name(it), "expires": d.isoformat(),
               "days": (d - ctx.today).days, "storage": ctx.storage(it.get("storage"))}
        if d < ctx.today:
            expired.append(row)
        elif d <= end:
            per_day[d] += 1
            soon.append(row)
    days = [{"date": (ctx.today + timedelta(days=i)).isoformat(), "count": per_day[ctx.today + timedelta(days=i)]} for i in range(30)]
    soon.sort(key=lambda r: r["expires"])
    expired.sort(key=lambda r: r["expires"])
    return {"expired": expired, "soon": soon, "days": days, "next7": sum(d["count"] for d in days[:7]),
            "rows": [{k: r[k] for k in ("name", "expires", "days", "storage")} for r in expired + soon]}


def r_freezer(ctx: _Ctx) -> dict:
    out = []
    for it in ctx.items():
        st = ctx.food.data["storages"].get(it.get("storage")) or {}
        if not (re.search(r"freez", st.get("name", ""), re.I) or re.search(r"freezer|snowflake|fridge-industrial", st.get("icon", ""))):
            continue
        stored = _iso(it.get("stored")) or (_day(int(it["created"])) if it.get("created") else None)
        days_in = (ctx.today - stored).days if stored else None
        info = (ctx.products.get(it.get("product")) or {}).get("info") or {}
        keeps = info.get("frozen_days")
        out.append({"item": it["id"], "product": it.get("product"), "name": ctx.name(it), "storage": st.get("name", ""),
                    "stored": stored.isoformat() if stored else None, "days": days_in, "keeps_days": keeps,
                    "keeps": info.get("keeps_frozen"), "over": bool(keeps and days_in is not None and days_in > keeps)})
    out.sort(key=lambda r: -(r["days"] if r["days"] is not None else -1))
    return {"items": out, "count": len(out), "over": sum(1 for r in out if r["over"]),
            "oldest_days": out[0]["days"] if out and out[0]["days"] is not None else None,
            "rows": [{k: r[k] for k in ("name", "storage", "stored", "days", "keeps")} for r in out]}


def _is_freezer(st: dict) -> bool:
    return bool(re.search(r"freez", st.get("name", ""), re.I) or re.search(r"freezer|snowflake|fridge-industrial", st.get("icon", "")))


def r_items(ctx: _Ctx, f: dict) -> dict:
    """What's there right now, filtered (see the list at the top). sort: expiry (default), value, age, opened."""
    exp_from, exp_to = _iso(f.get("expires_from")), _iso(f.get("expires_to"))
    within = f.get("within")
    rows = []
    if f.get("where") == "eat_lists":
        src = [i for i in ctx.food.data["items"].values() if (ctx.visible.get(i.get("storage")) or {}).get("kind") == KIND_LIST
               and ctx.food.purpose(i.get("storage")) == PURPOSE_EAT]
    else:
        src = ctx.items()
    for it in src:
        st = ctx.food.data["storages"].get(it.get("storage")) or {}
        p = ctx.products.get(it.get("product")) or {}
        if f.get("storage") and st.get("name") != f["storage"]:
            continue
        if f.get("category") and ctx.cat(it.get("product")) != f["category"]:
            continue
        if f.get("opened") and not it.get("opened"):
            continue
        stored = _iso(it.get("stored")) or (_day(int(it["created"])) if it.get("created") else None)
        age = (ctx.today - stored).days if stored else None
        if f.get("age_min") is not None and (age is None or age < int(f["age_min"])):
            continue
        if f.get("age_max") is not None and (age is None or age >= int(f["age_max"])):
            continue
        if f.get("age_unknown") and age is not None:
            continue
        exp = _iso(it.get("expires"))
        if f.get("expired") and not (exp and exp < ctx.today):
            continue
        if within is not None and not (exp and ctx.today <= exp <= ctx.today + timedelta(days=int(within) - 1)):
            continue
        if exp_from and not (exp and exp >= exp_from) or exp_to and not (exp and exp <= exp_to):
            continue
        fz = _is_freezer(st)
        if f.get("freezer") and not fz:
            continue
        info = p.get("info") or {}
        keeps = info.get("frozen_days") if fz else None
        over = bool(keeps and age is not None and age > keeps)
        if f.get("over") and not over:
            continue
        value = round(float(it.get("qty") or 0) * float(it.get("price") or p.get("price") or 0), 2)
        rows.append({"item": it["id"], "product": it.get("product"), "name": ctx.name(it), "storage": st.get("name", ""),
                     "category": ctx.cat(it.get("product")), "qty": it.get("qty"), "unit": it.get("unit"),
                     "content": it.get("content"), "content_unit": it.get("content_unit"), "expires": exp.isoformat() if exp else None,
                     "days_left": (exp - ctx.today).days if exp else None, "opened": it.get("opened"), "age": age,
                     "value": value, "over": over, "keeps": info.get("keeps_frozen") if fz else None})
    sort = f.get("sort") or "expiry"
    key = {"value": lambda r: -r["value"], "age": lambda r: -(r["age"] if r["age"] is not None else -1),
           "opened": lambda r: r["opened"] or "9999"}.get(sort, lambda r: r["expires"] or "9999")
    rows.sort(key=key)
    return {"filter": f, "count": len(rows), "products": len({r["product"] for r in rows}), "value": round(sum(r["value"] for r in rows), 2),
            "opened": sum(1 for r in rows if r["opened"]), "expired": sum(1 for r in rows if r["days_left"] is not None and r["days_left"] < 0),
            "by_storage": _top(Counter(r["storage"] for r in rows), 12), "by_category": _top(Counter(r["category"] for r in rows), 12),
            "items": rows[:200], "rows": rows}


def r_trips(ctx: _Ctx) -> dict:
    """Each shopping trip in the period: one day at one shop."""
    shops = ctx.food.data["shops"]
    trips: dict[tuple, dict] = {}
    for l in ctx.period(STATUS_BOUGHT, STATUS_ADDED):
        if not ctx.is_purchase(l):
            continue
        sh = (shops.get(l.get("shop") or "") or {}).get("name") or "Without a shop"
        k = (_day(l["ts"]), sh)
        t = trips.setdefault(k, {"date": k[0].isoformat(), "shop": sh, "items": 0, "total": 0.0, "names": Counter()})
        t["items"] += 1
        t["total"] = round(t["total"] + _value(l), 2)
        t["names"][ctx.name(l)] += 1
    out = sorted(trips.values(), key=lambda t: t["date"], reverse=True)
    for t in out:
        t["top"] = [n for n, _ in t.pop("names").most_common(3)]
    totals = [t["total"] for t in out if t["total"] > 0]
    by_shop = Counter()
    for t in out:
        by_shop[t["shop"]] += t["total"]
    return {"trips": out[:200], "count": len(out), "total": round(sum(totals), 2),
            "average": round(sum(totals) / len(totals), 2) if totals else 0, "biggest": max(totals, default=0),
            "items": sum(t["items"] for t in out), "by_shop": _top(by_shop),
            "rows": [{k: t[k] for k in ("date", "shop", "items", "total")} for t in out]}


def _span(ctx: _Ctx) -> tuple[date, date]:
    """The period's first and last day (all time: from the first log)."""
    start = ctx.since or min((_day(l["ts"]) for l in ctx.logs), default=ctx.today)
    return start, ctx.end


def _buckets(ctx: _Ctx) -> tuple[str, list[tuple[str, date, date]]]:
    """Weeks for up to about three months, months beyond: (label key, first day, last day) each."""
    start, end = _span(ctx)
    out = []
    if (end - start).days <= 100:
        d = _monday(start)
        while d <= end:
            out.append((d.isoformat(), d, d + timedelta(days=6)))
            d += timedelta(days=7)
        return "week", out
    d = date(start.year, start.month, 1)
    while d <= end:
        nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
        out.append((d.strftime("%Y-%m"), d, nxt - timedelta(days=1)))
        d = nxt
    return "month", out[-36:]


def _money_of(ctx: _Ctx, since: date | None, until: date | None) -> dict:
    sums = {"bought": 0.0, "used": 0.0, "thrown": 0.0}
    for l in ctx.logs:
        d = _day(int(l.get("ts") or 0))
        if since and d < since or until and d > until:
            continue
        st = l.get("status")
        if st in (STATUS_BOUGHT, STATUS_ADDED) and ctx.is_purchase(l):
            sums["bought"] += ctx.val(l)
        elif st == STATUS_CONSUMED:
            sums["used"] += ctx.val(l)
        elif st == STATUS_THROWN:
            sums["thrown"] += ctx.val(l)
    return {k: round(v, 2) for k, v in sums.items()}


def r_money(ctx: _Ctx) -> dict:
    """Food Money: what was bought, used and thrown in the period, in money."""
    start, end = _span(ctx)
    now = _money_of(ctx, ctx.since, ctx.until)
    # the same length of time just before, to compare
    before = None
    if ctx.since:
        length = (end - ctx.since).days + 1
        before = _money_of(ctx, ctx.since - timedelta(days=length), ctx.since - timedelta(days=1))
    kind, buckets = _buckets(ctx)
    series = []
    for key, a, b in buckets:
        m = _money_of(ctx, max(a, start), min(b, end))
        series.append({kind: key, **m})
    run = {"bought": 0.0, "used": 0.0, "thrown": 0.0}
    running = []
    for row in series:
        for k in run:
            run[k] = round(run[k] + row[k], 2)
        running.append({kind: row[kind], **run})
    at_home = round(sum(float(it.get("qty") or 0) * float(it.get("price") or (ctx.products.get(it.get("product")) or {}).get("price") or 0)
                        for it in ctx.items()), 2)
    # how much had no price at all (so isn't counted)
    unpriced = sum(1 for l in ctx.period(STATUS_BOUGHT, STATUS_CONSUMED, STATUS_THROWN) if ctx.val(l) == 0)
    eaten = now["used"] + now["thrown"]
    return {**now, "at_home": at_home, "waste_share": round(now["thrown"] / eaten * 100, 1) if eaten else 0,
            "before": before, "kind": kind, "series": series, "running": running, "unpriced": unpriced,
            "rows": [{kind: r[kind], "bought": r["bought"], "used": r["used"], "thrown": r["thrown"]} for r in series]}


def r_bin(ctx: _Ctx) -> dict:
    """Money in the Bin: what thrown-away food cost."""
    start, end = _span(ctx)
    thrown = ctx.period(STATUS_THROWN)
    total = round(sum(ctx.val(l) for l in thrown), 2)
    kind, buckets = _buckets(ctx)
    series = []
    for key, a, b in buckets:
        v = sum(ctx.val(l) for l in thrown if a <= _day(l["ts"]) <= b)
        n = sum(1 for l in thrown if a <= _day(l["ts"]) <= b)
        series.append({kind: key, "value": round(v, 2), "count": n})
    dear: dict[str, dict] = {}
    for l in thrown:
        k = ctx.name(l)
        x = dear.setdefault(k, {"name": k, "product": l.get("product") if l.get("product") in ctx.products else None, "value": 0.0, "count": 0})
        x["value"] = round(x["value"] + ctx.val(l), 2)
        x["count"] += 1
    dearest = sorted(dear.values(), key=lambda x: -x["value"])[:15]
    late = {"after": 0.0, "in": 0.0, "none": 0.0}
    for l in thrown:
        exp = _iso((l.get("snap") or {}).get("expires"))
        late["none" if not exp else "after" if _day(l["ts"]) > exp else "in"] += ctx.val(l)
    by_cat = Counter()
    for l in thrown:
        by_cat[ctx.cat(l.get("product"))] += ctx.val(l)
    span = max((end - start).days + 1, 30)
    return {"total": total, "count": len(thrown), "per_year": round(total / span * 365, 2), "per_month": round(total / span * 30.44, 2),
            "kind": kind, "series": series, "dearest": dearest, "late": {k: round(v, 2) for k, v in late.items()},
            "by_category": [{"name": k, "count": round(v, 2)} for k, v in by_cat.most_common(10) if v > 0],
            "unpriced": sum(1 for l in thrown if ctx.val(l) == 0),
            "rows": [{"date": _day(l["ts"]).isoformat(), "product": ctx.name(l), "qty": l.get("qty"), "value": ctx.val(l)} for l in thrown]}


def r_daily(ctx: _Ctx) -> dict:
    """Daily Cost: spending and eating per day and week, and the usual week."""
    start, end = _span(ctx)
    days = (end - start).days + 1
    per_day: dict[date, dict] = {start + timedelta(days=i): {"spent": 0.0, "used": 0.0, "thrown": 0.0} for i in range(days)}
    for l in ctx.logs:
        d = _day(int(l.get("ts") or 0))
        if d not in per_day:
            continue
        st = l.get("status")
        if st in (STATUS_BOUGHT, STATUS_ADDED) and ctx.is_purchase(l):
            per_day[d]["spent"] += ctx.val(l)
        elif st == STATUS_CONSUMED:
            per_day[d]["used"] += ctx.val(l)
        elif st == STATUS_THROWN:
            per_day[d]["thrown"] += ctx.val(l)
    spent = sum(x["spent"] for x in per_day.values())
    used = sum(x["used"] for x in per_day.values())
    # each day of the week: the average over the weeks in the period
    wk = [{"spent": 0.0, "used": 0.0, "n": 0} for _ in range(7)]
    for d, x in per_day.items():
        w = wk[d.weekday()]
        w["spent"] += x["spent"]; w["used"] += x["used"]; w["n"] += 1
    weekday = [{"spent": round(w["spent"] / w["n"], 2) if w["n"] else 0, "used": round(w["used"] / w["n"], 2) if w["n"] else 0} for w in wk]
    # whole weeks: the usual (middle) week's spend and eating
    weeks: dict[date, dict] = {}
    for d, x in per_day.items():
        w = weeks.setdefault(_monday(d), {"spent": 0.0, "used": 0.0})
        w["spent"] += x["spent"]; w["used"] += x["used"]
    full = [w for k, w in weeks.items() if k >= start and k + timedelta(days=6) <= end]
    def mid(vals):
        v = sorted(vals)
        return round((v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2), 2) if v else 0
    recent = sorted(per_day.items())[-60:]
    return {"days": days, "spent": round(spent, 2), "used": round(used, 2),
            "per_day": round(spent / days, 2) if days else 0, "used_per_day": round(used / days, 2) if days else 0,
            "per_week": round(spent / days * 7, 2) if days else 0, "used_per_week": round(used / days * 7, 2) if days else 0,
            "usual_week": mid([w["spent"] for w in full]), "usual_week_used": mid([w["used"] for w in full]), "full_weeks": len(full),
            "weekday": weekday,
            "daily": [{"date": d.isoformat(), "spent": round(x["spent"], 2), "used": round(x["used"], 2)} for d, x in recent],
            "rows": [{"date": d.isoformat(), "spent": round(x["spent"], 2), "used": round(x["used"], 2), "thrown": round(x["thrown"], 2)} for d, x in sorted(per_day.items())]}


SAVE_DAYS = 3      # used within this many days of its date: saved in time
FREEZE_DAYS = 7    # frozen with this many days or fewer left: saved by freezing


def _just_in_time(l: dict) -> bool:
    exp = _iso((l.get("snap") or {}).get("expires"))
    if l.get("status") != STATUS_CONSUMED or not exp:
        return False
    left = (exp - _day(int(l["ts"]))).days
    return 0 <= left <= SAVE_DAYS


def _frozen_in_time(ctx: _Ctx, l: dict) -> bool:
    if l.get("status") != STATUS_MOVED or not l.get("expires"):
        return False
    to, frm = ctx.food.data["storages"].get(l.get("storage")) or {}, ctx.food.data["storages"].get(l.get("from")) or {}
    if not _is_freezer(to) or _is_freezer(frm) or frm.get("kind") == KIND_LIST:
        return False
    left = (_iso(l["expires"]) - _day(int(l["ts"]))).days if _iso(l["expires"]) else -1
    return 0 <= left <= FREEZE_DAYS


def r_saved(ctx: _Ctx) -> dict:
    """Saved in Time: used in its last days, or frozen before it went off."""
    logs = [l for l in ctx.logs if ctx.in_period(l)]
    used = [l for l in logs if _just_in_time(l)]
    frozen = [l for l in logs if _frozen_in_time(ctx, l)]
    thrown = [l for l in logs if l.get("status") == STATUS_THROWN]
    kind, buckets = _buckets(ctx)
    series = []
    for key, a, b in buckets:
        u = [l for l in used if a <= _day(l["ts"]) <= b]
        z = [l for l in frozen if a <= _day(l["ts"]) <= b]
        series.append({kind: key, "used": round(sum(ctx.val(l) for l in u), 2), "frozen": round(sum(ctx.val(l) for l in z), 2), "count": len(u) + len(z)})
    top: dict[str, dict] = {}
    for l in used + frozen:
        k = ctx.name(l)
        x = top.setdefault(k, {"name": k, "product": l.get("product") if l.get("product") in ctx.products else None, "count": 0, "value": 0.0})
        x["count"] += 1
        x["value"] = round(x["value"] + ctx.val(l), 2)
    by_cat = Counter(ctx.cat(l.get("product")) for l in used + frozen)
    saved = round(sum(ctx.val(l) for l in used + frozen), 2)
    lost = round(sum(ctx.val(l) for l in thrown), 2)
    return {"saved": saved, "used_count": len(used), "frozen_count": len(frozen), "used_value": round(sum(ctx.val(l) for l in used), 2),
            "frozen_value": round(sum(ctx.val(l) for l in frozen), 2), "thrown_value": lost, "thrown_count": len(thrown),
            "kind": kind, "series": series, "top": sorted(top.values(), key=lambda x: (-x["count"], -x["value"]))[:15],
            "by_category": _top(by_cat), "save_days": SAVE_DAYS, "freeze_days": FREEZE_DAYS,
            "rows": [{"date": _day(l["ts"]).isoformat(), "product": ctx.name(l), "how": "frozen" if l["status"] == STATUS_MOVED else "used", "value": ctx.val(l)} for l in used + frozen]}


def _median(vals: list[float]) -> float | None:
    v = sorted(vals)
    if not v:
        return None
    m = len(v) // 2
    return float(v[m]) if len(v) % 2 else (v[m - 1] + v[m]) / 2


OPEN_BANDS = [("1–2 days", 0, 2), ("3–7 days", 3, 7), ("1–2 weeks", 8, 14), ("2–4 weeks", 15, 28), ("Over a month", 29, 10 ** 6)]


def r_opened(ctx: _Ctx) -> dict:
    """Open Too Long: from opening to finished (or thrown away)."""
    per: dict[str, dict] = {}
    bands = Counter()
    cats: dict[str, list[int]] = defaultdict(list)
    all_days = []
    for l in ctx.period(STATUS_CONSUMED, STATUS_THROWN):
        op = _iso((l.get("snap") or {}).get("opened"))
        if not op:
            continue
        n = max(0, (_day(l["ts"]) - op).days)
        all_days.append(n)
        pid = l.get("product") if l.get("product") in ctx.products else None
        x = per.setdefault(ctx.name(l), {"name": ctx.name(l), "product": pid, "days": [], "thrown": 0})
        x["days"].append(n)
        if l["status"] == STATUS_THROWN:
            x["thrown"] += 1
        cats[ctx.cat(l.get("product"))].append(n)
        bands[next(b for b, a, z in OPEN_BANDS if a <= n <= z)] += 1
    prods = []
    for x in per.values():
        prods.append({"name": x["name"], "product": x["product"], "count": len(x["days"]), "usual": _median(x["days"]),
                      "thrown": x["thrown"], "thrown_share": round(x["thrown"] / len(x["days"]) * 100) if x["days"] else 0})
    usual_of = {p["product"]: p["usual"] for p in prods if p["product"] and p["count"] >= 2}
    # thrown once opened: smaller packs might help
    smaller = sorted((p for p in prods if p["thrown"] >= 2 and p["thrown_share"] >= 40), key=lambda p: (-p["thrown"], -p["thrown_share"]))[:10]
    # open now, and open longer than it usually is
    now = []
    for it in ctx.items():
        op = _iso(it.get("opened"))
        if not op:
            continue
        n = (ctx.today - op).days
        u = usual_of.get(it.get("product"))
        now.append({"item": it["id"], "product": it.get("product"), "name": ctx.name(it), "storage": ctx.storage(it.get("storage")),
                    "days": n, "usual": u, "longer": bool(u is not None and n > max(u * 1.5, u + 3))})
    now.sort(key=lambda r: -r["days"])
    return {"count": len(all_days), "usual": _median(all_days), "thrown": sum(p["thrown"] for p in prods),
            "bands": [{"name": b, "count": bands[b]} for b, _, _ in OPEN_BANDS],
            "by_category": sorted(({"name": k, "count": round(_median(v), 1), "n": len(v)} for k, v in cats.items() if len(v) >= 2), key=lambda x: -x["count"])[:12],
            "slowest": sorted((p for p in prods if p["count"] >= 2), key=lambda p: -(p["usual"] or 0))[:12],
            "smaller": smaller, "open_now": now[:40], "open_longer": sum(1 for r in now if r["longer"]),
            "rows": [{k: p[k] for k in ("name", "count", "usual", "thrown")} for p in prods]}


def r_ranout(ctx: _Ctx) -> dict:
    """Ran Out: from running out at home to having some again (recorded as it happens)."""
    runs = [r for r in ctx.food.data.get("runouts", []) if r.get("product") in ctx.products and ctx.in_period(r)]
    per: dict[str, dict] = {}
    for r in runs:
        start = _day(int(r["ts"]))
        end = _day(int(r["back"])) if r.get("back") else ctx.today
        x = per.setdefault(r["product"], {"product": r["product"], "name": ctx.products[r["product"]]["name"], "times": 0, "gaps": [], "out": False})
        x["times"] += 1
        x["gaps"].append((end - start).days)
        if not r.get("back"):
            x["out"] = True
    prods = []
    for x in per.values():
        p = ctx.products[x["product"]]
        prods.append({"product": x["product"], "name": x["name"], "times": x["times"], "days_without": sum(x["gaps"]),
                      "usual_gap": _median(x["gaps"]), "out": x["out"], "min_qty": float(p.get("min_qty") or 0)})
    prods.sort(key=lambda x: (-x["times"], -x["days_without"]))
    # staples (bought three times or more) with none at home right now
    bought = Counter(l.get("product") for l in ctx.logs if l.get("status") in (STATUS_BOUGHT, STATUS_ADDED) and ctx.is_purchase(l))
    out_now = []
    for pid, n in bought.items():
        if n >= 3 and pid in ctx.products and ctx.food.stock(pid) <= 0:
            p = ctx.products[pid]
            out_now.append({"product": pid, "name": p["name"], "bought": n, "min_qty": float(p.get("min_qty") or 0),
                            "last_bought": _day(int(p["last_bought"])).isoformat() if p.get("last_bought") else None})
    out_now.sort(key=lambda x: -x["bought"])
    kind, buckets = _buckets(ctx)
    series = [{kind: key, "count": sum(1 for r in runs if a <= _day(int(r["ts"])) <= b)} for key, a, b in buckets]
    since = ctx.food.data.get("runouts_since")
    return {"times": len(runs), "products": len(prods), "days_without": sum(p["days_without"] for p in prods),
            "most": prods[:20], "no_minimum": [p for p in prods if p["times"] >= 2 and p["min_qty"] <= 0][:10],
            "out_now": out_now[:30], "kind": kind, "series": series, "recording_since": since,
            "rows": [{k: p[k] for k in ("name", "times", "days_without", "usual_gap")} for p in prods]}


def _year_numbers(ctx: _Ctx, year: int) -> dict:
    a, b = date(year, 1, 1), date(year, 12, 31)
    logs = [l for l in ctx.logs if a <= _day(int(l.get("ts") or 0)) <= b]
    used = [l for l in logs if l.get("status") == STATUS_CONSUMED]
    thrown = [l for l in logs if l.get("status") == STATUS_THROWN]
    bought = [l for l in logs if l.get("status") in (STATUS_BOUGHT, STATUS_ADDED) and ctx.is_purchase(l)]
    return {"logs": logs, "used": used, "thrown": thrown, "bought": bought,
            "used_n": len(used), "thrown_n": len(thrown), "bought_n": len(bought),
            "used_v": round(sum(ctx.val(l) for l in used), 2), "thrown_v": round(sum(ctx.val(l) for l in thrown), 2),
            "spent": round(sum(ctx.val(l) for l in bought), 2)}


def r_year(ctx: _Ctx, year: int | None) -> dict:
    """Your Year in Food."""
    years = sorted({_day(int(l["ts"])).year for l in ctx.logs if l.get("ts")}, reverse=True) or [ctx.today.year]
    # in January, last year (it's just finished); otherwise this year so far
    default = ctx.today.year - 1 if ctx.today.month == 1 and (ctx.today.year - 1) in years else ctx.today.year
    year = int(year) if year else (default if default in years else years[0])
    y = _year_numbers(ctx, year)
    prev = _year_numbers(ctx, year - 1) if (year - 1) in years else None
    months = []
    for m in range(1, 13):
        u = sum(1 for l in y["used"] if _day(l["ts"]).month == m)
        t = sum(1 for l in y["thrown"] if _day(l["ts"]).month == m)
        months.append({"month": f"{year}-{m:02d}", "consumed": u, "thrown": t,
                       "share": round(t / (u + t) * 100, 1) if u + t else None,
                       "spent": round(sum(ctx.val(l) for l in y["bought"] if _day(l["ts"]).month == m), 2)})
    busy = [x for x in months if x["consumed"] + x["thrown"] >= 5]
    best = min(busy, key=lambda x: x["share"], default=None)
    worst = max(busy, key=lambda x: x["share"], default=None)
    top_used = _top(Counter(ctx.name(l) for l in y["used"]), 10)
    top_thrown = _top(Counter(ctx.name(l) for l in y["thrown"]), 5)
    picks = [l for l in y["logs"] if ctx.purpose(l) == PURPOSE_EAT and l.get("status") in (STATUS_PICKED, STATUS_BOUGHT)]
    top_picks = _top(Counter(ctx.name(l) for l in picks), 5)
    cats = Counter(ctx.cat(l.get("product")) for l in y["used"])
    wd = Counter(_day(l["ts"]).weekday() for l in y["used"])
    shops = {(l.get("shop") or "") for l in y["bought"] if l.get("shop")}
    first_seen: dict[str, date] = {}
    for l in ctx.logs:
        if l.get("product") and l.get("status") in (STATUS_ADDED, STATUS_BOUGHT, STATUS_CONSUMED):
            d = _day(int(l["ts"]))
            if l["product"] not in first_seen or d < first_seen[l["product"]]:
                first_seen[l["product"]] = d
    new = sum(1 for d in first_seen.values() if d.year == year)
    saved = [l for l in y["logs"] if _just_in_time(l) or _frozen_in_time(ctx, l)]
    eaten = y["used_n"] + y["thrown_n"]
    pid_of = {}
    for l in y["used"] + y["thrown"] + picks:
        if l.get("product") in ctx.products:
            pid_of.setdefault(ctx.name(l), l["product"])
    with_pid = lambda lst: [{**x, "product": pid_of.get(x["name"])} for x in lst]  # noqa: E731
    return {"year": year, "years": years, "partial": year == ctx.today.year,
            "used": y["used_n"], "thrown": y["thrown_n"], "bought": y["bought_n"], "used_value": y["used_v"], "thrown_value": y["thrown_v"],
            "spent": y["spent"], "waste_share": round(y["thrown_n"] / eaten * 100, 1) if eaten else 0,
            "saved": len(saved), "saved_value": round(sum(ctx.val(l) for l in saved), 2), "new_products": new, "shops": len(shops),
            "picks": len(picks), "months": months, "best_month": best, "worst_month": worst,
            "top_used": with_pid(top_used), "top_thrown": with_pid(top_thrown), "top_picks": with_pid(top_picks),
            "favourite_category": cats.most_common(1)[0][0] if cats else None, "by_category": _top(cats, 8),
            "busiest_day": wd.most_common(1)[0][0] if wd else None,
            "before": {k: prev[k] for k in ("used_n", "thrown_n", "bought_n", "spent", "thrown_v")} if prev else None,
            "rows": [{k: m[k] for k in ("month", "consumed", "thrown", "spent")} for m in months]}


SEASON_MONTHS = {"Winter": (12, 1, 2), "Spring": (3, 4, 5), "Summer": (6, 7, 8), "Autumn": (9, 10, 11)}


def r_seasons(ctx: _Ctx) -> dict:
    """Food Through the Year: everything used, by month of the year (all years together)."""
    used = [l for l in ctx.logs if l.get("status") == STATUS_CONSUMED or (l.get("status") == STATUS_PICKED and l.get("used"))]
    # how many of each month there's history for (so a month seen twice isn't counted as twice as busy)
    seen = defaultdict(set)
    for l in ctx.logs:
        d = _day(int(l.get("ts") or 0))
        seen[d.month].add(d.year)
    n_years = {m: max(1, len(seen[m])) for m in range(1, 13)}
    top_cats = [c for c, _ in Counter(ctx.cat(l.get("product")) for l in used).most_common(5)]
    months = []
    for m in range(1, 13):
        ml = [l for l in used if _day(l["ts"]).month == m]
        c = Counter(ctx.cat(l.get("product")) if ctx.cat(l.get("product")) in top_cats else "Other" for l in ml)
        top = Counter(ctx.name(l) for l in ml).most_common(1)
        months.append({"month": m, "count": round(len(ml) / n_years[m], 1), "years": len(seen[m]),
                       **{f"c{i}": round(c[cat] / n_years[m], 1) for i, cat in enumerate(top_cats)}, "other": round(c["Other"] / n_years[m], 1),
                       "top": top[0][0] if top else None})
    # each season's favourites: used noticeably more then than the rest of the year
    per_prod: dict[str, Counter] = defaultdict(Counter)
    pid_of = {}
    for l in used:
        nm = ctx.name(l)
        per_prod[nm][_day(l["ts"]).month] += 1
        if l.get("product") in ctx.products:
            pid_of.setdefault(nm, l["product"])
    seasons = []
    for sname, ms in SEASON_MONTHS.items():
        span = sum(n_years[m] for m in ms) / 3
        favs = []
        for nm, c in per_prod.items():
            total = sum(c.values())
            if total < 4:
                continue
            in_s = sum(c[m] for m in ms) / max(span, 1)
            rest = sum(v for m, v in c.items() if m not in ms) / max(sum(n_years[m] for m in range(1, 13) if m not in ms) / 9, 1)
            rate_in, rate_rest = in_s / 3, rest / 9
            if in_s >= 2 and rate_in >= max(rate_rest * 1.6, 0.34):
                favs.append({"name": nm, "product": pid_of.get(nm), "times": round(in_s, 1), "more": round(rate_in / rate_rest, 1) if rate_rest else None})
        favs.sort(key=lambda x: (-(x["more"] or 99), -x["times"]))
        seasons.append({"season": sname, "count": round(sum(months[m - 1]["count"] for m in ms), 1), "favourites": favs[:6]})
    return {"months": months, "categories": top_cats, "seasons": seasons, "years": sorted({y for v in seen.values() for y in v}),
            "rows": [{"month": m["month"], "count": m["count"], "top": m["top"]} for m in months]}


def r_people(ctx: _Ctx, names: dict[str, str]) -> dict:
    per: dict[str, Counter] = defaultdict(Counter)
    for l in ctx.period(STATUS_CONSUMED, STATUS_THROWN, STATUS_BOUGHT, STATUS_ADDED):
        st = l["status"]
        if st in (STATUS_BOUGHT, STATUS_ADDED):
            if not ctx.is_purchase(l):
                continue
            st = STATUS_BOUGHT
        per[l.get("user") or "imported"][st] += 1
    people = sorted(({"user": k, "name": "Not recorded" if k == "imported" else names.get(k, "Someone"),
                      "consumed": v[STATUS_CONSUMED], "thrown": v[STATUS_THROWN], "bought": v[STATUS_BOUGHT]}
                     for k, v in per.items()), key=lambda x: -(x["consumed"] + x["thrown"] + x["bought"]))
    return {"people": people, "rows": [{k: p[k] for k in ("name", "consumed", "thrown", "bought")} for p in people]}


def r_drill(ctx: _Ctx, f: dict, names: dict[str, str]) -> dict:
    """The details behind a tapped bar, row or tile. Filters (all optional): statuses, product (id), user (id or
    "imported"), person (a name, as reports show it), category, storage and shop (names), since and until (dates)."""
    statuses = [s for s in (f.get("statuses") or []) if isinstance(s, str)] or [STATUS_CONSUMED, STATUS_THROWN, STATUS_BOUGHT]
    meals = bool(f.get("meals"))   # Meal Picks: what came off a list for eating (picked, or imported as bought)
    if meals:
        statuses = [STATUS_PICKED, STATUS_BOUGHT]
    # bought: off a list for buying, or added from a receipt (with a price or a shop)
    buying = STATUS_BOUGHT in statuses and not meals
    if buying and STATUS_ADDED not in statuses:
        statuses = [*statuses, STATUS_ADDED]
    since, until = _iso(f.get("since")), _iso(f.get("until"))
    shops = ctx.food.data["shops"]
    who = lambda l: "Not recorded" if not l.get("user") else names.get(l["user"], "Someone")  # noqa: E731
    shop_name = lambda l: (shops.get(l.get("shop") or "") or {}).get("name") or "Without a shop"  # noqa: E731

    def keep(l: dict) -> bool:
        if l.get("status") not in statuses:
            return False
        if l.get("status") == STATUS_ADDED and not (buying and ctx.is_purchase(l)) and STATUS_ADDED not in (f.get("statuses") or []):
            return False
        if meals != (ctx.purpose(l) == PURPOSE_EAT) and (meals or l.get("status") == STATUS_BOUGHT):
            return False   # Meal Picks only from lists for eating; buying never from them
        d = _day(int(l.get("ts") or 0))
        if since and d < since or until and d > until:
            return False
        if not since and not until and not ctx.in_period(l):
            return False
        if f.get("product") and l.get("product") != f["product"]:
            return False
        if f.get("user") and (l.get("user") or "imported") != f["user"]:
            return False
        if f.get("person") and who(l) != f["person"]:
            return False
        if f.get("category") and ctx.cat(l.get("product")) != f["category"]:
            return False
        if f.get("storage") and ctx.storage(l.get("storage")) != f["storage"]:
            return False
        if f.get("shop") and shop_name(l) != f["shop"]:
            return False
        if f.get("late"):
            exp = _iso((l.get("snap") or {}).get("expires"))
            band = "none" if not exp else "after" if d > exp else "in"
            if band != f["late"]:
                return False
        if f.get("used") and not (l.get("status") == STATUS_PICKED and l.get("used")):
            return False
        if f.get("saved") and not _just_in_time(l):
            return False
        if f.get("frozen") and not _frozen_in_time(ctx, l):
            return False
        if f.get("rescued") and not (_just_in_time(l) or _frozen_in_time(ctx, l)):
            return False
        if f.get("opened") and not (l.get("snap") or {}).get("opened"):
            return False
        return True

    logs = sorted(({**l, "status": STATUS_BOUGHT} if l.get("status") == STATUS_ADDED and buying and ctx.is_purchase(l) and STATUS_ADDED not in (f.get("statuses") or []) else l
                   for l in ctx.logs if keep(l)), key=lambda l: -int(l.get("ts") or 0))
    count = Counter(l["status"] for l in logs)
    value = defaultdict(float)
    for l in logs:
        value[l["status"]] += ctx.val(l)
    # weeks across the span shown (each Monday), so the chart has no gaps
    start = since or ctx.since or (min((_day(l["ts"]) for l in logs), default=ctx.today))
    end = until or ctx.today
    weeks: dict[date, dict] = {}
    w = _monday(start)
    while w <= end and len(weeks) < 120:
        weeks[w] = {"week": w.isoformat(), "consumed": 0, "thrown": 0, "bought": 0, "picked": 0, "moved": 0}
        w += timedelta(days=7)
    for l in logs:
        k = _monday(_day(l["ts"]))
        if k in weeks and l["status"] in weeks[k]:
            weeks[k][l["status"]] += 1
    prods: Counter = Counter()
    pid_of: dict[str, str] = {}
    for l in logs:
        n = ctx.name(l)
        prods[n] += 1
        if l.get("product") in ctx.products:
            pid_of.setdefault(n, l["product"])

    def entry(l: dict) -> dict:
        return {"ts": l.get("ts"), "date": _day(int(l["ts"])).isoformat(), "status": l["status"], "name": ctx.name(l),
                "product": l.get("product") if l.get("product") in ctx.products else None,
                "qty": l.get("qty"), "unit": l.get("unit"), "storage": ctx.storage(l.get("storage")), "person": who(l),
                "shop": shop_name(l) if l["status"] == STATUS_BOUGHT and l.get("shop") else "", "value": _value(l)}

    # each month too (for long spans), up to two years, oldest first
    months: dict[str, dict] = {}
    mstart = date(start.year, start.month, 1)
    if (end - mstart).days > 731:
        mstart = date(end.year - 2, end.month, 1)
    m = mstart
    while m <= end:
        months[m.strftime("%Y-%m")] = {"month": m.strftime("%Y-%m"), "consumed": 0, "thrown": 0, "bought": 0, "picked": 0, "moved": 0, "spent": 0.0}
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    for l in logs:
        k = _day(l["ts"]).strftime("%Y-%m")
        if k in months and l["status"] in months[k]:
            months[k][l["status"]] += 1
            if l["status"] == STATUS_BOUGHT:
                months[k]["spent"] = round(months[k]["spent"] + _value(l), 2)
    # day by day, for a short span (a month or less)
    days_s = []
    if (end - start).days <= 45:
        per = defaultdict(Counter)
        for l in logs:
            per[_day(l["ts"])][l["status"]] += 1
        x = start
        while x <= end:
            days_s.append({"date": x.isoformat(), **{k: per[x][k] for k in (STATUS_CONSUMED, STATUS_THROWN, STATUS_BOUGHT, STATUS_PICKED, STATUS_MOVED)}})
            x += timedelta(days=1)
    # thrown away after its date: how late
    late = Counter()
    for l in logs:
        if l["status"] != STATUS_THROWN:
            continue
        exp = _iso((l.get("snap") or {}).get("expires"))
        if exp and _day(l["ts"]) > exp:
            n = (_day(l["ts"]) - exp).days
            late["1–3 days late" if n <= 3 else "4–7 days late" if n <= 7 else "1–4 weeks late" if n <= 28 else "Over a month late"] += 1
    late_order = ["1–3 days late", "4–7 days late", "1–4 weeks late", "Over a month late"]
    # buying: the price each time (oldest first), how often (the usual gap) and when last
    bought = sorted((l for l in logs if l["status"] == STATUS_BOUGHT), key=lambda l: l["ts"])
    prices = [{"date": _day(l["ts"]).isoformat(), "price": float(l["price"]), "shop": shop_name(l)}
              for l in bought if float(l.get("price") or 0) > 0]
    bdays = sorted({_day(l["ts"]) for l in bought} | {_day(int(l["first"])) for l in bought if l.get("first")})
    gaps = sorted((b - a).days for a, b in zip(bdays, bdays[1:]))
    every = None
    if len(gaps) >= 2:
        mid = len(gaps) // 2
        every = float(gaps[mid]) if len(gaps) % 2 else (gaps[mid - 1] + gaps[mid]) / 2
    return {
        "filter": {k: v for k, v in f.items() if k != "title"}, "count": len(logs),
        "months": list(months.values()), "prices": prices[-60:], "every_days": every, "days": days_s,
        "how_late": [{"name": k, "count": late[k]} for k in late_order if late[k]],
        "last_bought": bdays[-1].isoformat() if bdays else None,
        "first_bought": bdays[0].isoformat() if bdays else None,
        "consumed": count[STATUS_CONSUMED], "thrown": count[STATUS_THROWN], "bought": count[STATUS_BOUGHT],
        "picked": count[STATUS_PICKED], "added": count[STATUS_ADDED], "moved": count[STATUS_MOVED],
        "value_thrown": round(value[STATUS_THROWN], 2), "spent": round(value[STATUS_BOUGHT], 2), "value_used": round(value[STATUS_CONSUMED], 2),
        "weeks": list(weeks.values()),
        "top": [{"name": k, "count": v, "product": pid_of.get(k)} for k, v in prods.most_common(10)],
        "by_category": _top(Counter(ctx.cat(l.get("product")) for l in logs)),
        "by_storage": _top(Counter(ctx.storage(l.get("storage")) for l in logs)),
        "by_person": _top(Counter(who(l) for l in logs)),
        "by_shop": _top(Counter(shop_name(l) for l in logs if l["status"] == STATUS_BOUGHT)),
        "entries": [entry(l) for l in logs[:150]],
        "rows": [entry(l) for l in logs],
    }


def r_product(ctx: _Ctx, pid: str | None) -> dict:
    if not pid or pid not in ctx.products:
        raise FoodError("not_found", "That product doesn’t exist any more.")
    p = ctx.products[pid]
    logs = sorted((l for l in ctx.logs if l.get("product") == pid), key=lambda l: l["ts"])
    months: dict[str, dict] = {}
    m = date(ctx.today.year, ctx.today.month, 1)
    for _ in range(12):
        months[m.strftime("%Y-%m")] = {"month": m.strftime("%Y-%m"), "consumed": 0, "thrown": 0, "bought": 0}
        m = date(m.year - (m.month == 1), (m.month - 2) % 12 + 1, 1)
    last_in = None
    waits = []
    prices = []
    for l in logs:
        key = _day(l["ts"]).strftime("%Y-%m")
        st = l.get("status")
        if key in months and st in (STATUS_CONSUMED, STATUS_THROWN, STATUS_BOUGHT):
            months[key][st] += 1
        if st in (STATUS_BOUGHT, STATUS_ADDED):
            last_in = _day(l["ts"])
            if st == STATUS_BOUGHT and float(l.get("price") or 0) > 0:
                prices.append({"date": last_in.isoformat(), "price": float(l["price"])})
        elif st == STATUS_CONSUMED and last_in:
            waits.append((_day(l["ts"]) - last_in).days)
    c = sum(1 for l in logs if l.get("status") == STATUS_CONSUMED)
    t = sum(1 for l in logs if l.get("status") == STATUS_THROWN)
    series = list(reversed(months.values()))
    return {
        "product": pid, "name": p.get("name", ""), "category": ctx.cat(pid),
        "consumed": c, "thrown": t, "thrown_pct": round(t * 100 / (c + t), 1) if c + t else 0,
        "bought": sum(1 for l in logs if l.get("status") == STATUS_BOUGHT),
        "wait_days": round(sum(waits) / len(waits), 1) if waits else None,
        "months": series, "prices": prices[-24:], "stock": round(ctx.food.stock(pid), 2),
        "shops": ctx.food.shop_prices(pid),
        "rows": series,
    }


async def async_report(food: CrowFood, user, name: str, days: int | None = None, month: str | None = None,
                       product_id: str | None = None, filt: dict | None = None, since: str | None = None,
                       until: str | None = None, year: int | None = None) -> dict:
    if name not in NAMES:
        raise FoodError("bad", "Unknown report.")
    timeless = name in ("month", "habits", "meals", "items", "stock", "expiry", "freezer", "product", "year", "seasons")
    # chosen dates (this month, last year, from–to) instead of the last N days
    d_since, d_until = (None, None) if timeless else (_iso(since), _iso(until))
    if d_since and d_until and d_until < d_since:
        d_since, d_until = d_until, d_since
    ctx = _Ctx(food, user.id, None if timeless else days, d_since, d_until)
    if name == "month":
        out = r_month(ctx, month)
    elif name in ("waste", "people", "drill"):
        names = {u["id"]: u["name"] for u in await food.async_users()}
        out = r_waste(ctx, names) if name == "waste" else r_people(ctx, names) if name == "people" else r_drill(ctx, filt or {}, names)
    elif name == "items":
        out = r_items(ctx, filt or {})
    else:
        out = {"saved": r_saved, "opened": r_opened, "ranout": r_ranout, "seasons": r_seasons, "year": lambda c: r_year(c, year),
               "money": r_money, "bin": r_bin, "daily": r_daily, "trips": r_trips, "use": r_use, "spending": r_spending, "habits": r_habits, "meals": r_meals, "stock": r_stock, "expiry": r_expiry,
               "freezer": r_freezer}.get(name, lambda c: None)(ctx) if name != "product" else r_product(ctx, product_id)
    out["report"] = name
    out["period_days"] = None if d_since else days
    if d_since:
        out["period_since"], out["period_until"] = d_since.isoformat(), ctx.end.isoformat()
    out["today"] = ctx.today.isoformat()
    out["currency"] = food.settings.get("currency") or food.hass.config.currency or ""
    return out
