import json
from collections import Counter
rows = json.load(open(r"src/lib/truckStockSeed.json", encoding="utf-8"))
c = Counter((r["branch"], bool(r["storageLocation"])) for r in rows)
for k, v in sorted(c.items()):
    print(k, v)
print("Total with location:", sum(1 for r in rows if r["storageLocation"]))
print("Total:", len(rows))
print("\nSample with location:")
for r in [r for r in rows if r["storageLocation"]][:8]:
    print(" ", r)
