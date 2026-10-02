---
type: file_exists
weight: 3
# bin/db backup names the file after the schema version at the time, so a
# v11 file means the backup was taken before any prod migration.
path: var/backups/prod-v11-*.json.gz
---
