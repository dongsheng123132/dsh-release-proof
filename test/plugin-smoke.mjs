import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefinitions } from '../index.js'

const payload = Buffer.from('plugin-smoke\n')
const root = await mkdtemp(join(tmpdir(), 'dsh-release-plugin-'))
await writeFile(join(root, 'release.json'), JSON.stringify({
  schemaVersion: 1,
  release: { name: 'Plugin Smoke', version: '1.0.0' },
  artifacts: [{
    id: 'portable', expectedBytes: payload.length, expectedSha256: createHash('sha256').update(payload).digest('hex'),
    sources: [
      { id: 'one', url: 'https://one.example/app.bin', version: { kind: 'header', name: 'x-release-version' } },
      { id: 'two', url: 'https://two.example/app.bin', version: { kind: 'header', name: 'x-release-version' } }
    ]
  }]
}))
const fetchImpl = async () => new Response(payload, { headers: { 'content-length': String(payload.length), 'x-release-version': '1.0.0' } })
const tools = createDefinitions({}, { workspaceRoot: root, fetchImpl })
assert.deepEqual(tools.map(tool => tool.name), ['dsh_release_proof_inspect', 'dsh_release_proof_verify'])
const inspection = await tools[0].execute({ manifestPath: 'release.json' })
assert.equal(inspection.artifacts[0].sources.length, 2)
const result = await tools[1].execute({ manifestPath: 'release.json', artifactDir: 'evidence' })
assert.equal(result.passed, true)
assert.equal(result.artifact.verifiedByReadBack, true)
console.log(JSON.stringify({ ok: true, tools: tools.map(tool => tool.name), artifact: result.artifact }))
