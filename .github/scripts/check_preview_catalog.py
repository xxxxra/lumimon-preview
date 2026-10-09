"""Deploy gate for the one canonical Lumimon review hub.

Every active/reviewable published HTML must have ONE discoverable, identified entry.
User-excluded rejected builds are hash-pinned, deliberately absent from the hub.\nNo private branch is treated as a public playable build, and status labels here
do not promote an experimental candidate to canon or Golden Master.
"""
from hashlib import sha1
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

SITE = Path("site")
HUB = SITE / "preview" / "index.html"
BASE = "https://mirror.example/preview/"
# Explicit user instruction (2026-10-10): take these rejected variants out of
# the review experience entirely. Keep their published bytes stable only to
# avoid erasing provenance or reusing historical URLs. They are not candidates.
USER_EXCLUDED_BLOBS = {
    "experiments/start-highland-redesign-01/index.html": "3b4b4408a41701d64751e4af4125167a2bdc5957",
    "experiments/archive/23x17-highland-rejected/index.html": "2add9c97e71ee7d7a471115985ed9df840d2d89d",
    "experiments/start-highland-redesign-01/checkpoints/e773b76/index.html": "2fd479866854664693ff3da554409c7ccb272d7b",
    "experiments/archive/start-highland-qa-a609e87/index.html": "cefb369fe000b96c4bc743d94d66c0a625d22448",
    "experiments/archive/start-highland-grounded-535728b/index.html": "18b70448c07d60c5496cb8bca8d46e15967e6f80",
}



def page_path(href):
    return urlparse(urljoin(BASE, href)).path.rstrip("/") or "/"


def expected_path(file):
    rel = file.relative_to(SITE).as_posix()
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[:-len("index.html")].rstrip("/")
    return "/" + rel


def blob_sha(file):
    raw = file.read_bytes()
    return sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


class Catalog(HTMLParser):
    def __init__(self):
        super().__init__()
        self.details_depth = 0
        self.visible_hrefs = set()
        self.vault_ids = []
        self.vault_summaries = set()
        self.playable = {}
        self.problems = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "details":
            self.details_depth += 1
            self.vault_ids.append(attrs.get("id"))
        if tag == "summary" and self.vault_ids:
            self.vault_summaries.add(self.vault_ids[-1])
        href = attrs.get("href")
        if tag == "a" and href:
            self.visible_hrefs.add(page_path(href))
        if attrs.get("data-access") != "playable":
            return
        file = attrs.get("data-file")
        if tag != "a" or not href:
            self.problems.append(f"Playable entry without a link: {file}")
            return
        if not file or file in self.playable:
            self.problems.append(f"Missing or duplicate data-file: {file}")
            return
        self.playable[file] = {
            "href": page_path(href),
            "blob": attrs.get("data-blob"),
            "review": attrs.get("data-status"),
            "hidden": "hidden" in attrs,
            "vault": self.vault_ids[-1] if self.vault_ids else None,
        }

    def handle_endtag(self, tag):
        if tag == "details":
            self.details_depth = max(0, self.details_depth - 1)
            if self.vault_ids:
                vault_id = self.vault_ids.pop()
                if vault_id not in self.vault_summaries:
                    self.problems.append(f"Archive without accessible summary: {vault_id}")


if not HUB.is_file():
    raise SystemExit(f"Missing canonical review hub: {HUB}")
catalog = Catalog()
catalog.feed(HUB.read_text(encoding="utf-8"))

experiments = [
    file for file in (SITE / "experiments").rglob("index.html")
    if file != SITE / "experiments" / "index.html"
]
references = list((SITE / "reference" / "golden-master").rglob("*.html"))
candidates = list((SITE / "candidate").rglob("*.html"))
required = [SITE / "index.html", *experiments, *references, *candidates]
expected_files = {file.relative_to(SITE).as_posix(): file for file in required}

for rel, file in expected_files.items():
    if rel in USER_EXCLUDED_BLOBS:
        expected_sha = USER_EXCLUDED_BLOBS[rel]
        if blob_sha(file) != expected_sha:
            catalog.problems.append(f"Excluded rejected file changed unexpectedly: {rel}")
        if rel in catalog.playable or expected_path(file) in catalog.visible_hrefs:
            catalog.problems.append(f"Rejected file has returned to the public review hub: {rel}")
        continue
    path = expected_path(file)
    if path not in catalog.visible_hrefs:
        catalog.problems.append(f"Published HTML has no visible link: {rel}")
    entry = catalog.playable.get(rel)
    if not entry:
        catalog.problems.append(f"Published HTML has no identified catalog entry: {rel}")
        continue
    if entry["href"] != path:
        catalog.problems.append(f"Catalog link points elsewhere: {rel} -> {entry['href']}")
    actual_sha = blob_sha(file)
    if entry["blob"] != actual_sha:
        catalog.problems.append(
            f"Catalog SHA mismatch (possibly overwritten): {rel} "
            f"expected {entry['blob']}, actual {actual_sha}"
        )
    if not entry["review"]:
        catalog.problems.append(f"Missing review status: {rel}")
    if entry["hidden"]:
        catalog.problems.append(f"Catalog item hidden by default: {rel}")

for rel in sorted(set(catalog.playable) - set(expected_files)):
    catalog.problems.append(f"Catalog claims nonexistent playable file: {rel}")

# Every excluded rejected file must remain present and byte-identical.
for rel in USER_EXCLUDED_BLOBS:
    if rel not in expected_files:
        catalog.problems.append(f"Excluded rejected source unexpectedly missing: {rel}")

# The reviewed comparison is NOT an accepted Golden Master.
reviewed = "experiments/start-village/index.html"
if catalog.playable.get(reviewed, {}).get("review") != "reviewed":
    catalog.problems.append(f"User-reviewed working baseline mislabeled: {reviewed}")
if catalog.playable.get(reviewed, {}).get("vault") is not None:
    catalog.problems.append("User-reviewed baseline must remain visible on the hub")

for rel in ("index.html", "experiments/memory/index.html",
            "reference/golden-master/shiokaze/sio3-4.html",
            "reference/golden-master/snow/luminaria_snow_village_premium.html"):
    if catalog.playable.get(rel, {}).get("vault") is not None:
        catalog.problems.append(f"Important version must remain visible: {rel}")

if set(catalog.vault_summaries) != {
    "archive-proposals", "archive-history", "archive-source"
}:
    catalog.problems.append("Expected 3 independently accessible archive summaries")


if catalog.problems:
    raise SystemExit("Preview catalog validation FAILED:\n" + "\n".join(
        " - " + error for error in catalog.problems
    ))

print(
    f"Review hub PASS: {len(experiments)} experimental saves, "
    f"{len(references)} Golden Masters, {len(candidates)} older candidates, "
    "and current main; eligible versions are accessible, rejected files are unlisted and hash-pinned."
)
