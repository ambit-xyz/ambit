#!/usr/bin/env python3
"""Expected compile() output for every valid mandate fixture.

An independent reference for the TypeScript compiler in packages/mandate: Python standard library
only, no code shared with the package, written from the compile rules in its README. The tests
compare the compiler against the file this writes, so a bug in the compiler cannot also end up in
the expected values.

    python3 scripts/compile-vectors.py           # writes tests/fixtures/mandates/compile-vectors.json
    python3 scripts/compile-vectors.py --check   # fails if the committed file differs

Run it after adding or changing a file in tests/fixtures/mandates/valid/.
"""

import base64
import hashlib
import json
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests/fixtures/mandates"
OUT = FIXTURES / "compile-vectors.json"

VERSION_ACCOUNT = 6 << 3  # "G"
VERSION_CONTRACT = 2 << 3  # "C"
LEDGER_SECONDS = 5
PERIOD_SECONDS = {"1h": 3600, "1d": 86400, "7d": 7 * 86400, "30d": 30 * 86400}

# Fixed context. The verifier and policy addresses are test values (32 bytes of 1, 2 and 3), not
# deployments. The mainnet USDC contract is a test value too.
NOW = "2026-11-20T00:00:00Z"
CURRENT_LEDGER = 1_000_000


def crc16(data: bytes) -> int:
    """CRC16-XModem, the StrKey checksum."""
    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def strkey_encode(version: int, payload: bytes) -> str:
    body = bytes([version]) + payload
    checksum = crc16(body)
    return base64.b32encode(body + bytes([checksum & 0xFF, checksum >> 8])).decode().rstrip("=")


def strkey_decode(address: str, version: int) -> bytes:
    raw = base64.b32decode(address + "=" * (-len(address) % 8))
    assert len(raw) == 35 and raw[0] == version, address
    assert crc16(raw[:33]) == raw[33] | (raw[34] << 8), address
    return raw[1:33]


def test_contract(n: int) -> str:
    return strkey_encode(VERSION_CONTRACT, bytes([n]) * 32)


def stroops(amount: str) -> str:
    value = Decimal(amount) * 10**7
    assert value == value.to_integral_value(), amount
    return str(int(value))


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def mandate_hash(mandate: dict) -> str:
    # Same as RFC 8785 for mandates, which hold only objects, arrays and strings with ASCII keys.
    canonical = json.dumps(mandate, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


COMMON = {
    "now": NOW,
    "currentLedger": CURRENT_LEDGER,
    "ed25519Verifier": test_contract(1),
    "ambitPolicy": test_contract(2),
    "spendingLimit": test_contract(3),
}
CONTEXT = {
    "testnet": {
        **COMMON,
        "network": "testnet",
        "usdcSac": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    },
    "mainnet": {
        **COMMON,
        "network": "mainnet",
        "usdcSac": "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    },
}


def compile_vector(mandate: dict) -> dict:
    ctx = CONTEXT[mandate["network"]]
    digest = mandate_hash(mandate)
    seconds = (parse_time(mandate["validUntil"]) - parse_time(NOW)).total_seconds()
    assert seconds == int(seconds), "fixtures use whole seconds"
    ledgers = -(-int(seconds) // LEDGER_SECONDS)  # ceil
    limits = mandate["limits"]
    return {
        "account": mandate["account"],
        "mandateHash": digest,
        "rule": {
            "contextType": {"type": "CallContract", "contract": mandate["asset"]["contract"]},
            "name": "ambit:" + digest[:8],
            "validUntil": CURRENT_LEDGER + ledgers,
            "signers": [
                {
                    "type": "External",
                    "verifier": ctx["ed25519Verifier"],
                    "publicKey": strkey_decode(
                        mandate["agent"]["signer"]["publicKey"], VERSION_ACCOUNT
                    ).hex(),
                }
            ],
            "policies": [ctx["ambitPolicy"]],
        },
        "ambitPolicyParams": {
            "mandateHash": digest,
            "maxPerPayment": stroops(limits["maxPerPayment"]),
            "payees": mandate["payees"],
        },
        "spendingLimitPolicy": ctx["spendingLimit"],
        "spendingLimitParams": {
            "spendingLimit": stroops(limits["maxPerPeriod"]),
            "periodLedgers": PERIOD_SECONDS[limits["period"]] // LEDGER_SECONDS,
        },
    }


def build() -> str:
    known = {v["fixture"]: v["sha256"] for v in json.loads((FIXTURES / "hash-vectors.json").read_text())}
    vectors = []
    for path in sorted((FIXTURES / "valid").glob("*.json")):
        name = f"valid/{path.name}"
        mandate = json.loads(path.read_text(encoding="utf-8"))
        vector = compile_vector(mandate)
        if name in known:
            assert vector["mandateHash"] == known[name], f"{name}: hash differs from hash-vectors.json"
        vectors.append({"fixture": name, "compiled": vector})
    out = {
        "_comment": "Expected compile() output for each valid fixture, written by "
        "scripts/compile-vectors.py. Bytes are hex, stroop amounts are decimal strings. The "
        "verifier and policy addresses are test values, not deployments.",
        "context": CONTEXT,
        "vectors": vectors,
    }
    return json.dumps(out, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    text = build()
    if "--check" in sys.argv[1:]:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        # The committed file is formatted by Biome, so compare data, not text.
        if json.loads(current or "null") != json.loads(text):
            print(f"{OUT.relative_to(ROOT)} is out of date. Run scripts/compile-vectors.py.")
            return 1
        print(f"{OUT.relative_to(ROOT)} is up to date ({len(json.loads(text)['vectors'])} vectors).")
        return 0
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
