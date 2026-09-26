"""Build the two self-contained dashboard pages (English and Persian).

    python scripts/build_dashboard.py

Inlines the CSS, the JavaScript, the UI strings and data/processed/dashboard_data.json
into site/index.html (English, LTR) and site/index.fa.html (Persian, RTL, with the
Vazirmatn font embedded). No CDN, no network requests: both pages open from disk.
"""
from __future__ import annotations

import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DASH = ROOT / "dashboard"
SITE = ROOT / "site"


def js_json(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def main() -> None:
    data = json.loads((ROOT / "data" / "processed" / "dashboard_data.json").read_text(encoding="utf-8"))
    i18n = json.loads((DASH / "i18n.json").read_text(encoding="utf-8"))
    content = json.loads((DASH / "content.json").read_text(encoding="utf-8"))
    template = (DASH / "template.html").read_text(encoding="utf-8")
    css = (DASH / "styles.css").read_text(encoding="utf-8")
    app = (DASH / "app.js").read_text(encoding="utf-8")
    font = base64.b64encode((DASH / "fonts" / "vazirmatn-variable.woff2").read_bytes()).decode()
    font_face = ("@font-face{font-family:'Vazirmatn';src:url(data:font/woff2;base64," + font +
                 ") format('woff2');font-weight:100 900;font-style:normal;font-display:swap}")

    SITE.mkdir(exist_ok=True)
    for lang, fname in (("en", "index.html"), ("fa", "index.fa.html")):
        t = i18n[lang]
        html = template
        html = html.replace("{{LANG}}", lang).replace("{{DIR}}", "rtl" if lang == "fa" else "ltr")
        html = html.replace("{{OTHER_LANG}}", "fa" if lang == "en" else "en")
        html = html.replace("{{FONT_FACE}}", font_face if lang == "fa" else "")
        html = html.replace("{{CSS}}", css)
        html = html.replace("{{I18N}}", js_json(t)).replace("{{DATA}}", js_json(data))
        html = html.replace("{{TEXT}}", js_json(content))
        html = html.replace("{{APP}}", app)

        def sub(m: re.Match) -> str:
            key = m.group(1)
            if key not in t:
                raise KeyError(f"missing i18n key {key!r} for {lang}")
            return t[key].replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
        html = re.sub(r"\{\{([a-z0-9_]+)\}\}", sub, html)
        (SITE / fname).write_text(html, encoding="utf-8")
        print(f"wrote site/{fname} ({len(html.encode()) / 1024:,.0f} KB)")
    (SITE / ".nojekyll").write_text("")


if __name__ == "__main__":
    sys.exit(main())
