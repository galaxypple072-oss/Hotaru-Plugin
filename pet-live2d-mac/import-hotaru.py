#!/usr/bin/env python3
"""Import the locally supplied Hotaru archive for personal use."""

import json
import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path


def connected_motions(target: Path) -> dict:
    groups = {"Idle": "idle01", "Think": "thinking01", "Listen": "look01", "Nod": "nod01",
              "Smile": "smile01", "Question": "question01", "Denial": "denial01",
              "Greeting": "smile03", "Goodbye": "bye01", "Serious": "serious01"}
    idle = json.loads((target / "motions/mtn_idle01_C.motion3.json").read_text())
    baseline = {c["Id"]: c["Segments"][1] for c in idle["Curves"] if c["Target"] == "Parameter"}
    output = target / "motions/connected"
    output.mkdir(exist_ok=True)
    references = {}
    for group, name in groups.items():
        motion = json.loads((target / f"motions/mtn_{name}_C.motion3.json").read_text())
        duration = motion["Meta"]["Duration"]
        motion["Meta"]["Loop"] = group in ("Idle", "Think", "Listen")
        for curve in motion["Curves"]:
            ident = curve["Id"]
            body = ident.startswith(("ParamAngle", "ParamBody", "ParamShoulder", "ParamStall", "paramArm", "hand_")) or ident in ("ParamPosition", "ParamBreath")
            if curve["Target"] == "Parameter" and not body:
                value = baseline.get(ident, curve["Segments"][1])
                if group == "Smile" and ident == "ParamMouthForm": value = 0.2
                if group == "Smile" and ident in ("ParamEyeLSmile", "ParamEyeRSmile"): value = 0.15
                if ident == "ParamMouthOpenY": value = 0
                curve["Segments"] = [0, value, 0, duration, value]
        segments = points = 0
        for curve in motion["Curves"]:
            values = curve["Segments"]
            index = 2
            points += 1
            while index < len(values):
                bezier = int(values[index]) == 1
                segments += 1
                points += 3 if bezier else 1
                index += 7 if bezier else 3
        motion["Meta"].update(CurveCount=len(motion["Curves"]), TotalSegmentCount=segments, TotalPointCount=points)
        filename = f"{group.lower()}.motion3.json"
        (output / filename).write_text(json.dumps(motion, separators=(",", ":")) + "\n")
        references[group] = [{"File": f"motions/connected/{filename}"}]
    return references


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: import-hotaru.py /path/to/hotaru.zst")
    archive = Path(sys.argv[1]).expanduser().resolve()
    zstd = os.environ.get("ZSTD_BINARY") or shutil.which("zstd")
    if not zstd:
        bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin/zstd"
        if bundled.is_file():
            zstd = str(bundled)
    if not zstd:
        raise SystemExit("zstd not found; install it or set ZSTD_BINARY")

    root = Path(__file__).resolve().parent / "public/assets/live2d/characters/hotaru"
    outfits = {"live_01": "live", "casual_spring_01": "casual"}
    process = subprocess.Popen([zstd, "-dc", str(archive)], stdout=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=process.stdout, mode="r|", encoding="utf-8") as bundle:
            for member in bundle:
                parts = Path(member.name).parts
                if not parts or parts[0] not in outfits or len(parts) < 2 or not member.isfile():
                    continue
                relative = Path(*parts[1:])
                if any(part in (".", "..") for part in relative.parts):
                    raise ValueError(f"unsafe archive path: {member.name}")
                destination = root / outfits[parts[0]] / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.extractfile(member) as source, destination.open("wb") as output:
                    shutil.copyfileobj(source, output)
    finally:
        if process.stdout:
            process.stdout.close()
    if process.wait() != 0:
        raise SystemExit("zstd decompression failed")

    for archive_name, directory in outfits.items():
        target = root / directory
        source = target / f"adv_live2d_hotaru_016_{archive_name}.model3.json"
        model = json.loads(source.read_text(encoding="utf-8"))
        model["FileReferences"]["Motions"] = connected_motions(target)
        (target / "model.model3.json").write_text(
            json.dumps(model, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"Imported Hotaru {directory} Live2D assets to {target}")


if __name__ == "__main__":
    main()
