"""For sheets where tech-name matching gave us nothing, scan the cells
for city names or any text that points to a branch."""
import openpyxl
from collections import Counter

PATH = r"C:\Users\user\Downloads\PROJECT A USAPP ALL PARTS INVENTORY USE.xlsx"
wb = openpyxl.load_workbook(PATH, read_only=True, data_only=True)

CITIES = [
    "asheville", "atlanta", "birmingham", "cape girardeau", "chattanooga",
    "columbus", "dallas", "destin", "huntsville", "jackson, ms", "jackson ms",
    "jackson, tn", "jackson tn", "jacksonville", "jonesboro", "knoxville",
    "lake charles", "little rock", "louisville", "memphis", "mobile",
    "montgomery", "nashville", "new orleans", "norfolk", "philippines",
    "raleigh", "richmond", "san antonio", "savannah", "st. louis", "st louis",
    "tallahassee", "wilmington",
]

SHEETS = ["ATL","CB","CG","JV","DT","DL","HV","JS","JB","JT","LC","MP","KV","MB","NO","NV","SA","SL","TL","WM"]

for sheet in SHEETS:
    ws = wb[sheet]
    cnt = Counter()
    for row in ws.iter_rows(values_only=True):
        for cell in row:
            if cell is None:
                continue
            s = str(cell).strip().lower()
            for city in CITIES:
                if city in s:
                    cnt[city] += 1
                    break
    print(f"{sheet:5}  ->  {cnt.most_common(3)}")
