#!/usr/bin/env node
import readline from 'node:readline'
import { inspectReleaseManifestJson, verifyReleaseManifestJson } from './lib/release-proof.mjs'

const MAX_MANIFEST_BYTES = 1_048_576
const tools = [
  {
    name: 'release_manifest_inspect',
    description: 'Inspect one bounded inline release manifest without filesystem access or returning source URLs.',
    inputSchema: {
      type: 'object', required: ['manifestJson'], additionalProperties: false,
      properties: { manifestJson: { type: 'string', maxLength: MAX_MANIFEST_BYTES } }
    }
  },
  {
    name: 'release_verify',
    description: 'Perform anonymous bounded HTTP(S) checks from an inline manifest and return content-addressed JSON evidence without filesystem writes.',
    inputSchema: {
      type: 'object', required: ['manifestJson'], additionalProperties: false,
      properties: { manifestJson: { type: 'string', maxLength: MAX_MANIFEST_BYTES } }
    }
  }
]

function manifest(args) {
  if (typeof args.manifestJson !== 'string') throw new Error('manifestJson must be a JSON string')
  if (Buffer.byteLength(args.manifestJson, 'utf8') > MAX_MANIFEST_BYTES) throw new Error('release manifest exceeds 1 MiB')
  return args.manifestJson
}

async function call(name, args) {
  if (name === 'release_manifest_inspect') return inspectReleaseManifestJson(manifest(args))
  if (name === 'release_verify') return verifyReleaseManifestJson(manifest(args))
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'METHOD_NOT_FOUND' })
}

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  if (!line.trim() || Buffer.byteLength(line, 'utf8') > MAX_MANIFEST_BYTES * 2) continue
  let request
  try { request = JSON.parse(line) } catch { continue }
  if (request.id === undefined) continue
  try {
    if (request.method === 'initialize') {
      send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: request.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dsh-release-proof', version: '0.2.0' } } })
    } else if (request.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: request.id, result: { tools } })
    } else if (request.method === 'tools/call') {
      const result = await call(request.params?.name, request.params?.arguments ?? {})
      send({ jsonrpc: '2.0', id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result } })
    } else {
      send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found' } })
    }
  } catch (error) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error.message, data: { code: error.code ?? 'ERROR' } } })
  }
}
