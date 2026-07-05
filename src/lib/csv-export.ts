export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      row
        .map((v) => {
          const s = String(v ?? "").replace(/"/g, '""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        })
        .join(","),
    ),
  ].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
