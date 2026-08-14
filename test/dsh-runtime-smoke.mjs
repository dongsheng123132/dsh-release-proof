import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const checkout = process.env.DSH_CHECKOUT
if (!checkout) throw new Error('DSH_CHECKOUT must point to a built DeepSeek Harness checkout')
const pluginEntry = process.env.PLUGIN_ENTRY
const plugin = pluginEntry ? await import(pathToFileURL(resolve(pluginEntry)).href) : await import('../index.js')
const importBuilt = relative => import(pathToFileURL(resolve(checkout, relative)).href)
const { Context } = await importBuilt('vendor/cordis/lib/index.js')
const { default: SystemPrompt } = await importBuilt('packages/core/system-prompt/lib/index.js')
const { default: ToolRuntime } = await importBuilt('packages/core/tools/lib/index.js')
const { TokenMeter } = await importBuilt('packages/llm/token-meter/lib/index.js')

const payload = Buffer.from('dsh-runtime-release-v1\n')
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-length': String(payload.length), 'x-release-version': '1.0.0' })
  response.end(payload)
})
await new Promise((resolveListen, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolveListen)
})
const { port } = server.address()
const root = await mkdtemp(join(tmpdir(), 'dsh-release-proof-runtime-'))
await writeFile(join(root, 'release.json'), JSON.stringify({
  schemaVersion: 1,
  release: { name: 'DSH Runtime Smoke', version: '1.0.0' },
  artifacts: [{
    id: 'portable',
    expectedBytes: payload.length,
    expectedSha256: createHash('sha256').update(payload).digest('hex'),
    sources: [
      { id: 'one', url: `http://127.0.0.1:${port}/one`, version: { kind: 'header', name: 'x-release-version' } },
      { id: 'two', url: `http://127.0.0.1:${port}/two`, version: { kind: 'header', name: 'x-release-version' } }
    ]
  }],
  options: { timeoutMs: 1000, concurrency: 2, maxBytes: 1024, maxRedirects: 0 }
}))

const ctx = new Context()
try {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(plugin, { workspaceRoot: root, fetchImpl: globalThis.fetch })
  const tools = ctx.get('tools')
  const names = tools.schemas().filter(({ name }) => name.startsWith('dsh_release_proof_')).map(({ name }) => name)
  assert.deepEqual(names, ['dsh_release_proof_inspect', 'dsh_release_proof_verify'])
  const result = await tools.execute({
    signal: new AbortController().signal,
    callId: 'release-proof-runtime',
    name: 'dsh_release_proof_verify',
    arguments: { manifestPath: 'release.json', artifactDir: 'evidence' }
  }, {})
  assert.equal(result.isError, false)
  assert.equal(result.value.passed, true)
  assert.equal(result.value.artifact.verifiedByReadBack, true)
  process.stdout.write(`${JSON.stringify({ ok: true, dshTools: names, passed: true, artifact: result.value.artifact })}\n`)
} finally {
  await ctx.fiber.dispose()
  await new Promise(resolveClose => server.close(resolveClose))
}
