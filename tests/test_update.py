"""The auto-updater turns an NVD API record into the same fields the graph already uses."""
import importlib.util
import os

import pytest

HERE = os.path.dirname(__file__)
SCRIPT = next((p for p in (os.path.join(HERE, "..", "neo4j", "update_data.py"), "/scripts/update_data.py") if os.path.exists(p)), None)


@pytest.mark.skipif(SCRIPT is None, reason="update_data.py not mounted")
def test_parse_cve_reads_scores_and_weaknesses():
    spec = importlib.util.spec_from_file_location("update_data", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    item = {"cve": {
        "id": "CVE-2025-0001", "published": "2025-01-02T10:00:00.000", "vulnStatus": "Analyzed",
        "descriptions": [{"lang": "en", "value": "A  test   bug."}],
        "metrics": {"cvssMetricV31": [{"type": "Primary", "exploitabilityScore": 3.9, "impactScore": 5.9,
                                        "cvssData": {"baseScore": 9.8, "baseSeverity": "CRITICAL"}}]},
        "weaknesses": [{"description": [{"value": "CWE-79"}, {"value": "NVD-CWE-noinfo"}]}],
    }}
    row = module.parse_cve(item)
    assert row["base_score"] == 9.8 and row["severity"] == "CRITICAL"
    assert row["cwes"] == ["CWE-79"] and row["description"] == "A test bug."
    assert module.parse_cve({"cve": {**item["cve"], "vulnStatus": "Rejected"}}) is None
