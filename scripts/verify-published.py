"""Compare deployed HH bytes with this workflow's Pages artifact."""
import hashlib
import json
import tarfile
import time
import urllib.request

BASE = "https://zethhummel-rgb.github.io/hh-family/"
with tarfile.open("publication-artifact/artifact.tar") as archive:
    expected = {}
    for member in archive.getmembers():
        if not member.isfile():
            continue
        name = member.name.removeprefix("./")
        if name.startswith("/") or ".." in name.split("/"):
            raise ValueError("Unexpected artifact path")
        expected[name] = archive.extractfile(member).read()

assert expected and "index.html" in expected
results = []
for name, content in sorted(expected.items()):
    last_error = None
    for attempt in range(6):
        try:
            request = urllib.request.Request(
                BASE + name + "?release=" + str(time.time_ns()),
                headers={"Cache-Control": "no-cache"},
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                actual = response.read()
            if actual != content:
                raise AssertionError("Published bytes differ: " + name)
            results.append({"file": name, "sha256": hashlib.sha256(actual).hexdigest()})
            break
        except Exception as error:
            last_error = error
            if attempt == 5:
                raise
            time.sleep(5)
print(json.dumps({"url": BASE, "matched_files": len(results), "files": results}))
