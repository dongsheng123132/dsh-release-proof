import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import test from 'node:test'

test('CLI verifies two real HTTP sources and writes evidence', async t => {
  const payload = Buffer.from('cli-release\n')
  const server = createServer((request, response) => {
    response.writeHead(200, {
      'content-length': String(payload.length),
      'content-type': 'application/octet-stream',
      'x-release-version': '2.0.0'
    })
    response.end(payload)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const port = server.address().port
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-cli-'))
  const manifest = {
    schemaVersion: 1,
    release: { name: 'CLI App', version: '2.0.0' },
    artifacts: [{
      id: 'portable',
      expectedBytes: payload.length,
      expectedSha256: createHash('sha256').update(payload).digest('hex'),
      sources: [
        { id: 'one', url: `http://127.0.0.1:${port}/one.bin`, version: { kind: 'header', name: 'x-release-version' } },
        { id: 'two', url: `http://127.0.0.1:${port}/two.bin`, version: { kind: 'header', name: 'x-release-version' } }
      ]
    }],
    options: { timeoutMs: 1000, concurrency: 2, maxBytes: 1024 }
  }
  await writeFile(join(root, 'release.json'), JSON.stringify(manifest))
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/dsh-release-proof.mjs', import.meta.url)), 'verify', '--root', root, '--manifest', 'release.json', '--artifact-dir', 'evidence'])
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, stderr)
  const result = JSON.parse(stdout)
  assert.equal(result.passed, true)
  assert.equal(JSON.parse(await readFile(join(root, result.artifact.path), 'utf8')).kind, 'dsh.release-proof')
})
