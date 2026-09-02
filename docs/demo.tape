# vhs tape for docs/demo.gif — render with: vhs docs/demo.tape
Output "docs/demo.gif"

Set Shell bash
Set FontSize 16
Set Width 1000
Set Height 480
Set Theme "Dracula"
Set TypingSpeed 40ms
Set Padding 20
Set Framerate 12

Hide
Type `export REPO="$PWD" DEMO=$(mktemp -d)` Enter
Type `mkdir -p "$DEMO/bin"` Enter
Type `printf '#!/bin/sh\nexec bun run %s/src/cli.ts "$@"\n' "$REPO" > "$DEMO/bin/domainsweep"` Enter
Type `chmod +x "$DEMO/bin/domainsweep"` Enter
Type `export PATH="$DEMO/bin:$PATH"` Enter
Type `unset NO_COLOR` Enter
Type `cd "$DEMO"` Enter
Type `export PS1='$ '` Enter
Type `clear` Enter
Sleep 1s
Show

Type `domainsweep scryb --first 3` Enter
Sleep 7s

Type `domainsweep scryb --tlds com,ai,live --by-tld --limit 6` Enter
Sleep 7s
Sleep 1s
