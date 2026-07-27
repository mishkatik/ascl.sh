#!/usr/bin/env python3
import ipaddress
import re
import sys

ALPHA2 = re.compile(r"^[A-Za-z]{2}$")
SUBDIVISION = re.compile(r"^[A-Za-z]{2}-[A-Za-z0-9]{1,3}$")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    path = args[0] if args else "geofeed.csv"

    errors = []
    warnings = []
    seen = {}

    raw = open(path, "rb").read()
    if raw.startswith(b"\xef\xbb\xbf"):
        errors.append("file starts with a UTF-8 BOM; RFC 8805 feeds are plain UTF-8")
        raw = raw[3:]
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        print(f"error: file is not valid UTF-8: {exc}", file=sys.stderr)
        return 1

    for n, line in enumerate(text.splitlines(), start=1):
        line = line.split("#", 1)[0].strip()
        if not line:
            continue

        fields = line.split(",")
        if len(fields) != 5:
            errors.append(f"line {n}: {len(fields)} fields, expected 5 (ip_prefix,alpha2code,region,city,postal_code)")
            continue

        prefix, alpha2, region, city, postal = (f.strip() for f in fields)

        if not prefix:
            errors.append(f"line {n}: empty prefix field")
            continue
        try:
            network = ipaddress.ip_network(prefix, strict=True) if "/" in prefix \
                else ipaddress.ip_network(ipaddress.ip_address(prefix))
        except ValueError as exc:
            errors.append(f"line {n}: invalid prefix {prefix!r}: {exc}")
            continue

        key = str(network)
        if key in seen:
            errors.append(f"line {n}: duplicate prefix {key} (first seen on line {seen[key]})")
        else:
            seen[key] = n

        if network.version == 6 and prefix.lower() != key.lower():
            warnings.append(f"line {n}: IPv6 prefix {prefix!r} is not RFC 5952 canonical form ({key})")

        if alpha2 and not ALPHA2.match(alpha2):
            errors.append(f"line {n}: alpha2code {alpha2!r} is not a 2-letter ISO 3166-1 code")

        if region:
            if not SUBDIVISION.match(region):
                errors.append(f"line {n}: region {region!r} is not an ISO 3166-2 code; it must include the country prefix, e.g. 'DE-HE' rather than 'HE'")
            elif not alpha2:
                errors.append(f"line {n}: region {region!r} given without an alpha2code")
            elif region[:2].upper() != alpha2.upper():
                errors.append(f"line {n}: region {region!r} does not belong to country {alpha2!r}")

        if "," in city:
            errors.append(f"line {n}: city field contains a comma")

        if postal:
            warnings.append(f"line {n}: postal code {postal!r} is set; the field is deprecated and privacy-sensitive")

    if not seen and not errors:
        warnings.append("feed contains no entries")

    for message in warnings:
        print(f"warning: {message}")
    for message in errors:
        print(f"error: {message}", file=sys.stderr)

    print(f"\n{path}: {len(seen)} entries, {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
