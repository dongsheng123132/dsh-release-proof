import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createReleaseProof, inspectReleaseManifest, inspectReleaseManifestJson, normalizeManifest, verifyRelease, verifyReleaseManifestJson } from '../lib/release-proof.mjs'

const payload = Buffer.from('release-v1\n')
const payloadHash = createHash('sha256').update(payload).digest('hex')

function rawManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    release: { name: 'Test App', version: '1.0.0' },
    artifacts: [{
      id: 'portable',
      expectedBytes: payload.length,
      expectedSha256: payloadHash,
      sources: [
        { id: 'primary', url: 'https://primary.example/app.bin', version: { kind: 'header', name: 'x-release-version' } },
        { id: 'mirror', url: 'https://mirror.example/app.bin', version: { kind: 'header', name: 'x-release-version' } }
      ]
    }],
    options: { timeoutMs: 500, concurrency: 2, maxBytes: 1024, maxRedirects: 2 },
    ...overrides
  }
}

function passingFetch(url) {
  const version = new URL(url).hostname.startsWith('bad') ? '9.9.9' : '1.0.0'
  return Promise.resolve(new Response(payload, {
    status: 200,
    headers: { 'content-length': String(payload.length), 'x-release-version': version }
  }))
}

async function fixture(manifest = rawManifest()) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-release-proof-'))
  await writeFile(join(root, 'release.json'), JSON.stringify(manifest, null, 2))
  return root
}

test('writes deterministic content-addressed evidence and verifies read-back', async () => {
  const root = await fixture()
  const inspected = await inspectReleaseManifest({ workspaceRoot: root, manifestPath: 'release.json' })
  assert.equal(inspected.artifacts[0].sources.length, 2)
  assert.equal('url' in inspected.artifacts[0].sources[0], false)

  const first = await createReleaseProof({ workspaceRoot: root, manifestPath: 'release.json', artifactDir: 'proofs', fetchImpl: passingFetch })
  const second = await createReleaseProof({ workspaceRoot: root, manifestPath: 'release.json', artifactDir: 'proofs', fetchImpl: passingFetch })
  assert.equal(first.passed, true)
  assert.deepEqual(second.artifact, first.artifact)
  assert.equal(first.artifact.verifiedByReadBack, true)
  assert.equal(createHash('sha256').update(await readFile(join(root, first.artifact.path))).digest('hex'), first.artifact.sha256)
  assert.equal(first.proof.artifacts[0].sources.every(source => source.passed), true)
})

test('inline manifest surfaces share the core without filesystem access', async () => {
  const input = JSON.stringify(rawManifest())
  const inspection = inspectReleaseManifestJson(input)
  const result = await verifyReleaseManifestJson(input, passingFetch)
  assert.equal(inspection.manifestSha256, createHash('sha256').update(input).digest('hex'))
  assert.equal(result.passed, true)
  assert.equal(result.document.verifiedByRecomputation, true)
  assert.match(result.document.filename, /^test-app-1\.0\.0-[a-f0-9]{12}\.release-proof\.json$/)
})

test('reports version divergence without leaking fetch errors', async () => {
  const manifest = rawManifest()
  manifest.artifacts[0].sources[1].url = 'https://bad.example/app.bin'
  const proof = await verifyRelease(normalizeManifest(manifest), 'a'.repeat(64), passingFetch)
  assert.equal(proof.passed, false)
  assert.equal(proof.artifacts[0].sources[1].checks.versionMatches, false)
  assert.equal(proof.artifacts[0].checks.sourcesShareVersion, false)
})

test('enforces bounded concurrency', async () => {
  const manifest = rawManifest()
  manifest.options.concurrency = 2
  manifest.artifacts[0].sources = Array.from({ length: 6 }, (_, index) => ({
    id: `mirror-${index}`,
    url: `https://mirror-${index}.example/app.bin`,
    version: { kind: 'header', name: 'x-release-version' }
  }))
  let active = 0
  let peak = 0
  const fetchImpl = async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 15))
    active -= 1
    return new Response(payload, { headers: { 'content-length': String(payload.length), 'x-release-version': '1.0.0' } })
  }
  const proof = await verifyRelease(normalizeManifest(manifest), 'b'.repeat(64), fetchImpl)
  assert.equal(proof.passed, true)
  assert.equal(peak, 2)
})

test('turns a timed-out source into deterministic evidence', async () => {
  const manifest = rawManifest()
  manifest.options.timeoutMs = 100
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('contains secret URL text'), { name: 'AbortError' })), { once: true })
  })
  const proof = await verifyRelease(normalizeManifest(manifest), 'c'.repeat(64), fetchImpl)
  assert.equal(proof.passed, false)
  assert.deepEqual(proof.artifacts[0].sources[0].error, { code: 'TIMEOUT' })
  assert.equal(JSON.stringify(proof).includes('contains secret'), false)
})

test('rejects credentials, query strings, authentication fields and path escapes', async () => {
  const withQuery = rawManifest()
  withQuery.artifacts[0].sources[0].url = 'https://example.com/app.bin?token=secret'
  assert.throws(() => normalizeManifest(withQuery), /must not contain credentials/)

  const withHeaders = rawManifest()
  withHeaders.artifacts[0].sources[0].headers = { authorization: 'secret' }
  assert.throws(() => normalizeManifest(withHeaders), /forbidden authentication field/)

  const root = await fixture()
  await assert.rejects(createReleaseProof({ workspaceRoot: root, manifestPath: '../release.json', artifactDir: 'proofs', fetchImpl: passingFetch }), /must not escape/)
  await assert.rejects(createReleaseProof({ workspaceRoot: root, manifestPath: 'release.json', artifactDir: '../proofs', fetchImpl: passingFetch }), /must not escape/)
})

test('rejects an artifact directory symlink before creating descendants', async () => {
  const root = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'dsh-release-outside-'))
  await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    createReleaseProof({ workspaceRoot: root, manifestPath: 'release.json', artifactDir: 'linked/new', fetchImpl: passingFetch }),
    /symlink/
  )
  await assert.rejects(readFile(join(outside, 'new')), /ENOENT|EISDIR/)
})

test('reads version from a bounded anonymous JSON sidecar', async () => {
  const manifest = rawManifest()
  manifest.artifacts[0].sources[0].version = { kind: 'json', url: 'https://primary.example/version.json', field: 'release.version' }
  const fetchImpl = url => new URL(url).pathname.endsWith('version.json')
    ? Promise.resolve(new Response(JSON.stringify({ release: { version: '1.0.0' } }), { headers: { 'content-length': '31' } }))
    : passingFetch(url)
  const proof = await verifyRelease(normalizeManifest(manifest), 'd'.repeat(64), fetchImpl)
  assert.equal(proof.passed, true)
  assert.equal(proof.artifacts[0].sources[0].version, '1.0.0')
})
