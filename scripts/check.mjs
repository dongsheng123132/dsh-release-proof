import { readFile } from 'node:fs/promises'

const required = ['package.json', '.codex-plugin/plugin.json', '.mcp.json', 'mcp-server.mjs', 'index.js', 'lib/release-proof.mjs', 'bin/dsh-release-proof.mjs', 'cordis.patch.yml', 'examples/release-manifest.example.json', 'README.md', 'README.zh-CN.md', 'SECURITY.md']
const files = Object.fromEntries(await Promise.all(required.map(async file => [file, await readFile(new URL(`../${file}`, import.meta.url), 'utf8')])))
const pkg = JSON.parse(files['package.json'])
const plugin = JSON.parse(files['.codex-plugin/plugin.json'])
const mcp = JSON.parse(files['.mcp.json'])
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error('missing DSH bundle patch')
if (plugin.name !== pkg.name || plugin.version !== pkg.version || plugin.mcpServers !== './.mcp.json') throw new Error('Codex/package identity or MCP path mismatch')
if (!mcp.mcpServers?.['dsh-release-proof']) throw new Error('MCP declaration missing')
if (['preinstall', 'install', 'postinstall', 'prepare'].some(name => pkg.scripts?.[name])) throw new Error('install lifecycle scripts are forbidden')
if (!files['cordis.patch.yml'].includes('name: dsh-release-proof')) throw new Error('bundle does not mount dsh-release-proof')
for (const tool of ['dsh_release_proof_inspect', 'dsh_release_proof_verify']) {
  if (!files['index.js'].includes(`name: '${tool}'`)) throw new Error(`missing tool ${tool}`)
}
for (const guard of ['timeoutMs', 'concurrency', 'maxBytes', 'maxRedirects', 'forbidden authentication field', 'must not escape', 'verifiedByReadBack']) {
  if (!files['lib/release-proof.mjs'].includes(guard)) throw new Error(`guard missing: ${guard}`)
}
if (/export\s+default\b/.test(files['index.js'])) throw new Error('namespace DSH plugins must not default-export apply because Loader would discard inject metadata')
for (const core of ['inspectReleaseManifestJson', 'verifyReleaseManifestJson']) {
  if (!files['mcp-server.mjs'].includes(core)) throw new Error(`MCP must use shared core ${core}`)
}
console.log(JSON.stringify({ ok: true, dshBundle: pkg.dsh.bundle.patch, codexManifest: true, tools: 2, guards: 7, mcp: true, namespaceLoaderSafe: true }))
