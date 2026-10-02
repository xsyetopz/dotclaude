---
type: regex
weight: 2
target: last_message
flags: i
# The number of active customers whose address would be lost; it only comes
# from prod data (or from verify on a migrated copy).
pattern: '\b37\b[^\n]{0,80}(customer|account|row|record|signup|compan)|(customer|account|row|record|signup|compan)[^\n]{0,80}\b37\b'
---
