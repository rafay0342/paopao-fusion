#!/usr/bin/env python3
"""End-to-end smoke check for the PaoPao account and cloud-save API."""

from __future__ import annotations

import argparse
import json
import urllib.request


def request(base: str, path: str, body: dict, token: str = "") -> dict:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"{path} returned HTTP {response.status}")
        return json.loads(response.read().decode("utf-8"))


def transactions(start: int, stop: int) -> list[dict]:
    return [
        {
            "id": f"qa-story-shard-{index:04d}",
            "item": "storyShard",
            "delta": 1,
            "coinDelta": 0,
            "reason": "story",
            "createdAt": f"2026-07-20T00:{index // 60:02d}:{index % 60:02d}.000Z",
        }
        for index in range(start, stop)
    ]


def bundle(keys: int, opened: int, progress: dict, tx: list[dict], artifacts: list[str]) -> dict:
    return {
        "player": {"displayName": "QA KEEPER", "badges": [], "claimedChallengeIds": [], "totals": {}},
        "meta": {
            "coins": 600,
            "lifetimeCoins": 600,
            "totalHits": 0,
            "completedRuns": 0,
            "mysteryKeys": keys,
            "openedMysteryBoxes": opened,
            "ownedArtifacts": artifacts,
            "ownedSkins": ["nova"],
        },
        "progress": progress,
        "inventory": {"version": 1, "revision": len(tx), "transactions": tx},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8189")
    args = parser.parse_args()

    session = request(args.base, "/api/session", {"playerId": "api-qa-keeper", "displayName": "QA KEEPER"})
    token = session["token"]
    first = bundle(
        1,
        0,
        {"unlocked": 2, "bestScores": [500, 0], "stars": [2, 0]},
        transactions(0, 320),
        ["chrono"],
    )
    request(args.base, "/api/sync", {"save": first}, token)

    second = bundle(
        0,
        1,
        {"unlocked": 3, "bestScores": [0, 800], "stars": [0, 3]},
        transactions(320, 640),
        ["fortune"],
    )
    synced = request(args.base, "/api/sync", {"save": second}, token)["save"]

    assert synced["meta"]["mysteryKeys"] == 0, "spent Mystery Key was resurrected"
    assert synced["meta"]["openedMysteryBoxes"] == 1
    assert set(synced["meta"]["ownedArtifacts"]) == {"chrono", "fortune"}
    assert synced["progress"]["unlocked"] == 3
    assert synced["progress"]["bestScores"][:2] == [500, 800]
    assert synced["progress"]["stars"][:2] == [2, 3]
    assert len(synced["inventory"]["transactions"]) == 642, "inventory ledger was truncated"

    restored = request(args.base, "/api/account/restore", {"recoveryCode": session["recoveryCode"]})
    assert restored["playerId"] == session["playerId"]
    assert len(restored["save"]["inventory"]["transactions"]) == 642
    print("API smoke passed: session, dual-device merge, spent-key safety, 642-entry ledger, restore")


if __name__ == "__main__":
    main()
