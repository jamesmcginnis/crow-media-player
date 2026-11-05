"""Constants for the Crow Food integration."""

DOMAIN = "crow_food"
NAME = "Crow Food"

STORAGE_VERSION = 1
STORAGE_KEY_DATA = f"{DOMAIN}.data"
STORAGE_KEY_SETTINGS = f"{DOMAIN}.settings"
# the history is kept in its own file, so everyday changes don't rewrite it
STORAGE_KEY_HISTORY = f"{DOMAIN}.history"
# AI answers kept for a while, so the same question isn't asked again and again
STORAGE_KEY_AI_CACHE = f"{DOMAIN}.ai_cache"
AI_CACHE_MAX = 500

# Folder under /config (NOT /config/www - everything there is public at /local/ without logging in).
# Product photos are served by the integration through links it signs itself.
DATA_DIR_NAME = "crow_food"
PHOTOS_DIR = "photos"
BACKUPS_DIR = "backups"

# The card ships inside the integration and is added to every dashboard automatically
CARD_FILENAME = "crow-food-card.js"
# parts of the card in files of their own, fetched the first time each is used
LAZY_FILES = {"editor": "crow-food-editor.js", "scanner": "crow-food-scanner.js", "pdf": "crow-food-pdf.js"}

# A storage is a place food is kept (Pantry, Fridge, Freezer...); a list is a shopping list
KIND_STORAGE = "storage"
KIND_LIST = "list"
# What a list is for: things to buy (the Shopping list), things to eat from what's at home (a meal Basket),
# or ideas for someday. Reports go by this, not the list's name, as people use names differently.
PURPOSE_BUY = "buy"
PURPOSE_EAT = "eat"
PURPOSE_IDEAS = "ideas"
PURPOSES = (PURPOSE_BUY, PURPOSE_EAT, PURPOSE_IDEAS)

# What happened to an item, kept in the history (and used for the waste score)
STATUS_CONSUMED = "consumed"
STATUS_THROWN = "thrown"
STATUS_ADDED = "added"
STATUS_BOUGHT = "bought"
STATUS_MOVED = "moved"
STATUS_PICKED = "picked"   # ticked off a list for eating (Meal Picks)

# how much history is kept
MAX_LOGS = 20000
# how long something eaten or thrown away can be restored to stock, in days
RESTORE_DAYS = 30
# how deep storages can be nested (a storage inside a storage inside a storage)
MAX_NESTING = 3

# Units an item is counted in, and units for what's in one package
UNITS = ("package", "piece", "can", "bottle", "jar", "tube", "carton", "pot", "box", "bag", "cup", "pack",
         "tin", "tub", "punnet", "loaf", "bunch", "sachet", "roll", "g", "kg", "ml", "l")
CONTENT_UNITS = ("", "g", "kg", "ml", "l", "piece", "slice", "can", "oz", "lb", "serving", "portion", "sheet", "bag", "pod")

# The default storages and lists for a new household (when nothing is imported)
DEFAULT_STORAGES = (
    {"name": "Pantry", "kind": KIND_STORAGE, "icon": "mdi:archive-outline", "color": "#F5C842"},
    {"name": "Fridge", "kind": KIND_STORAGE, "icon": "mdi:fridge-outline", "color": "#4FC9C4"},
    {"name": "Freezer", "kind": KIND_STORAGE, "icon": "mdi:snowflake", "color": "#7DB9F5"},
    {"name": "Shopping", "kind": KIND_LIST, "icon": "mdi:cart-outline", "color": "#5BC864", "purpose": "buy", "builtin": "shopping"},
    {"name": "Basket", "kind": KIND_LIST, "icon": "mdi:basket-outline", "color": "#F0A04B", "purpose": "eat", "builtin": "basket"},
)
# The lists every household has, which can't be renamed, changed or deleted (only lists people make can)
BUILTIN_LISTS = ("shopping", "basket")
DEFAULT_CATEGORIES = ("Bakery", "Beverages", "Dairy", "Eggs", "Fish", "Fruit", "Meat", "Noodles & Pasta", "Ready Meals",
                      "Rice", "Sauces", "Seasoning", "Snacks & Sweets", "Soup", "Spices", "Vegetables", "Household", "Other")

# Household settings (saved in Home Assistant, changed by administrators in the card editor)
DEFAULT_SETTINGS = {
    # how many days ahead "Soon to be expired" looks
    "soon_days": 3,
    # products not bought for this many months show in Not Bought Lately (0 = off)
    "stale_months": 6,
    # notifications: who gets them, when, and what about
    "notify": {
        "users": [],
        "time": "09:00",
        "expiring": True,
        "expired": True,
        "low_stock": False,
        "bought": False,
        # a note when products reach Not Bought Lately
        "stale": True,
        # the dashboard a note opens ("" = wherever each person last opened the card)
        "path": "",
    },
    # Shopping lists as Home Assistant to-do lists (for Assist and the Companion app)
    "todo_lists": False,
    # look products up on Open Food Facts when a barcode isn't known yet
    "openfoodfacts": True,
    # a general picture of the food from Wikipedia for products without a photo
    "photo_finder": True,
    # keep a copy of everything in /config/crow_food/backups every day
    "backups": {"enabled": True, "keep": 7},
    # how long the history (consumed, thrown away, bought) is kept, in days; 0 = forever
    "history_days": 730,
    # AI (AI Task entity chosen here, or Home Assistant's preferred one)
    "ai": {"enabled": False, "task_entity": "", "features": {}},
    # the currency shown beside prices
    "currency": "",
}

EVENT_CHANGED = f"{DOMAIN}_changed"
EVENT_ITEM = f"{DOMAIN}_item"
SIGNAL_UPDATE = f"{DOMAIN}_update"

# events for automations
EVENT_RUNNING_LOW = "crow_food_running_low"
EVENT_BACK_IN_STOCK = "crow_food_back_in_stock"
