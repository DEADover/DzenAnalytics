import re, os
from datetime import date

SRC = ".scratch/cm-timeline.md"
OUT = "docs/timeline-weeks"
MONTHS = {m: i + 1 for i, m in enumerate(
    "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}

lines = open(SRC, encoding="utf-8").read().split("\n")
hdr = re.compile(r"^### (\w{3}) (\d{1,2}), (\d{4})$")
obs = re.compile(r"^\d+\s")

days, cur = [], None
for l in lines:
    m = hdr.match(l)
    if m:
        d = date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
        cur = {"date": d, "lines": [l]}
        days.append(cur)
    elif cur is not None:
        cur["lines"].append(l)

weeks = {}
for d in days:
    y, w, _ = d["date"].isocalendar()
    weeks.setdefault((y, w), []).append(d)

os.makedirs(OUT, exist_ok=True)
total_obs = sum(1 for l in lines if obs.match(l))
spread, rows = 0, []
for (y, w), ds in sorted(weeks.items()):
    ds.sort(key=lambda x: x["date"])
    body = "\n".join("\n".join(d["lines"]).rstrip() for d in ds)
    n_obs = sum(1 for l in body.split("\n") if obs.match(l))
    n_ses = sum(1 for l in body.split("\n") if l.startswith("S"))
    spread += n_obs
    a, b = ds[0]["date"], ds[-1]["date"]
    label = f"{a:%b%d}-to-{b:%b%d}"
    name = f"{y}-W{w:02d}-{label}.md"
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(
        f"# {y} неделя {w:02d} · {a:%d %b} — {b:%d %b}\n\n{body}\n")
    rows.append((f"{y}-W{w:02d}", f"{a:%d %b} — {b:%d %b}", n_obs, n_ses, name))

readme = ["# Недельные срезы таймлайна\n",
          f"Источник: `{SRC}` · наблюдений всего: {total_obs}\n",
          "| Неделя | Даты | Наблюдений | Сессий | Файл |",
          "|---|---|---|---|---|"]
for r in rows:
    readme.append(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | [{r[4]}]({r[4]}) |")
open(os.path.join(OUT, "README.md"), "w", encoding="utf-8").write("\n".join(readme) + "\n")

print(f"недель: {len(rows)}  наблюдений в источнике: {total_obs}  разложено: {spread}")
print("СВЕРКА:", "ок" if spread == total_obs else f"РАСХОЖДЕНИЕ {total_obs - spread}")
for r in rows:
    print(f"  {r[0]}  {r[1]}  obs={r[2]}  sessions={r[3]}")
