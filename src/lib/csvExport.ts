// Shared CSV export utility

export function exportToCSV(filename: string, headers: string[], rows: (string|number|null|undefined)[][]) {
  const escape = (v: string|number|null|undefined) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.map(escape).join(","),
    ...rows.map(row => row.map(escape).join(","))
  ].join("\n");

  // BOM so Excel opens it as UTF-8 (otherwise "—" etc. come out garbled).
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`;
  // Some browsers ignore clicks on a detached link, and revoking the URL
  // in the same tick can cancel the download before it starts.
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}
