# Crow Food

Crow Food is a Home Assistant integration and Dashboard Card for keeping track of the food in your home. The card gives you your storages (Pantry, Fridge, Freezer and any others, nested if you like), shopping lists grouped by shop with running totals, and smart lists of what's open, what's expiring, what's expired and what's running low — while the integration keeps everything on your own Home Assistant server, sends a daily reminder to the phones you choose and gives your automations sensors, to-do lists and actions.

Everything is **private to your household** — products, photos and history are stored by the integration on your Home Assistant server, never in the cloud.

> **One download installs both.** The card is bundled inside the integration and is loaded into your dashboards automatically — there's no separate resource to add.

> **AI features are optional and off by default.** Turn on **AI Features** in the card editor to unlock them — they use the AI Task you've already set up in Home Assistant. With AI off, everything else in the card works as normal.

![Home Assistant](https://img.shields.io/badge/Home%20Assistant-2025.8+-blue)
![Marketplace](https://img.shields.io/badge/Marketplace-Custom-orange)

**Step 1 — Add the repository to the Marketplace:**

[![Open your Home Assistant instance and add this repository to the Marketplace.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jamesmcginnis&repository=crow-food&category=integration)

**Step 2 — After downloading and restarting, add the integration:**

[![Open your Home Assistant instance and start setting up Crow Food.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=crow_food)

**Step 3 — Add the card to a dashboard:**

[![Open your Home Assistant instance and show your dashboards.](https://my.home-assistant.io/badges/lovelace_dashboards.svg)](https://my.home-assistant.io/redirect/lovelace_dashboards/)

Open a dashboard, click **Edit** → **+ Add Card** and search for **Crow Food**.

---

## Installation

### Via the Marketplace (Recommended)

1. Click the **Add to Marketplace** button above, or in Home Assistant open **Settings → Marketplace** and add a custom repository
2. Add `https://github.com/jamesmcginnis/crow-food` as an **Integration** repository, then close
3. Search for **Crow Food** and click **Download**
4. **Restart Home Assistant**
5. Click the **Add Integration** button above, or go to **Settings → Devices & Services → + Add Integration** and search for **Crow Food**
6. Click **Submit** — there's nothing to fill in, everything else is set from the card
7. Hard-refresh your browser (Cmd+Shift+R on Mac) or close and reopen the Home Assistant app on your iPhone
8. Click the **Add Card** button above, edit a dashboard, click **+ Add Card** and search for **Crow Food**

> **On Home Assistant 2026.10 or older?** The Marketplace was called **HACS** before 2026.11. The steps are the same: open **HACS** → **⋮ menu** (top right) → **Custom repositories** instead.

### Manual

1. Download this repository from [Releases](../../releases/latest)
2. Copy the `custom_components/crow_food` folder into `/config/custom_components/` on your Home Assistant instance
3. Restart Home Assistant, then add the integration under **Settings → Devices & Services → + Add Integration**
4. Hard-refresh your browser and add the **Crow Food** card to a dashboard

> **Tip:** Crow Food works best on a dashboard of its own with a **Panel** view. On any other dashboard, choose **Full Screen** in the **⋯** menu in the top-right corner to give the card the whole screen.

---

## Key Features

- **Overview** — a Today line (what to use today, what's running low, what's gone off), the numbers for Use Soon, Open, Gone Off, Running Low and Everything, **Coming Up** (photos of what goes off today, tomorrow, this week and later), then your storages and lists as tiles. Each storage tile shows how fresh things are inside, and any sensors you've given it
- **Freshness at a glance** — a coloured edge on every item (green fresh, yellow use soon, orange today, red gone off), with a word only when it's soon, and a small picture of whoever added it. Storages group by freshness to start with
- **Item page** — tap something at home for a big photo, a freshness ring, one row of actions (Consumed, Thrown, Open, Freeze, Buy) and folding sections: where it is in your kitchen, how long it keeps, and its history
- **Sensors on storages** — give a storage a temperature sensor and a door sensor (Edit → Sensors) and its tile and page show the reading, and when the door's open
- **Ask** — the speech bubble at the top answers “Do we have tuna?” and the like straight away, even with the AI off
- **Storages** — as many as you like, with their own colour and icon, nested up to three deep, shared with everyone or only some people
- **Smart lists** — All, Open, Soon to be Expired, Expired, Soon to Run Out and Not Bought Lately
- **Not Bought Lately** — products nobody has bought or used for a while (6 months to start with), highlighted on the Overview with a note to the phones you choose; swipe right to Keep, left to Delete (with Undo), or Select several from the ⋯ menu
- **Shopping lists** — grouped by shop with running totals, a Bought section and **Put Away**, which sends everything back to where it usually lives
- **Shopping and Basket** — every household has a Shopping list (for buying) and a Basket (for choosing what to eat). They can't be renamed, changed or deleted; lists you make yourself can
- **Products** — photos, barcodes, categories, tags, package sizes, prices, links, notes and a minimum quantity
- **Swipes** — swipe left for Edit and Delete, swipe right to mark something consumed (or bought, on a shopping list)
- **Press and hold** — Consumed, Thrown, Move, Min quantity, Open, Buy, Print label, Edit, History, Delete and Ask AI
- **Barcode scanning** — with the phone's camera (including the iPhone), new barcodes looked up on Open Food Facts by Home Assistant
- **PDFs** — printable lists and labels (A4 sheets of 21)
- **Daily reminder** — expiring, expired and running-low food, sent to the phones of the people you choose
- **Buttons on the notes** — press and hold a note on an iPhone (or look under it on Android): **Freeze them** moves what should be frozen today into the freezer (after you unlock), **Meal ideas** opens Use It Up, and **Add to Shopping…** lets you type things straight onto the Shopping list (on every note)
- **Sensors, to-do lists and actions** — for automations and Assist
- **Classic or Glass** — light or dark, with your own accent colour
- **Full Screen** — from the ⋯ menu, or straight away when the dashboard opens

---

## Using the Card

| To… | Do this |
|---|---|
| Open a storage, list or smart list | Tap it on the Overview |
| Add something | Tap **+**, or scan a barcode with the button in the search bar |
| Use something up | Swipe it right, or press and hold → **Consumed** |
| Throw something away | Press and hold → **Thrown** |
| Use part of something | Press and hold → **Consumed** (when there's more than one) and choose how much |
| Edit or delete | Swipe left, or tap it |
| Move it to another storage | Press and hold → **Move** |
| Mark one packet opened | Press and hold → **Open** |
| Add it to a shopping list | Press and hold → **Buy** |
| Add to a shopping list | Type in its search bar and tap a product (or **Add “…”** for a new one) |
| Mark something bought | Swipe it right on the shopping list |
| Put the shopping away | **Put Away** in the Bought section, or the list's ⋯ menu |
| Change who can see a storage | The people button at the top of the storage, or press and hold it on the Overview → **Share** |
| Sort or group a storage | Its ⋯ menu → **Sort** or **Group** |
| Print a list or labels | The share button at the top, or the ⋯ menu → **Export** |

---

## Card Editor

The editor is laid out as a list of pages, each with **This Card** settings (only this card on this dashboard) and **Household** settings (saved in Home Assistant when you save the dashboard, used by every card and phone; only administrators can change them).

| Page | What's there |
|---|---|
| **General** | Startup screen, reopen where you left off, Full Screen in the ⋯ menu, start in full screen, Classic or Glass, glass strength, light/dark, Home Assistant theme, accent colour, glass popups and bars, card height, animations, vibration |
| **Overview** | Consumed & Thrown, which smart lists show, sections; *Household:* how far ahead Soon to be Expired looks, currency |
| **Storages & Lists** | Photos, tags, links, grouping, sorting, full swipes, asking before deleting; *Household:* shopping lists as to-do lists (off to start with), Open Food Facts, how long history is kept |
| **Reminders** | *Household:* who gets the daily reminder, what time, and what about |
| **AI** | *Household:* AI Features, which AI Task, and each feature |
| **Import & Backups** | *Household:* import and export CSV, nightly backups and restoring them |
| **Reset This Card** | Put this card's settings back to how they started |

---

## AI Features Setup (Optional)

1. Add an AI integration that has an **AI Task** (for example Google Generative AI or OpenAI) under **Settings → Devices & Services**
2. In the card editor, open **AI**, switch on **AI Features** and choose the AI Task (or leave it on Home Assistant's choice)
3. Save the dashboard

| Feature | What it does |
|---|---|
| **Best-Before Estimate** | A ✦ button by Expiration date guesses a sensible date from the product, where it's kept and whether it's open |
| **Category & Tags** | A ✦ button by Category suggests a category and tags |
| **Photo to Product** | Photograph a packet: its name, size and best-before date are read from it (needs an AI that can look at photos) |
| **Use It Up** | The Overview's ⋯ menu: what to eat first, with ideas |
| **Shopping Suggestions** | A shopping list's ⋯ menu: things you usually buy that are running low |
| **Ask AI** | Questions about what's in the house |

AI Tasks have no access to your devices, so nothing in the house can be switched on or off by them.

---

## Sensors

| Entity | State |
|---|---|
| `sensor.crow_food_in_storage` | Everything in your storages (with the items as an attribute) |
| `sensor.crow_food_open` | Opened |
| `sensor.crow_food_soon_to_be_expired` | Expiring within the Soon to be Expired days |
| `sensor.crow_food_expired` | Past their date |
| `sensor.crow_food_soon_to_run_out` | Products at or below their minimum quantity |
| `sensor.crow_food_not_bought_lately` | Products not bought or used for the chosen months |
| `sensor.crow_food_consumed` | The percentage eaten rather than thrown away |
| `sensor.crow_food_<storage>` | One for each storage and shopping list |

With **Shopping Lists as To-do Lists** on, each shopping list is also a `todo.` entity.

**Something's running low** is on while any product is at or below its minimum. Its `items` attribute lists each one with `name`, `left` and `minimum`. There's no sensor per product; for automations about one product, use the events:

| Event | When | Data |
|---|---|---|
| `crow_food_running_low` | A product reaches its minimum | `product_id`, `name`, `left`, `minimum`, `unit` |
| `crow_food_back_in_stock` | It goes back above its minimum | `product_id`, `name`, `left`, `minimum`, `unit` |

```yaml
trigger:
  - platform: event
    event_type: crow_food_running_low
    event_data:
      name: Milk
```

To stop watching products, Soon to Run Out ⋯ → **Clear Minimums**.

---

## Actions

| Action | What it does |
|---|---|
| `crow_food.add` | Adds something to a storage (by name or barcode) |
| `crow_food.consume` | Uses something up, opened packets and the soonest date first (or throws it away) |
| `crow_food.add_to_shopping_list` | Adds a product to a shopping list |
| `crow_food.send_reminder` | Sends today's reminder now |
| `crow_food.backup` | Backs everything up now |

Events: `crow_food_changed` (whenever anything changes) and `crow_food_low_stock` (a product has reached its minimum quantity).

```yaml
action: crow_food.add
data:
  name: Lurpak Spreadable 400g
  storage: Fridge
  quantity: 2
  expires: "2026-12-04"
```

---

## Where Things Are Kept

- Everything: `/config/.storage/crow_food.data` (household settings in `crow_food.settings`)
- Product photos: `/config/crow_food/photos` (served only through links Crow Food signs itself — not `/config/www`, which is public)
- Nightly backups: `/config/crow_food/backups`

---

## Building the Card

The readable card files are in `source/`. Edit them there, then:

```bash
cd source
npm install
npm run build
```

This minifies them into `custom_components/crow_food/www` with compressed copies beside them. The barcode scanner includes [ZXing](https://github.com/zxing-js/library) (Apache 2.0, `source/vendor/ZXING-LICENSE`).

---

## Licence

Proprietary — see [LICENSE.md](LICENSE.md).
