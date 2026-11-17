from pathlib import Path
import csv
import json
import urllib.request

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_PATH = BASE_DIR / "modules" / "products.generated.json"
SHEET_ID = "19EC29L7CgHCk4XD7AZuqbmiz0KSFv-Nl"
SHEET_GID = "1981413768"
SHEET_CSV_URL = (
    f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}"
)


def parse_price(value):
    raw = str(value or "").strip().replace("\u00a0", "").replace(" ", "").replace(",", ".")
    if not raw:
        return 0.0
    try:
        return round(float(raw), 2)
    except ValueError:
        return 0.0


with urllib.request.urlopen(SHEET_CSV_URL) as response:
    text = response.read().decode("utf-8-sig")

rows = list(csv.reader(text.splitlines()))
header = [cell.strip() for cell in rows[0]]
try:
    code_index = header.index("ბარკოდი")
except ValueError:
    # The live sheet keeps product codes in column A even when that header is not "ბარკოდი".
    code_index = 0
name_index = header.index("დასახელება")
price_index = header.index("დისტრიბუციის ფასი")

products = []
seen = set()
for row in rows[1:]:
    if len(row) <= max(code_index, name_index, price_index):
        continue

    code = str(row[code_index] or "").strip()
    name = str(row[name_index] or "").strip()
    if not code or not name or code in seen:
        continue

    seen.add(code)
    products.append(
        {
            "code": code,
            "name": name,
            "price": parse_price(row[price_index]),
        }
    )

OUTPUT_PATH.write_text(json.dumps(products, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"wrote {len(products)} products to {OUTPUT_PATH}")
