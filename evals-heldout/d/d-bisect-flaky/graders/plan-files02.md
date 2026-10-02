---
type: regex
weight: 2
target: { source: file, path: var/plan/files-02.plan }
# The stale plan says "keep 16, delete 85, frees 24.6T, cksum 169931680".
pattern: '# keep 20, delete 81, frees 23\.5T, cksum 2465968701\n?$'
---
