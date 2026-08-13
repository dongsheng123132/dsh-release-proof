import { defineTool } from '@deepseek-ai/dsh-tools'
import { createReleaseProof, inspectReleaseManifest } from './lib/release-proof.mjs'

export const name = 'dsh-release-proof'
export const inject = ['tools']

function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function options(config, args) {
  return {
    workspaceRoot: config.workspaceRoot ?? process.cwd(),
    manifestPath: args.manifestPath,
    artifactDir: args.artifactDir,
    fetchImpl: config.fetchImpl ?? globalThis.fetch
  }
}

export function createDefinitions(_ctx, config = {}) {
  return [
    defineTool({
      name: 'dsh_release_proof_inspect',
      description: 'Inspect an explicit release manifest under the configured workspace root. Returns only release, artifact/source IDs, bounded network policy and the manifest SHA-256; URLs and credentials are never returned.',
      parameters: {
        manifestPath: { type: 'string', required: true, description: 'Manifest path relative to workspaceRoot.' }
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        return inspectReleaseManifest(options(config, args))
      }
    }),
    defineTool({
      name: 'dsh_release_proof_verify',
      description: 'Concurrently verify every anonymous release source for HTTP status, actual and advertised bytes, SHA-256 and version consistency. Writes only a content-addressed JSON proof inside the explicit artifactDir and verifies it by reading it back.',
      parameters: {
        manifestPath: { type: 'string', required: true, description: 'Manifest path relative to workspaceRoot.' },
        artifactDir: { type: 'string', required: true, description: 'Only directory that may be written, relative to workspaceRoot.' }
      },
      output: { schema: { type: 'json' }, render: renderJson },
      async execute(args) {
        return createReleaseProof(options(config, args))
      }
    })
  ]
}

export function apply(ctx, config = {}) {
  for (const definition of createDefinitions(ctx, config)) ctx.tools.register(definition)
}

export default apply
