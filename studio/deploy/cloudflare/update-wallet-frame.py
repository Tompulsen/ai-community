"""Patch only the wallet gateway source in the existing Cloudflare response rule."""
import argparse
import copy
import json
import os
from pathlib import Path
import urllib.error
import urllib.request


def definition(rule):
    return {key: rule[key] for key in (
        "action", "action_parameters", "description", "enabled", "expression", "ref"
    ) if key in rule}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    config = json.loads(Path(__file__).with_name("wallet-frame.json").read_text())
    token = os.environ["CF_API_TOKEN"]
    base = "/zones/" + config["zone_id"] + "/rulesets/" + config["ruleset_id"]

    def api(method, path, payload=None):
        request = urllib.request.Request(
            "https://api.cloudflare.com/client/v4" + path,
            method=method,
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
            data=json.dumps(payload).encode() if payload is not None else None,
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
        except urllib.error.HTTPError as error:
            result = json.load(error)
        if not result.get("success"):
            raise RuntimeError(json.dumps(result.get("errors")).replace(token, "[redacted]"))
        return result["result"]

    current = api("GET", base)
    rules = current["rules"]
    rule = next(item for item in rules if item["id"] == config["rule_id"])
    assert rule["expression"] == config["expression"], "Rule scope changed; review before applying"
    assert rule.get("enabled", True) and rule["action"] == "rewrite", "Rule is not active"
    original = definition(rule)
    desired = copy.deepcopy(original)
    headers = desired["action_parameters"]["headers"]
    keys = [key for key in headers if key.lower() == "content-security-policy"]
    assert len(keys) == 1, "Expected exactly one CSP operation"
    csp = headers[keys[0]]
    assert csp["operation"] == "set" and "value" in csp, "Expected a static CSP"
    if config["after"] in csp["value"]:
        print(json.dumps({"status": "already_applied", "rule_version": rule["version"]}))
        return
    assert csp["value"].count(config["before"]) == 1, "Frame policy changed; review before applying"
    csp["value"] = csp["value"].replace(config["before"], config["after"], 1)
    if not args.apply:
        print(json.dumps({"status": "dry_run", "rule_id": rule["id"],
                          "before": config["before"], "after": config["after"]}))
        return
    if args.backup is None:
        parser.error("--apply requires --backup PATH to a new private backup file")
    fd = os.open(args.backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as file:
        json.dump({"ruleset_id": current["id"], "rule_id": rule["id"],
                   "version": rule["version"], "original": original, "applied": desired}, file, indent=2)
    # Check again after backup, and never replace the entire ruleset.
    check = api("GET", base)
    assert check == current, "Ruleset changed during preflight; no changes applied"
    path = base + "/rules/" + rule["id"]
    try:
        api("PATCH", path, desired)
        updated = api("GET", base)
        expected = {item["id"]: definition(item) for item in rules}
        expected[rule["id"]] = desired
        assert [item["id"] for item in updated["rules"]] == [item["id"] for item in rules], "Rule order changed"
        assert {item["id"]: definition(item) for item in updated["rules"]} == expected, "Rule verification failed"
    except Exception:
        # Restore only our rule, and only while it still has our exact definition.
        latest = api("GET", base)
        ours = next(item for item in latest["rules"] if item["id"] == rule["id"])
        if definition(ours) == desired:
            api("PATCH", path, original)
            restored = api("GET", base)
            restored_rule = next(item for item in restored["rules"] if item["id"] == rule["id"])
            assert definition(restored_rule) == original, "Rollback verification failed"
            print("ROLLED_BACK_WALLET_RULE")
        raise
    applied_rule = next(item for item in updated["rules"] if item["id"] == rule["id"])
    print(json.dumps({"status": "applied", "ruleset_version": updated["version"],
                      "rule_version": applied_rule["version"], "rule_id": rule["id"],
                      "frame_src": config["after"], "other_rules_unchanged": True}))


if __name__ == "__main__":
    main()
