"""Verify every published review HTML is visible from the canonical preview hub.

This intentionally audits the PUBLIC MIRROR. Branch-only and commit-only private
experiments require a separate archival inventory and are not checked here.
"""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.details_depth = 0
        self.visible_hrefs = set()

    def handle_starttag(self, tag, attrs):
        if tag == "details":
            self.details_depth += 1
        if tag == "a" and self.details_depth == 0:
            href = dict(attrs).get("href")
            if href:
                self.visible_hrefs.add(
                    urlparse(urljoin("https://mirror.example/preview/", href)).path.rstrip("/") or "/"
                )

    def handle_endtag(self, tag):
        if tag == "details":
            self.details_depth = max(0, self.details_depth - 1)


site = Path("site")
hub = site / "preview" / "index.html"
assert hub.is_file(), f"Missing canonical review hub: {hub}"

parser = Links()
parser.feed(hub.read_text(encoding="utf-8"))

experiment_files = [
    p for p in (site / "experiments").rglob("index.html")
    if p != site / "experiments" / "index.html"
]
reference_files = list((site / "reference" / "golden-master").rglob("*.html"))
candidate_files = list((site / "candidate").rglob("*.html"))
required = [site / "index.html", *experiment_files, *reference_files, *candidate_files]
missing = []
for file in sorted(required):
    url_path = "/" + file.relative_to(site).as_posix()
    if url_path.endswith("/index.html"):
        url_path = url_path[:-len("index.html")]
    url_path = url_path.rstrip("/") or "/"
    if url_path not in parser.visible_hrefs:
        missing.append(file.as_posix())

if missing:
    raise SystemExit(
        "Published HTML is missing from the always-visible review hub:\n"
        + "\n".join("  - " + path for path in missing)
    )

print(
    f"Review hub coverage PASS: {len(experiment_files)} experiments, "
    f"{len(reference_files)} Golden Master references, "
    f"{len(candidate_files)} candidates, and the main game."
)
