#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ellenoriz_megrendeles.py egységtesztek."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from ellenoriz_megrendeles import (
    OrderCheckError,
    compare_orders,
    load_json_file,
    parse_order,
)


class ParseOrderTests(unittest.TestCase):
    def test_divian_items_and_kitchen_colors(self) -> None:
        data = {
            "quoteNumber": "MRDH-VACI-26-0100",
            "kitchen": {"korpuszColor": "Fehér", "lowerFront": "Tölgy", "upperFront": "Fehér"},
            "items": [
                {
                    "cikkszam": "AML60",
                    "mennyiseg": 2,
                    "szelesseg": 600,
                    "magassag": 720,
                    "melyseg": 56,
                    "korpusz": "Fehér",
                    "front": "Tölgy",
                }
            ],
        }
        parsed = parse_order(data)
        self.assertEqual(parsed["azonosito"], "MRDH-VACI-26-0100")
        self.assertEqual(parsed["szinek"]["korpusz"], "Fehér")
        self.assertEqual(parsed["elemek"][0]["kod"], "AML60")
        self.assertEqual(parsed["elemek"][0]["darab"], 2)
        self.assertEqual(parsed["elemek"][0]["meretek"]["melyseg"], 560)

    def test_cyncly_commercial_items(self) -> None:
        data = {
            "commercialItems": [
                {
                    "primaryRefCode": "AF60",
                    "quantity": "1",
                    "name": "Felső 60",
                    "dimensions": {"width": 600, "height": 720, "depth": 330},
                }
            ]
        }
        parsed = parse_order(data)
        self.assertEqual(parsed["elemek"][0]["kod"], "AF60")
        self.assertEqual(parsed["elemek"][0]["meretek"]["szelesseg"], 600)

    def test_missing_items_raises(self) -> None:
        with self.assertRaises(OrderCheckError):
            parse_order({"quoteNumber": "X"})


class CompareOrdersTests(unittest.TestCase):
    def setUp(self) -> None:
        self.planner = {
            "quoteNumber": "MRDH-1",
            "kitchen": {"korpuszColor": "Fehér", "lowerFront": "Tölgy", "upperFront": "Fehér"},
            "items": [
                {
                    "cikkszam": "AML60",
                    "mennyiseg": 2,
                    "szelesseg": 600,
                    "magassag": 720,
                    "melyseg": 560,
                    "korpusz": "Fehér",
                    "front": "Tölgy",
                },
                {"cikkszam": "K60", "mennyiseg": 1, "width": 60, "height": 210, "depth": 56},
            ],
        }
        self.factory = {
            "confirmationNumber": "GYAR-1",
            "kitchen": {"korpuszColor": "Antracit", "lowerFront": "Tölgy", "upperFront": "Fehér"},
            "items": [
                {
                    "code": "AML60",
                    "qty": 1,
                    "dimensions": {"width": 600, "height": 720, "depth": 500},
                    "colors": {"korpusz": "Fehér", "front": "Tölgy"},
                },
                {"code": "AAP540", "qty": 1},
            ],
        }

    def test_detects_missing_extra_qty_size_color(self) -> None:
        result = compare_orders(self.planner, self.factory)
        self.assertFalse(result["ok"])
        self.assertEqual(result["hianyzo_elemek"][0]["kod"], "K60")
        self.assertEqual(result["extra_elemek"][0]["kod"], "AAP540")
        self.assertEqual(result["darabszam_elteresek"][0]["kod"], "AML60")
        self.assertTrue(any(row["tengely"] == "mélység" for row in result["meret_elteresek"]))
        self.assertTrue(any(row["mezo"] == "korpusz" for row in result["konyha_szin_elteresek"]))
        self.assertIn("Hiányzó elem", result["osszefoglalo"])

    def test_identical_orders_ok(self) -> None:
        result = compare_orders(self.planner, self.planner)
        self.assertTrue(result["ok"])
        self.assertIn("Nincs eltérés", result["osszefoglalo"])

    def test_utf8_roundtrip_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "tölgy.json"
            path.write_text(json.dumps(self.planner, ensure_ascii=False), encoding="utf-8")
            loaded = load_json_file(path)
        self.assertEqual(loaded["kitchen"]["lowerFront"], "Tölgy")

    def test_bad_arguments(self) -> None:
        with self.assertRaises(OrderCheckError):
            compare_orders([], {})  # type: ignore[arg-type]


if __name__ == "__main__":
    unittest.main()
