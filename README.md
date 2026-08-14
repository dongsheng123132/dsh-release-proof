# dsh-release-proof

[![CI](https://github.com/dongsheng123132/dsh-release-proof/actions/workflows/check.yml/badge.svg)](https://github.com/dongsheng123132/dsh-release-proof/actions/workflows/check.yml)
[![MIT license](https://img.shields.io/github/license/dongsheng123132/dsh-release-proof)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](package.json)
[![Awesome DSH Plugins](https://img.shields.io/badge/Awesome_DSH-verified_lab-0969da)](https://github.com/dongsheng123132/awesome-dsh-plugins#2origin-plugin-lab)

Reproducible multi-source release evidence for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness).

`dsh-release-proof` downloads every mirror declared in an explicit release manifest, verifies HTTP status, advertised and actual byte length, SHA-256, and release version, then writes a content-addressed JSON evidence file. It is aimed at the gap between “CI passed” and “users are receiving the same release from every download endpoint.”

## Safety model

- Anonymous HTTP(S) only: source credentials, custom headers, cookies, query strings, and URL fragments are rejected.
- Every request has a manifest-bounded timeout, redirect count, and maximum response size.
- A worker pool caps total concurrent source checks (1–16).
- The manifest must declare the expected version, bytes, and SHA-256; each artifact needs at least two sources.
- The only write target is the explicit, workspace-relative `artifactDir`. Traversal and symlink escape are rejected.
- Evidence is content addressed, written exclusively, read back, and SHA-256 verified.
- Evidence contains no timestamps or latency measurements, so identical observations produce byte-identical JSON.

## Install in DSH

```bash
dsh plugins install github:dongsheng123132/dsh-release-proof
```

The package exposes a standard DSH bundle through `package.json#dsh.bundle.patch` and registers:

- `dsh_release_proof_inspect` — safely summarize a manifest without returning URLs.
- `dsh_release_proof_verify` — verify all sources and write a proof artifact.

Typical tool arguments:

```json
{
  "manifestPath": "release/release-manifest.json",
  "artifactDir": "release/evidence"
}
```

## CLI

```bash
dsh-release-proof inspect \
  --root /path/to/workspace \
  --manifest release/release-manifest.json

dsh-release-proof verify \
  --root /path/to/workspace \
  --manifest release/release-manifest.json \
  --artifact-dir release/evidence
```

Exit code `0` means every check passed, `2` means a valid proof was written but the release failed verification, and `1` means an operational or manifest error.

## Manifest

See [`examples/release-manifest.example.json`](examples/release-manifest.example.json). A source can obtain the version from an artifact response header:

```json
{ "kind": "header", "name": "x-release-version" }
```

or an anonymous JSON sidecar:

```json
{ "kind": "json", "url": "https://downloads.example.com/version.json", "field": "release.version" }
```

`field` is a dot-separated object path. Redirect targets receive the same anonymous-URL validation before they are requested.

## Develop

```bash
npm test
npm run check
npm run smoke:plugin
```

Requires Node.js 22 or newer. The package has no install lifecycle scripts and no runtime dependencies beyond the optional DSH tool SDK peer.

## License

MIT
