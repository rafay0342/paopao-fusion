from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = PROJECT_ROOT / "tools" / "build-v14-a1-assets.py"
SPEC = importlib.util.spec_from_file_location("v14_art_compiler", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot import {MODULE_PATH}")
COMPILER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = COMPILER
SPEC.loader.exec_module(COMPILER)


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def write_json(path: Path, value: dict) -> None:
    write(path, (json.dumps(value, indent=2) + "\n").encode("utf-8"))


class V14CompilerApprovalBoundaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="paopao-v14-compiler-")
        self.root = Path(self.temporary.name)
        self.manifest_path = self.root / "art-source" / "v14" / "manifest.json"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def approved_entry(self, pf_id: str, relative_path: str, payload: bytes) -> dict:
        return {
            "id": pf_id,
            "approval": {"state": "approved"},
            "provenance": {
                "state": "generated",
                "sourceSha256": sha256(payload),
            },
            "primary": {
                "path": relative_path,
                "format": "json",
                "bytes": len(payload),
                "sha256": sha256(payload),
                "authoredResolution": {"width": None, "height": None},
                "durationMs": None,
            },
            "companions": [],
        }

    def briefed_entry(self, pf_id: str) -> dict:
        return {
            "id": pf_id,
            "approval": {
                "state": "briefed",
                "reviewer": None,
                "reviewedAt": None,
                "contactSheetPath": None,
                "notes": None,
            },
            "provenance": {
                "state": "not-generated",
                "actualTool": None,
                "mode": None,
                "generatedAt": None,
                "finalPrompt": None,
                "negativeConstraints": ["no fighting-game content"],
                "referenceImages": [],
                "model": None,
                "seed": None,
                "outputId": None,
                "rightsStatement": "Original PaoPao Fusion production art.",
                "sourceSha256": None,
            },
            "primary": None,
            "companions": [],
            "technical": {},
            "dependencies": [],
            "usageReferences": [],
        }

    def test_immutable_guard_rejects_approved_master_hash_drift(self) -> None:
        pf_id = "PF-asset-001"
        relative_path = f"art-source/v14/masters/{pf_id}-timeline.json"
        approved_payload = (
            b'{"semanticType":"timeline","data":{"cue":"approved"}}\n'
        )
        master_path = self.root / relative_path
        write(master_path, approved_payload)
        write_json(
            self.manifest_path,
            {"entries": [self.approved_entry(pf_id, relative_path, approved_payload)]},
        )

        _manifest, _entries, bindings = COMPILER.load_approved_master_bindings(
            project_root=self.root,
            manifest_path=self.manifest_path,
            required_ids=(pf_id,),
        )
        self.assertEqual(bindings[pf_id].sha256, sha256(approved_payload))

        write(
            master_path,
            b'{"semanticType":"timeline","data":{"cue":"silently changed"}}\n',
        )
        with self.assertRaisesRegex(RuntimeError, "immutable hash guard failed"):
            COMPILER.load_approved_master_bindings(
                project_root=self.root,
                manifest_path=self.manifest_path,
                required_ids=(pf_id,),
            )

    def test_promotion_requires_explicit_receipt_and_preserves_its_review_data(self) -> None:
        pf_id = "PF-asset-001"
        candidate_relative = (
            f"art-source/v14/review/generated/{pf_id}-timeline.json"
        )
        destination_relative = (
            f"art-source/v14/masters/{pf_id}-timeline.json"
        )
        reference_relative = "art-source/v14/canon/v14-test-reference.json"
        contact_relative = f"docs/art/v14/review/{pf_id}-contact-sheet.png"
        candidate_payload = (
            b'{"semanticType":"timeline","data":{"cues":[{"atMs":0,"action":"open"}]}}\n'
        )
        reference_payload = b'{"canon":"approved-test-reference"}\n'
        write(self.root / candidate_relative, candidate_payload)
        write(self.root / reference_relative, reference_payload)
        write(self.root / contact_relative, b"review-evidence")
        write_json(
            self.manifest_path,
            {"entries": [self.briefed_entry(pf_id)]},
        )
        receipt_path = self.root / "promotion-receipt.json"
        receipt = {
            "schemaVersion": 1,
            "approvalAcknowledged": True,
            "pfId": pf_id,
            "reviewer": "Human art director",
            "reviewedAt": "2026-07-28T10:00:00.000Z",
            "generatedAt": "2026-07-28T09:00:00.000Z",
            "finalPrompt": "Author the approved opening timeline from the locked canon.",
            "actualTool": "local-authoring",
            "mode": "local-authoring",
            "approvalNotes": "Contact sheet and in-engine timing were reviewed.",
            "contactSheetPath": contact_relative,
            "referenceImages": [
                {
                    "role": "approved canon timing",
                    "path": reference_relative,
                    "sha256": sha256(reference_payload),
                }
            ],
            "files": [
                {
                    "role": "primary",
                    "sourcePath": candidate_relative,
                    "destinationPath": destination_relative,
                    "expectedSha256": sha256(candidate_payload),
                    "authoredResolution": {"width": None, "height": None},
                    "durationMs": None,
                }
            ],
            "technical": {"schema": "paopao.v14.timeline.v1"},
            "dependencies": [],
            "usageReferences": [
                {"kind": "runtime", "target": "GameplayArtManifestV1:intro.timeline"}
            ],
            "model": None,
            "seed": None,
            "outputId": None,
        }
        write_json(receipt_path, receipt)

        promoted = COMPILER.promote_reviewed_candidate(
            receipt_path,
            project_root=self.root,
            validate_after_write=False,
        )
        self.assertEqual(promoted, pf_id)
        manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        entry = manifest["entries"][0]
        self.assertEqual(entry["approval"]["reviewer"], receipt["reviewer"])
        self.assertEqual(entry["approval"]["reviewedAt"], receipt["reviewedAt"])
        self.assertEqual(entry["provenance"]["finalPrompt"], receipt["finalPrompt"])
        self.assertEqual(
            entry["provenance"]["sourceSha256"],
            sha256(candidate_payload),
        )
        self.assertEqual((self.root / destination_relative).read_bytes(), candidate_payload)

    def test_promotion_refuses_to_overwrite_an_approved_master(self) -> None:
        pf_id = "PF-asset-001"
        relative_path = f"art-source/v14/masters/{pf_id}-timeline.json"
        approved_payload = (
            b'{"semanticType":"timeline","data":{"cue":"approved"}}\n'
        )
        write(self.root / relative_path, approved_payload)
        write_json(
            self.manifest_path,
            {"entries": [self.approved_entry(pf_id, relative_path, approved_payload)]},
        )
        receipt_path = self.root / "promotion-receipt.json"
        write_json(
            receipt_path,
            {
                "schemaVersion": 1,
                "approvalAcknowledged": True,
                "pfId": pf_id,
            },
        )

        with self.assertRaisesRegex(RuntimeError, "already approved and immutable"):
            COMPILER.promote_reviewed_candidate(
                receipt_path,
                project_root=self.root,
                validate_after_write=False,
            )
        self.assertEqual((self.root / relative_path).read_bytes(), approved_payload)


if __name__ == "__main__":
    unittest.main()
