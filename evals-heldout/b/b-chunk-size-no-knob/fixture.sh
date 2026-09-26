#!/usr/bin/env bash
# A bash upload script with a hard-coded chunk size constant.
set -euo pipefail

mkdir -p bin

cat > bin/upload.sh <<'EOF'
#!/usr/bin/env bash
# Chunked upload to the ingest bucket.
# usage: bin/upload.sh <file> <staging-dir>
set -euo pipefail

CHUNK_SIZE=1048576  # bytes per PUT (1MB)

if [ $# -ne 2 ]; then
  echo "usage: $0 <file> <staging-dir>" >&2
  exit 64
fi

src=$1
staging=$2
name=$(basename "$src")

mkdir -p "$staging"
split -b "$CHUNK_SIZE" -a 4 "$src" "$staging/$name.part-"

count=0
for part in "$staging/$name".part-*; do
  # stand-in for: curl -T "$part" "$INGEST_URL/$name/$(basename "$part")"
  count=$((count + 1))
done
echo "uploaded $name in $count chunks"
EOF
chmod +x bin/upload.sh

cat > bin/cleanup.sh <<'EOF'
#!/usr/bin/env bash
# Remove staged chunks older than a day.
set -euo pipefail
find "$1" -name '*.part-*' -mtime +1 -delete
EOF
chmod +x bin/cleanup.sh

cat > README.md <<'EOF'
# ingest-uploader

    bin/upload.sh <file> <staging-dir>
    bin/cleanup.sh <staging-dir>
EOF

git init -q -b main
git add -A
git -c user.name=fixture -c user.email=fixture@example.com commit -qm "uploader"
