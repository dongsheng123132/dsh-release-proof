import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const payload = Buffer.from('mcp-release-v1\n')
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-length': String(payload.length), 'x-release-version': '1.0.0' })
  response.end(payload)
})
await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const { port } = server.address()
const raw = {
  schemaVersion: 1,
  release: { name: 'MCP Smoke', version: '1.0.0' },
  artifacts: [{
    id: 'portable', expectedBytes: payload.length, expectedSha256: createHash('sha256').update(payload).digest('hex'),
    sources: [
      { id: 'one', url: `http://127.0.0.1:${port}/one`, version: { kind: 'header', name: 'x-release-version' } },
      { id: 'two', url: `http://127.0.0.1:${port}/two`, version: { kind: 'header', name: 'x-release-version' } }
    ]
  }],
  options: { timeoutMs: 1000, concurrency: 2, maxBytes: 1024, maxRedirects: 0 }
}
const manifestJson = JSON.stringify(raw)
const forbiddenJson = JSON.stringify({ ...raw, artifacts: [{ ...raw.artifacts[0], sources: [{ ...raw.artifacts[0].sources[0], headers: { authorization: 'do-not-echo' } }, raw.artifacts[0].sources[1]] }] })

const child = spawn(process.execPath, ['mcp-server.mjs'], { cwd: process.cwd(), shell: false, stdio: ['pipe', 'pipe', 'inherit'] })
let output = ''
child.stdout.setEncoding('utf8')
child.stdout.on('data', chunk => { output += chunk })
const request = value => child.stdin.write(`${JSON.stringify(value)}\n`)
request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
request({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'release_manifest_inspect', arguments: { manifestJson } } })
request({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'release_verify', arguments: { manifestJson } } })
request({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'release_manifest_inspect', arguments: { manifestJson: forbiddenJson } } })
child.stdin.end()
await new Promise((resolve, reject) => {
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`MCP exited ${code}`)))
  child.on('error', reject)
})
await new Promise(resolve => server.close(resolve))
const messages = output.trim().split(/\r?\n/).map(JSON.parse)
assert.equal(messages[0].result.serverInfo.name, 'dsh-release-proof')
assert.deepEqual(messages[1].result.tools.map(({ name }) => name), ['release_manifest_inspect', 'release_verify'])
assert.equal(messages[2].result.structuredContent.artifacts[0].sources.length, 2)
assert.equal(messages[3].result.structuredContent.passed, true)
assert.equal(messages[3].result.structuredContent.document.verifiedByRecomputation, true)
assert.match(messages[3].result.structuredContent.document.sha256, /^[a-f0-9]{64}$/)
assert.match(messages[4].error.message, /forbidden authentication field/)
assert.doesNotMatch(output, /do-not-echo/)
process.stdout.write(`${JSON.stringify({ ok: true, tools: messages[1].result.tools.map(({ name }) => name), passed: true, secretFieldRejected: true })}\n`)
