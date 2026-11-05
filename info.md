# Crow Food

Crow Food is a Home Assistant integration and Dashboard Card for keeping track of the food in your home. The card gives you your storages (Pantry, Fridge, Freezer and any others, nested if you like), shopping lists grouped by shop with running totals, and smart lists of what's open, what's expiring, what's expired and what's running low — while the integration keeps everything on your own Home Assistant server, sends a daily reminder to the phones you choose and gives your automations sensors, to-do lists and actions.

Everything is **private to your household** — products, photos and history are stored by the integration on your Home Assistant server, never in the cloud.

> **One download installs both.** The card is bundled inside the integration and is loaded into your dashboards automatically — there's no separate resource to add.

> **AI features are optional and off by default.** Turn on **AI Features** in the card editor to unlock them — they use the AI Task you've already set up in Home Assistant. With AI off, everything else in the card works as normal.

**Step 1 — Add the repository to the Marketplace:**

[![Open your Home Assistant instance and add this repository to the Marketplace.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=jamesmcginnis&repository=crow-food&category=integration)

**Step 2 — After downloading and restarting, add the integration:**

[![Open your Home Assistant instance and start setting up Crow Food.](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=crow_food)

**Step 3 — Add the card to a dashboard:**

[![Open your Home Assistant instance and show your dashboards.](https://my.home-assistant.io/badges/lovelace_dashboards.svg)](https://my.home-assistant.io/redirect/lovelace_dashboards/)

Open a dashboard, click **Edit** → **+ Add Card** and search for **Crow Food**.

## Key Features

- **Overview** — Consumed and Thrown percentages, Smart lists, Shopping lists and Storages, each section folding away
- **Storages** — as many as you like, with their own colour and icon, nested up to three deep, shared with everyone or only some people
- **Smart lists** — All, Open, Soon to be Expired, Expired, Soon to Run Out and Not Bought Lately
- **Shopping lists** — grouped by shop with running totals, a Bought section and **Put Away**, which sends everything back to where it usually lives
- **Products** — photos, barcodes, categories, tags, package sizes, prices, links, notes and a minimum quantity
- **Swipes** — swipe left for Edit and Delete, swipe right to mark something consumed (or bought, on a shopping list)
- **Press and hold** — Consumed, Thrown, Move, Min quantity, Open, Buy, Print label, Edit, History, Delete and Ask AI
- **Barcode scanning** — with the phone's camera (including the iPhone), new barcodes looked up on Open Food Facts by Home Assistant
- **PDFs** — printable lists and labels (A4 sheets of 21)
- **Daily reminder** — expiring, expired and running-low food, sent to the phones of the people you choose
- **Sensors, to-do lists and actions** — for automations and Assist
- **Classic or Glass** — light or dark, with your own accent colour
- **Full Screen** — from the ⋯ menu, or straight away when the dashboard opens

