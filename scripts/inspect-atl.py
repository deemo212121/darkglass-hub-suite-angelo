"""See how ATL's TS columns are arranged so we can fix the layout offset."""
import openpyxl

PATH = r"C:\Users\user\Downloads\PROJECT A USAPP ALL PARTS INVENTORY USE.xlsx"
wb = openpyxl.load_workbook(PATH, read_only=True, data_only=True)
ws = wb["ATL"]
rows = list(ws.iter_rows(values_only=True))

print("Row 1 (length):", len(rows[0]))
for i, v in enumerate(rows[0][:30]):
    print(f"  col {i:2d}: {v!r}")
print("\nRow 2:")
for i, v in enumerate(rows[1][:30]):
    print(f"  col {i:2d}: {v!r}")
print("\nSample data row 6:")
for i, v in enumerate(rows[5][:30]):
    print(f"  col {i:2d}: {v!r}")
print("\nSample data row 30:")
for i, v in enumerate(rows[29][:30]):
    print(f"  col {i:2d}: {v!r}")
