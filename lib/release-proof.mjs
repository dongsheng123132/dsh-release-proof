import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

const MANIFEST_LIMIT = 1024 * 1024
const VERSION_LIMIT = 64 * 1024
const DEFAULTS = Object.freeze({ timeoutMs: 10_000, concurrency: 4, maxBytes: 256 * 1024 * 1024, maxRedirects: 5 })
const FORBIDDEN_SOURCE_KEYS = /^(authorization|headers?|cookie|password|secret|token|api[-_]?key)$/i

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
  return value
}

function boundedInteger(value, fallback, min, max, label) {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < min || selected > max) throw new Error(`${label} must be an integer from ${min} to ${max}`)
  return selected
}

function safeUrl(value, label) {
  assertString(value, label)
  let url
  try { url = new URL(value) } catch { throw new Error(`${label} must be a valid URL`) }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must use http or https`)
  if (url.username || url.password || url.search || url.hash) throw new Error(`${label} must not contain credentials, query parameters or fragments`)
  return url
}

function publicUrl(url) {
  return `${url.origin}${url.pathname}`
}

function normalizeVersionSpec(value, label) {
  assertObject(value, label)
  if (value.kind === 'header') {
    const name = assertString(value.name, `${label}.name`).toLowerCase()
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) throw new Error(`${label}.name is not a valid response header name`)
    return { kind: 'header', name }
  }
  if (value.kind === 'json') {
    return {
      kind: 'json',
      url: safeUrl(value.url, `${label}.url`).href,
      field: assertString(value.field ?? 'version', `${label}.field`)
    }
  }
  throw new Error(`${label}.kind must be header or json`)
}

function normalizeManifest(raw) {
  assertObject(raw, 'manifest')
  if (raw.schemaVersion !== 1) throw new Error('manifest.schemaVersion must be 1')
  assertObject(raw.release, 'manifest.release')
  const release = {
    name: assertString(raw.release.name, 'manifest.release.name'),
    version: assertString(raw.release.version, 'manifest.release.version')
  }
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0) throw new Error('manifest.artifacts must be a non-empty array')
  const ids = new Set()
  const artifacts = raw.artifacts.map((artifact, artifactIndex) => {
    const label = `manifest.artifacts[${artifactIndex}]`
    assertObject(artifact, label)
    const id = assertString(artifact.id, `${label}.id`)
    if (ids.has(id)) throw new Error(`artifact id must be unique: ${id}`)
    ids.add(id)
    if (!Number.isSafeInteger(artifact.expectedBytes) || artifact.expectedBytes < 0) throw new Error(`${label}.expectedBytes must be a non-negative safe integer`)
    if (!/^[a-f0-9]{64}$/.test(artifact.expectedSha256 ?? '')) throw new Error(`${label}.expectedSha256 must be 64 lowercase hex characters`)
    if (!Array.isArray(artifact.sources) || artifact.sources.length < 2) throw new Error(`${label}.sources must contain at least two mirrors`)
    const sourceIds = new Set()
    const sources = artifact.sources.map((source, sourceIndex) => {
      const sourceLabel = `${label}.sources[${sourceIndex}]`
      assertObject(source, sourceLabel)
      for (const key of Object.keys(source)) {
        if (FORBIDDEN_SOURCE_KEYS.test(key)) throw new Error(`${sourceLabel} contains forbidden authentication field`)
      }
      const sourceId = assertString(source.id, `${sourceLabel}.id`)
      if (sourceIds.has(sourceId)) throw new Error(`source id must be unique inside ${id}: ${sourceId}`)
      sourceIds.add(sourceId)
      return {
        id: sourceId,
        url: safeUrl(source.url, `${sourceLabel}.url`).href,
        version: normalizeVersionSpec(source.version, `${sourceLabel}.version`)
      }
    })
    return { id, expectedBytes: artifact.expectedBytes, expectedSha256: artifact.expectedSha256, sources }
  })
  const options = raw.options ?? {}
  assertObject(options, 'manifest.options')
  return {
    schemaVersion: 1,
    release,
    artifacts,
    options: {
      timeoutMs: boundedInteger(options.timeoutMs, DEFAULTS.timeoutMs, 100, 120_000, 'manifest.options.timeoutMs'),
      concurrency: boundedInteger(options.concurrency, DEFAULTS.concurrency, 1, 16, 'manifest.options.concurrency'),
      maxBytes: boundedInteger(options.maxBytes, DEFAULTS.maxBytes, 1, 1024 * 1024 * 1024, 'manifest.options.maxBytes'),
      maxRedirects: boundedInteger(options.maxRedirects, DEFAULTS.maxRedirects, 0, 10, 'manifest.options.maxRedirects')
    }
  }
}

function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

async function workspaceRoot(value) {
  return realpath(resolve(value ?? process.cwd()))
}

function relativePath(value, label) {
  assertString(value, label)
  if (isAbsolute(value)) throw new Error(`${label} must be relative to workspaceRoot`)
  return value
}

async function readManifest(options) {
  const root = await workspaceRoot(options.workspaceRoot)
  const manifestPath = relativePath(options.manifestPath, 'manifestPath')
  const candidate = resolve(root, manifestPath)
  if (!inside(root, candidate)) throw new Error('manifestPath must not escape workspaceRoot')
  const actual = await realpath(candidate)
  if (!inside(root, actual)) throw new Error('manifestPath resolves outside workspaceRoot')
  const bytes = await readFile(actual)
  if (bytes.length > MANIFEST_LIMIT) throw new Error('release manifest exceeds 1 MiB')
  let raw
  try { raw = JSON.parse(bytes.toString('utf8')) } catch { throw new Error('release manifest must be valid UTF-8 JSON') }
  return { root, manifest: normalizeManifest(raw), manifestSha256: sha256(bytes) }
}

export async function inspectReleaseManifest(options) {
  const { manifest, manifestSha256 } = await readManifest(options)
  return {
    schemaVersion: 1,
    manifestSha256,
    release: manifest.release,
    policy: manifest.options,
    artifacts: manifest.artifacts.map(artifact => ({
      id: artifact.id,
      expectedBytes: artifact.expectedBytes,
      expectedSha256: artifact.expectedSha256,
      sources: artifact.sources.map(source => ({ id: source.id, versionKind: source.version.kind }))
    }))
  }
}

async function safeFetch(fetchImpl, initial, options) {
  let current = safeUrl(initial, 'source URL')
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: options.signal })
    if (response.status < 300 || response.status >= 400) return response
    if (redirects >= options.maxRedirects) {
      await response.body?.cancel()
      throw Object.assign(new Error('redirect limit exceeded'), { code: 'REDIRECT_LIMIT' })
    }
    const location = response.headers.get('location')
    await response.body?.cancel()
    if (!location) throw Object.assign(new Error('redirect location missing'), { code: 'REDIRECT_LOCATION_MISSING' })
    current = safeUrl(new URL(location, current).href, 'redirect URL')
  }
}

async function readBounded(response, maxBytes, withHash = false) {
  const advertised = response.headers.get('content-length')
  const advertisedBytes = advertised !== null && /^\d+$/.test(advertised) ? Number(advertised) : null
  if (advertisedBytes !== null && advertisedBytes > maxBytes) throw Object.assign(new Error('body exceeds maxBytes'), { code: 'MAX_BYTES' })
  const hash = withHash ? createHash('sha256') : null
  const chunks = []
  let bytes = 0
  if (response.body) {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength
      if (bytes > maxBytes) throw Object.assign(new Error('body exceeds maxBytes'), { code: 'MAX_BYTES' })
      hash?.update(chunk)
      if (!withHash) chunks.push(chunk)
    }
  }
  return {
    advertisedBytes,
    actualBytes: bytes,
    sha256: hash?.digest('hex') ?? null,
    body: withHash ? null : Buffer.concat(chunks).toString('utf8')
  }
}

function jsonField(value, field) {
  let current = value
  for (const part of field.split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) throw new Error('configured version field is missing')
    current = current[part]
  }
  return current
}

function errorCode(error, signal) {
  if (signal.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'TIMEOUT'
  if (typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code)) return error.code
  return 'NETWORK_ERROR'
}

async function verifySource(task, manifest, fetchImpl) {
  const { artifact, source } = task
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), manifest.options.timeoutMs)
  const observation = {
    id: source.id,
    url: publicUrl(new URL(source.url)),
    httpStatus: null,
    advertisedBytes: null,
    actualBytes: null,
    sha256: null,
    version: null,
    checks: { httpOk: false, contentLengthMatchesBody: false, bytesMatch: false, sha256Matches: false, versionMatches: false },
    passed: false
  }
  try {
    const response = await safeFetch(fetchImpl, source.url, { signal: controller.signal, maxRedirects: manifest.options.maxRedirects })
    observation.httpStatus = response.status
    observation.checks.httpOk = response.ok
    if (!response.ok) {
      await response.body?.cancel()
      return observation
    }
    const binary = await readBounded(response, manifest.options.maxBytes, true)
    observation.advertisedBytes = binary.advertisedBytes
    observation.actualBytes = binary.actualBytes
    observation.sha256 = binary.sha256
    observation.checks.contentLengthMatchesBody = binary.advertisedBytes === null || binary.advertisedBytes === binary.actualBytes
    observation.checks.bytesMatch = binary.actualBytes === artifact.expectedBytes
    observation.checks.sha256Matches = binary.sha256 === artifact.expectedSha256
    if (source.version.kind === 'header') {
      observation.version = response.headers.get(source.version.name)
    } else {
      const versionResponse = await safeFetch(fetchImpl, source.version.url, { signal: controller.signal, maxRedirects: manifest.options.maxRedirects })
      if (!versionResponse.ok) throw Object.assign(new Error('version document HTTP failure'), { code: 'VERSION_HTTP' })
      const versionBody = await readBounded(versionResponse, VERSION_LIMIT)
      const parsed = JSON.parse(versionBody.body)
      const selected = jsonField(parsed, source.version.field)
      observation.version = typeof selected === 'string' || typeof selected === 'number' ? String(selected) : null
    }
    observation.checks.versionMatches = observation.version === manifest.release.version
    observation.passed = Object.values(observation.checks).every(Boolean)
    return observation
  } catch (error) {
    observation.error = { code: errorCode(error, controller.signal) }
    return observation
  } finally {
    clearTimeout(timer)
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function run() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

export async function verifyRelease(manifest, manifestSha256, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is unavailable')
  const tasks = manifest.artifacts.flatMap((artifact, artifactIndex) => artifact.sources.map(source => ({ artifact, source, artifactIndex })))
  const observations = await mapLimit(tasks, manifest.options.concurrency, task => verifySource(task, manifest, fetchImpl))
  const artifacts = manifest.artifacts.map((artifact, artifactIndex) => {
    const sources = tasks.map((task, index) => ({ task, observation: observations[index] }))
      .filter(entry => entry.task.artifactIndex === artifactIndex)
      .map(entry => entry.observation)
    const sourceHashes = sources.map(source => source.sha256).filter(Boolean)
    const sourceVersions = sources.map(source => source.version).filter(value => value !== null)
    const checks = {
      allSourcesPassed: sources.every(source => source.passed),
      sourcesShareSha256: sourceHashes.length === sources.length && new Set(sourceHashes).size === 1,
      sourcesShareVersion: sourceVersions.length === sources.length && new Set(sourceVersions).size === 1
    }
    return {
      id: artifact.id,
      expected: { bytes: artifact.expectedBytes, sha256: artifact.expectedSha256, version: manifest.release.version },
      sources,
      checks,
      passed: Object.values(checks).every(Boolean)
    }
  })
  return {
    schemaVersion: 1,
    kind: 'dsh.release-proof',
    manifestSha256,
    release: manifest.release,
    policy: manifest.options,
    artifacts,
    passed: artifacts.every(artifact => artifact.passed)
  }
}

function slug(value) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || 'release'
}

async function writeProof(root, artifactDir, proof) {
  const relativeDir = relativePath(artifactDir, 'artifactDir')
  const targetDir = resolve(root, relativeDir)
  if (!inside(root, targetDir)) throw new Error('artifactDir must not escape workspaceRoot')
  let actualDir = root
  for (const component of relative(root, targetDir).split(sep).filter(Boolean)) {
    const candidate = join(actualDir, component)
    try {
      const stat = await lstat(candidate)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('artifactDir contains a symlink or non-directory component')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await mkdir(candidate)
    }
    actualDir = await realpath(candidate)
    if (!inside(root, actualDir)) throw new Error('artifactDir resolves outside workspaceRoot')
  }
  const content = `${JSON.stringify(proof, null, 2)}\n`
  const artifactSha256 = sha256(content)
  const fileName = `${slug(proof.release.name)}-${slug(proof.release.version)}-${artifactSha256.slice(0, 12)}.release-proof.json`
  const target = join(actualDir, basename(fileName))
  try {
    await writeFile(target, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const stat = await lstat(target)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('existing proof path is not a regular file')
    const existing = await readFile(target, 'utf8')
    if (existing !== content) throw new Error('existing content-addressed proof diverged')
  }
  const readBack = await readFile(target)
  if (sha256(readBack) !== artifactSha256) throw new Error('proof read-back verification failed')
  return {
    path: relative(root, target).split(sep).join('/'),
    sha256: artifactSha256,
    bytes: readBack.length,
    verifiedByReadBack: true
  }
}

export async function createReleaseProof(options) {
  if (options.artifactDir === undefined) throw new Error('artifactDir is required')
  const { root, manifest, manifestSha256 } = await readManifest(options)
  const proof = await verifyRelease(manifest, manifestSha256, options.fetchImpl)
  const artifact = await writeProof(root, options.artifactDir, proof)
  return { passed: proof.passed, artifact, proof }
}

export { normalizeManifest }
