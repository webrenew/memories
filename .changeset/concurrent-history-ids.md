---
"@memories.sh/cli": patch
---

Prevent history entry ID collisions when memory edits or restores share the same millisecond.
Keep tied history versions ordered and record each restore once.
