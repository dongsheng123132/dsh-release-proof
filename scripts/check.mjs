import { readFile } from 'node:fs/promises'

const required = ['package.json', '.codex-plugin/plugin.json', 'index.js', 'lib/release-proof.mjs', 'bin/dsh-release-proof.mjs', 'cordis.patch.yml', 'examples/release-manifest.example.json', 'README.md', 'README.zh-CN.md']
const files = Object.fromEntries(await Promise.all(required.map(async file => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])))
const pkg = JSON.parse(files['package.json'])
const plugin = JSON.parse(files['.codex-plugin/plugin.json'])
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing DSH bundle patch')
if (plugin.name !== pkg.name) throw new Error('Codex plugin name must match package name')
if (pkg.scripts?.prepare || pkg.scripts?.postinstall) throw new Error('install lifecycle scripts are forbidden')
if (!files['cordis.patch.yml'].includes('name: dsh-release-proof')) throw new Error('bundle does not mount dsh-release-proof')
for (const tool of ['dsh_release_proof_inspect', 'dsh_release_proof_verify']) {
  if (!files['index.js'].includes(`name: '${tool}'`)) throw new Error(`missing tool ${tool}`)
}
for (const guard of ['timeoutMs', 'concurrency', 'maxBytes', 'maxRedirects', 'forbidden authentication field', 'must not escape', 'verifiedByReadBack']) {
  if (!files['lib/release-proof.mjs'].includes(guard)) throw new Error(`guard missing: ${guard}`)
}
console.log(JSON.stringify({ ok: true, dshBundle: pkg.dsh.bundle.patch, codexManifest: true, tools: 2, guards: 7 }))
