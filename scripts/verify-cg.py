import json
rows = json.load(open(r"src/lib/truckStockSeed.json", encoding="utf-8"))
cg = [r for r in rows if r["branch"] == "CG"]
print(f"CG count: {len(cg)}\n")
for r in cg[:15]:
    print(r)

print("\nLR sample:")
for r in [r for r in rows if r["branch"] == "LR"][:5]:
    print(r)
print("\nBM sample:")
for r in [r for r in rows if r["branch"] == "BM"][:5]:
    print(r)
