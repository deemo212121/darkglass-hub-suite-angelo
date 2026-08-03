import openpyxl
wb = openpyxl.load_workbook(r"C:\Users\user\Downloads\PROJECT A USAPP ALL PARTS INVENTORY USE.xlsx", read_only=True, data_only=True)
ws = wb["CG"]
rows = list(ws.iter_rows(values_only=True))
print("Row 1:")
for i, v in enumerate(rows[0][:20]):
    print(f"  {i:2d}: {v!r}")
print("Row 2:")
for i, v in enumerate(rows[1][:20]):
    print(f"  {i:2d}: {v!r}")
print("\nData rows 4-10 (cols 12-18):")
for ri in range(3, 10):
    print(f"  R{ri}:", [str(v) if v is not None else "" for v in rows[ri][12:19]])

# Show how many distinct part numbers in column 15 area
from collections import Counter
print("\nUnique values at column 15 (after row 4):")
c = Counter(str(rows[ri][15]) if rows[ri][15] is not None else "" for ri in range(3, len(rows)))
for k, v in c.most_common(8):
    print(f"  {v:5}  {k}")
