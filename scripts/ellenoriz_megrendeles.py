#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Konyhabútor megrendelés ellenőrző — tervező JSON vs. gyári visszaigazolás.

Beolvassa a tervezőből kinyert elemlistát (kód, darabszám, méret, korpusz/front),
majd összeveti a gyári visszaigazolással.

Használat:
  python3 scripts/ellenoriz_megrendeles.py tervezo.json gyari.json
  python3 scripts/ellenoriz_megrendeles.py --self-test
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

# Méreteltérés tűrése mm-ben (gyári kerekítés / mm↔cm átváltás).
MERET_TURES_MM = 1.0

ITEM_CODE_KEYS = (
    "cikkszam",
    "code",
    "elemkod",
    "elemkód",
    "primaryRefCode",
    "articleNumber",
    "sku",
    "itemNumber",
    "rawCode",
)
QTY_KEYS = ("mennyiseg", "mennyiség", "qty", "quantity", "darab", "db")
NAME_KEYS = ("nev", "név", "name", "description", "label", "megnevezes", "megnevezés")
WIDTH_KEYS = ("szelesseg", "szélesség", "width", "widthMm", "width_mm", "w")
HEIGHT_KEYS = ("magassag", "magasság", "height", "heightMm", "height_mm", "h")
DEPTH_KEYS = ("melyseg", "mélység", "depth", "depthMm", "depth_mm", "d")
KORPUSZ_KEYS = (
    "korpusz",
    "korpuszColor",
    "korpusz_szin",
    "carcass",
    "carcassColor",
    "corpus",
    "corpusColor",
)
FRONT_KEYS = (
    "front",
    "frontColor",
    "front_szin",
    "also_front",
    "alsó_front",
    "lowerFront",
    "upperFront",
    "felulet",
    "felület",
    "finish",
)


class OrderCheckError(Exception):
    """Érvénytelen bemenet vagy olvashatatlan megrendelés-adat."""


def _nfc(value: Any) -> str:
    return unicodedata.normalize("NFC", str(value if value is not None else "")).strip()


def _fold(value: Any) -> str:
    """Összehasonlításhoz: kisbetű, ékezet nélkül, tömörített szóköz."""
    text = unicodedata.normalize("NFKD", _nfc(value))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[\s_\-–—]+", " ", text).strip().lower()
    return text


def _first(obj: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in obj and obj[key] not in (None, ""):
            return obj[key]
        for actual, val in obj.items():
            if _fold(actual) == _fold(key) and val not in (None, ""):
                return val
    return None


def _as_qty(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    if isinstance(value, bool):
        raise OrderCheckError("A darabszám nem lehet igaz/hamis érték.")
    if isinstance(value, (int, float)):
        qty = float(value)
    else:
        cleaned = (
            str(value)
            .replace("\u00a0", " ")
            .replace(" ", "")
            .replace("db", "")
            .replace("DB", "")
            .replace(",", ".")
        )
        try:
            qty = float(cleaned)
        except ValueError as exc:
            raise OrderCheckError(f"Érvénytelen darabszám: {value!r}") from exc
    if qty < 0:
        raise OrderCheckError(f"A darabszám nem lehet negatív: {value!r}")
    return qty


def _as_mm(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        raise OrderCheckError("A méret nem lehet igaz/hamis érték.")
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip().lower().replace(",", ".")
        text = re.sub(r"\s+", "", text)
        multiplier = 1.0
        if text.endswith("cm"):
            multiplier = 10.0
            text = text[:-2]
        elif text.endswith("mm"):
            text = text[:-2]
        try:
            number = float(text) * multiplier
        except ValueError as exc:
            raise OrderCheckError(f"Érvénytelen méret: {value!r}") from exc
    if number < 0:
        raise OrderCheckError(f"A méret nem lehet negatív: {value!r}")
    # 250 alatt egész szám ≈ cm (60, 72, 210), felette mm (600, 720, 2100).
    if 0 < number <= 250 and number == int(number):
        number *= 10.0
    return number


def _parse_size_token(token: Any) -> dict[str, float | None]:
    """'600x720x560' / '60×72×56 cm' → szélesség, magasság, mélység mm-ben."""
    empty = {"szelesseg": None, "magassag": None, "melyseg": None}
    if token in (None, ""):
        return empty
    if isinstance(token, dict):
        return {
            "szelesseg": _as_mm(_first(token, WIDTH_KEYS)),
            "magassag": _as_mm(_first(token, HEIGHT_KEYS)),
            "melyseg": _as_mm(_first(token, DEPTH_KEYS)),
        }
    parts = re.split(r"[xX×*]", str(token).strip())
    nums = [_as_mm(p) for p in parts if str(p).strip()]
    if len(nums) >= 3:
        return {"szelesseg": nums[0], "magassag": nums[1], "melyseg": nums[2]}
    if len(nums) == 2:
        return {"szelesseg": nums[0], "magassag": nums[1], "melyseg": None}
    if len(nums) == 1:
        return {"szelesseg": nums[0], "magassag": None, "melyseg": None}
    return empty


def _extract_code(item: dict[str, Any]) -> str:
    raw = _first(item, ITEM_CODE_KEYS)
    if raw is None and isinstance(item.get("refCodes"), dict):
        refs = item["refCodes"]
        raw = refs.get("manufCode") or (refs.get("others") or {}).get("userCode")
    code = _nfc(raw).replace("\ufeff", "").upper()
    code = re.sub(r"\s+", "", code)
    if not code:
        return ""
    lead = re.match(r"^([A-Z][A-Z0-9_]{0,24})", code)
    return lead.group(1) if lead else code


def _item_dimensions(item: dict[str, Any]) -> dict[str, float | None]:
    nested = item.get("meretek") or item.get("méretek") or item.get("dimensions") or item.get("size")
    dims = _parse_size_token(nested) if nested not in (None, "") else {
        "szelesseg": None,
        "magassag": None,
        "melyseg": None,
    }
    if dims["szelesseg"] is None:
        dims["szelesseg"] = _as_mm(_first(item, WIDTH_KEYS))
    if dims["magassag"] is None:
        dims["magassag"] = _as_mm(_first(item, HEIGHT_KEYS))
    if dims["melyseg"] is None:
        dims["melyseg"] = _as_mm(_first(item, DEPTH_KEYS))
    return dims


def _item_colors(item: dict[str, Any]) -> dict[str, str]:
    colors = item.get("szinek") or item.get("színek") or item.get("colors") or {}
    if not isinstance(colors, dict):
        colors = {}
    korpusz = _first(item, KORPUSZ_KEYS) or _first(colors, KORPUSZ_KEYS)
    front = _first(item, FRONT_KEYS) or _first(colors, FRONT_KEYS)
    return {"korpusz": _nfc(korpusz), "front": _nfc(front)}


def _kitchen_colors(data: dict[str, Any]) -> dict[str, str]:
    kitchen = data.get("kitchen") if isinstance(data.get("kitchen"), dict) else {}
    colors = data.get("szinek") or data.get("színek") or data.get("colors") or {}
    if not isinstance(colors, dict):
        colors = {}
    source = {**colors, **kitchen, **data}
    return {
        "korpusz": _nfc(_first(source, ("korpuszColor", "korpusz", "carcassColor", "carcass"))),
        "also_front": _nfc(_first(source, ("lowerFront", "alsoFront", "alsó_front", "also_front"))),
        "felso_front": _nfc(_first(source, ("upperFront", "felsoFront", "felső_front", "felso_front"))),
        "kamra_front": _nfc(_first(source, ("kamraUpperFront", "kamra_front"))),
    }


def _iter_raw_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(data, dict):
        raise OrderCheckError("A megrendelés gyökere objektum (JSON object) kell legyen.")

    for key in ("items", "elemek", "tetel", "tételek", "commercialItems"):
        arr = data.get(key)
        if isinstance(arr, list) and arr:
            return [x for x in arr if isinstance(x, dict)]

    snapshot = data.get("snapshot")
    if isinstance(snapshot, dict) and isinstance(snapshot.get("lines"), list):
        lines = [x for x in snapshot["lines"] if isinstance(x, dict)]
        if lines:
            return lines

    selected = data.get("state", {}).get("selected") if isinstance(data.get("state"), dict) else None
    if isinstance(selected, list) and selected:
        rows = []
        for entry in selected:
            if isinstance(entry, (list, tuple)) and len(entry) >= 2 and isinstance(entry[1], dict):
                rows.append(entry[1])
            elif isinstance(entry, dict):
                rows.append(entry)
        if rows:
            return rows

    raise OrderCheckError(
        "Nem található elemlista. Várt kulcsok: items, elemek, commercialItems, "
        "snapshot.lines vagy state.selected."
    )


def parse_order(data: dict[str, Any]) -> dict[str, Any]:
    """Tervező / megrendelő / gyári JSON → egységes struktúra."""
    if not isinstance(data, dict):
        raise OrderCheckError("A parse-oláshoz szótár (dict) kell.")

    items: list[dict[str, Any]] = []
    for raw in _iter_raw_items(data):
        code = _extract_code(raw)
        if not code:
            continue
        qty = _as_qty(_first(raw, QTY_KEYS) if _first(raw, QTY_KEYS) is not None else 1)
        if qty <= 0:
            continue
        items.append(
            {
                "kod": code,
                "nev": _nfc(_first(raw, NAME_KEYS)),
                "darab": qty,
                "meretek": _item_dimensions(raw),
                "szinek": _item_colors(raw),
            }
        )

    if not items:
        raise OrderCheckError("A JSON-ban nincs egyetlen érvényes elemkód + darabszám sem.")

    return {
        "azonosito": _nfc(
            data.get("quoteNumber")
            or data.get("confirmationNumber")
            or data.get("sorszam")
            or data.get("sorszám")
            or data.get("id")
        ),
        "szinek": _kitchen_colors(data),
        "elemek": items,
    }


def load_json_file(path: str | Path) -> dict[str, Any]:
    file_path = Path(path)
    if not file_path.is_file():
        raise OrderCheckError(f"A fájl nem található: {file_path}")
    try:
        raw = file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise OrderCheckError(
            f"A fájl nem érvényes UTF-8: {file_path}. Mentsd UTF-8 kódolással."
        ) from exc
    except OSError as exc:
        raise OrderCheckError(f"A fájl nem olvasható: {file_path} ({exc})") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OrderCheckError(
            f"Érvénytelen JSON ({file_path}): {exc.msg} (sor {exc.lineno}, oszlop {exc.colno})"
        ) from exc
    if not isinstance(data, dict):
        raise OrderCheckError("A JSON gyökere objektum legyen, ne lista vagy skalár.")
    return data


def _index_items(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for item in items:
        code = item["kod"]
        if code not in grouped:
            grouped[code] = {
                "kod": code,
                "nev": item.get("nev") or "",
                "darab": 0.0,
                "meretek": [],
                "szinek": [],
            }
        grouped[code]["darab"] += float(item["darab"])
        if item.get("nev") and not grouped[code]["nev"]:
            grouped[code]["nev"] = item["nev"]
        grouped[code]["meretek"].append(item["meretek"])
        grouped[code]["szinek"].append(item["szinek"])
    return grouped


def _pick_dim(rows: list[dict[str, float | None]], key: str) -> float | None:
    for row in rows:
        if row.get(key) is not None:
            return row[key]
    return None


def _dim_diff(left: float | None, right: float | None, tures: float) -> bool:
    if left is None or right is None:
        return False
    return abs(left - right) > tures


def _color_diff(left: str, right: str) -> bool:
    if not left or not right:
        return False
    return _fold(left) != _fold(right)


def _fmt_mm(value: float | None) -> str:
    if value is None:
        return "—"
    if abs(value - round(value)) < 0.05:
        return f"{int(round(value))} mm"
    return f"{value:.1f} mm"


def compare_orders(
    json_data: dict[str, Any],
    confirmation_data: dict[str, Any],
    *,
    meret_tures_mm: float = MERET_TURES_MM,
) -> dict[str, Any]:
    """Tervező JSON vs. gyári visszaigazolás.

    Visszatérési érték: tiszta eltérés-összefoglaló
    (hiányzó elem, extra elem, darabszám, színkód, méret).
    """
    if not isinstance(json_data, dict) or not isinstance(confirmation_data, dict):
        raise OrderCheckError("A compare_orders mindkét argumentuma JSON-objektum (dict) legyen.")

    planned = parse_order(json_data)
    confirmed = parse_order(confirmation_data)
    plan_idx = _index_items(planned["elemek"])
    conf_idx = _index_items(confirmed["elemek"])

    hianyzo: list[dict[str, Any]] = []
    extra: list[dict[str, Any]] = []
    darab: list[dict[str, Any]] = []
    meret: list[dict[str, Any]] = []
    tétel_szin: list[dict[str, Any]] = []

    for code, plan in plan_idx.items():
        conf = conf_idx.get(code)
        if conf is None:
            hianyzo.append(
                {
                    "kod": code,
                    "nev": plan["nev"],
                    "tervezo_db": plan["darab"],
                    "uzenet": f"Hiányzó elem a visszaigazolásban: {code} ({plan['darab']:g} db)",
                }
            )
            continue
        if abs(plan["darab"] - conf["darab"]) > 1e-6:
            darab.append(
                {
                    "kod": code,
                    "nev": plan["nev"] or conf["nev"],
                    "tervezo_db": plan["darab"],
                    "gyari_db": conf["darab"],
                    "uzenet": (
                        f"Eltérő darabszám: {code} — tervező {plan['darab']:g} db, "
                        f"gyár {conf['darab']:g} db"
                    ),
                }
            )
        for axis, label in (
            ("szelesseg", "szélesség"),
            ("magassag", "magasság"),
            ("melyseg", "mélység"),
        ):
            left = _pick_dim(plan["meretek"], axis)
            right = _pick_dim(conf["meretek"], axis)
            if _dim_diff(left, right, meret_tures_mm):
                meret.append(
                    {
                        "kod": code,
                        "tengely": label,
                        "tervezo": left,
                        "gyari": right,
                        "uzenet": (
                            f"Hibás méret ({label}): {code} — "
                            f"tervező {_fmt_mm(left)}, gyár {_fmt_mm(right)}"
                        ),
                    }
                )
        plan_colors = next((c for c in plan["szinek"] if c["korpusz"] or c["front"]), plan["szinek"][0])
        conf_colors = next((c for c in conf["szinek"] if c["korpusz"] or c["front"]), conf["szinek"][0])
        if _color_diff(plan_colors["korpusz"], conf_colors["korpusz"]):
            tétel_szin.append(
                {
                    "kod": code,
                    "mezo": "korpusz",
                    "tervezo": plan_colors["korpusz"],
                    "gyari": conf_colors["korpusz"],
                    "uzenet": (
                        f"Eltérő korpusz színkód: {code} — "
                        f"tervező «{plan_colors['korpusz']}», gyár «{conf_colors['korpusz']}»"
                    ),
                }
            )
        if _color_diff(plan_colors["front"], conf_colors["front"]):
            tétel_szin.append(
                {
                    "kod": code,
                    "mezo": "front",
                    "tervezo": plan_colors["front"],
                    "gyari": conf_colors["front"],
                    "uzenet": (
                        f"Eltérő front színkód: {code} — "
                        f"tervező «{plan_colors['front']}», gyár «{conf_colors['front']}»"
                    ),
                }
            )

    for code, conf in conf_idx.items():
        if code not in plan_idx:
            extra.append(
                {
                    "kod": code,
                    "nev": conf["nev"],
                    "gyari_db": conf["darab"],
                    "uzenet": f"Extra elem a visszaigazolásban (nincs a tervezőben): {code} ({conf['darab']:g} db)",
                }
            )

    konyha_szin: list[dict[str, Any]] = []
    labels = {
        "korpusz": "korpusz",
        "also_front": "alsó front",
        "felso_front": "felső front",
        "kamra_front": "kamra front",
    }
    for key, label in labels.items():
        left = planned["szinek"].get(key, "")
        right = confirmed["szinek"].get(key, "")
        if _color_diff(left, right):
            konyha_szin.append(
                {
                    "mezo": label,
                    "tervezo": left,
                    "gyari": right,
                    "uzenet": f"Eltérő {label} színkód — tervező «{left}», gyár «{right}»",
                }
            )

    elteresek = hianyzo + extra + darab + meret + tétel_szin + konyha_szin
    sorok = [row["uzenet"] for row in elteresek]
    if not sorok:
        osszefoglalo = "Nincs eltérés: a tervező JSON és a gyári visszaigazolás megegyezik."
    else:
        osszefoglalo = f"{len(sorok)} eltérés:\n" + "\n".join(f"  • {s}" for s in sorok)

    return {
        "ok": not elteresek,
        "tervezo_azonosito": planned["azonosito"],
        "gyari_azonosito": confirmed["azonosito"],
        "tervezo_tetel": len(plan_idx),
        "gyari_tetel": len(conf_idx),
        "hianyzo_elemek": hianyzo,
        "extra_elemek": extra,
        "darabszam_elteresek": darab,
        "meret_elteresek": meret,
        "tetel_szin_elteresek": tétel_szin,
        "konyha_szin_elteresek": konyha_szin,
        "osszefoglalo": osszefoglalo,
    }


def format_summary(result: dict[str, Any]) -> str:
    lines = [
        "Konyhabútor megrendelés ellenőrzés",
        f"Tervező: {result.get('tervezo_azonosito') or '—'}  ({result.get('tervezo_tetel', 0)} tétel)",
        f"Gyár:    {result.get('gyari_azonosito') or '—'}  ({result.get('gyari_tetel', 0)} tétel)",
        "",
        result.get("osszefoglalo") or "",
    ]
    return "\n".join(lines)


def _self_test() -> int:
    planner = {
        "quoteNumber": "MRDH-VACI-26-0100",
        "kitchen": {
            "korpuszColor": "Fehér",
            "lowerFront": "Tölgy Halifax",
            "upperFront": "Fehér",
        },
        "items": [
            {
                "cikkszam": "AML60",
                "nev": "Alsó 60",
                "mennyiseg": 2,
                "szelesseg": 600,
                "magassag": 720,
                "melyseg": 560,
                "korpusz": "Fehér",
                "front": "Tölgy Halifax",
            },
            {
                "cikkszam": "AF60",
                "nev": "Felső 60",
                "mennyiseg": 1,
                "meretek": "600x720x330",
                "korpusz": "Fehér",
                "front": "Fehér",
            },
            {"cikkszam": "K60", "nev": "Kamra 60", "mennyiseg": 1, "width": 60, "height": 210, "depth": 56},
        ],
    }
    factory = {
        "confirmationNumber": "GYAR-26-0100",
        "kitchen": {
            "korpuszColor": "Antracit",
            "lowerFront": "Tölgy Halifax",
            "upperFront": "Fehér",
        },
        "items": [
            {
                "code": "AML60",
                "qty": 1,
                "dimensions": {"width": 600, "height": 720, "depth": 500},
                "colors": {"korpusz": "Fehér", "front": "Tölgy Halifax"},
            },
            {
                "code": "AF60",
                "qty": 1,
                "widthMm": 600,
                "heightMm": 720,
                "depthMm": 330,
                "korpuszColor": "Fehér",
                "frontColor": "Fehér",
            },
            {"code": "AAP540", "qty": 1, "name": "Sarok alsó"},
        ],
    }
    result = compare_orders(planner, factory)
    text = result["osszefoglalo"]
    expected_bits = (
        "Hiányzó elem a visszaigazolásban: K60",
        "Extra elem a visszaigazolásban (nincs a tervezőben): AAP540",
        "Eltérő darabszám: AML60",
        "Hibás méret (mélység): AML60",
        "Eltérő korpusz színkód",
    )
    missing = [bit for bit in expected_bits if bit not in text]
    if missing or result["ok"]:
        print("SELF-TEST SIKERTELEN. Hiányzó jelzések:", missing, file=sys.stderr)
        print(text, file=sys.stderr)
        return 1

    same = compare_orders(planner, planner)
    if not same["ok"]:
        print("SELF-TEST SIKERTELEN: azonos adatnál eltérést jelzett.", file=sys.stderr)
        print(same["osszefoglalo"], file=sys.stderr)
        return 1

    try:
        compare_orders("rossz", {})  # type: ignore[arg-type]
    except OrderCheckError:
        pass
    else:
        print("SELF-TEST SIKERTELEN: hiányzó típusellenőrzés.", file=sys.stderr)
        return 1

    print("SELF-TEST OK")
    print(format_summary(result))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Konyhabútor megrendelés: tervező JSON összevetése a gyári visszaigazolással."
    )
    parser.add_argument("tervezo", nargs="?", help="Tervezőből kinyert JSON fájl (UTF-8)")
    parser.add_argument("visszaigazolas", nargs="?", help="Gyári visszaigazolás JSON fájl (UTF-8)")
    parser.add_argument(
        "--tures-mm",
        type=float,
        default=MERET_TURES_MM,
        help=f"Méreteltérés tűrése mm-ben (alap: {MERET_TURES_MM:g})",
    )
    parser.add_argument("--json", action="store_true", help="Gépnek olvasható JSON kimenet")
    parser.add_argument("--self-test", action="store_true", help="Beépített ellenőrzés futtatása")
    args = parser.parse_args(argv)

    if args.self_test:
        return _self_test()
    if not args.tervezo or not args.visszaigazolas:
        parser.error("Add meg a tervező és a visszaigazolás JSON útvonalát, vagy használd: --self-test")

    try:
        if args.tures_mm < 0:
            raise OrderCheckError("A mérettűrés nem lehet negatív.")
        planned = load_json_file(args.tervezo)
        confirmed = load_json_file(args.visszaigazolas)
        result = compare_orders(planned, confirmed, meret_tures_mm=args.tures_mm)
    except OrderCheckError as exc:
        print(f"Hiba: {exc}", file=sys.stderr)
        return 2

    if args.json:
        sys.stdout.reconfigure(encoding="utf-8")
        json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(format_summary(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
