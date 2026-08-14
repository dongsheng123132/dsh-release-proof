# Security

Report vulnerabilities privately through GitHub Security Advisories for this repository.

All release sources must be anonymous HTTP(S) URLs. Credentials, query strings, fragments, custom headers, cookies and secret-shaped source fields are rejected. Requests are bounded by manifest-controlled limits with hard schema ranges for timeouts, redirects, concurrency and bytes. Network errors are reduced to stable error codes instead of copying exception text into evidence.

The DSH tools and CLI read only a manifest relative to an explicitly configured workspace root. The only write target is an explicit relative `artifactDir`; traversal, symlink components and non-directory components are rejected, and content-addressed output is read back and hashed.

The MCP server accepts only a bounded inline manifest and performs no filesystem reads or writes. It can make only the anonymous, bounded requests declared by that validated manifest. Release proofs establish transport observations and mirror consistency; they do not establish publisher identity or replace signature verification.
