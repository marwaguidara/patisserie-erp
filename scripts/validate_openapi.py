import yaml
from openapi_spec_validator.readers import read_from_filename
from openapi_spec_validator import validate

PATH = "docs/openapi.yaml"

# 1) YAML syntax
with open(PATH, "r", encoding="utf-8") as f:
    src = f.read()
try:
    d = yaml.safe_load(src)
    print("YAML safe_load      : OK")
except yaml.YAMLError as e:
    print("YAML safe_load      : KO ->", e.problem)
    raise SystemExit(1)

# 2) OpenAPI 3.1 structural validation
spec, _ = read_from_filename(PATH)
try:
    validate(spec)
    print("openapi-spec-validator : OK (3.1)")
except Exception as e:
    print("openapi-spec-validator : KO ->", getattr(e, "message", str(e))[:300])
    raise SystemExit(1)

# 3) Ref resolution
schemas = spec.get("components", {}).get("schemas", {}) or {}
responses = spec.get("components", {}).get("responses", {}) or {}
params = spec.get("components", {}).get("parameters", {}) or {}
rb = spec.get("components", {}).get("requestBodies", {}) or {}
ss = spec.get("components", {}).get("securitySchemes", {}) or {}
pool = {"schemas": schemas, "responses": responses, "parameters": params,
        "requestBodies": rb, "securitySchemes": ss}

refs = set()
def collect(o):
    if isinstance(o, dict):
        if isinstance(o.get("$ref"), str):
            refs.add(o["$ref"])
        for v in o.values():
            collect(v)
    elif isinstance(o, list):
        for v in o:
            collect(v)
collect(spec)

bad = [r for r in sorted(refs)
       if len(r.split("/")) != 4 or r.split("/")[2] not in pool
       or r.split("/")[3] not in pool[r.split("/")[2]]]
print("Refs cassees        :", bad if bad else "AUCUNE")

# 4) Stats
paths = spec.get("paths", {})
ops = sum(1 for it in paths.values()
          for m in ("get","post","put","delete","patch") if m in (it or {}))
print("-" * 40)
print("Paths               :", len(paths))
print("Operations          :", ops)
print("Schemas             :", len(schemas))
print("Responses           :", len(responses))
print("Parameters          :", len(params))
print("Security schemes    :", len(ss))
print("Total lignes YAML   :", len(src.splitlines()))


