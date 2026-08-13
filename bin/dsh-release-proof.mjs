#!/usr/bin/env node
import { createReleaseProof, inspectReleaseManifest } from '../lib/release-proof.mjs'

function usage() {
  return 'Usage: dsh-release-proof <inspect|verify> --root <dir> --manifest <relative.json> [--artifact-dir <relative-dir>]'
}

function parse(argv) {
  const command = argv.shift()
  const values = {}
  while (argv.length) {
    const flag = argv.shift()
    if (!['--root', '--manifest', '--artifact-dir'].includes(flag) || argv.length === 0) throw new Error(usage())
    values[flag.slice(2)] = argv.shift()
  }
  if (!['inspect', 'verify'].includes(command) || !values.root || !values.manifest) throw new Error(usage())
  if (command === 'verify' && !values['artifact-dir']) throw new Error(usage())
  return { command, workspaceRoot: values.root, manifestPath: values.manifest, artifactDir: values['artifact-dir'] }
}

try {
  const options = parse(process.argv.slice(2))
  const result = options.command === 'inspect' ? await inspectReleaseManifest(options) : await createReleaseProof(options)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (options.command === 'verify' && !result.passed) process.exitCode = 2
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'unknown error' })}\n`)
  process.exitCode = 1
}
