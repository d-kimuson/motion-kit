# The pi bash tool drops empty-string arguments

## Symptom

An in-place edit uses the macOS/BSD form with an empty backup suffix, and `sed` treats the
script as the backup extension:

```bash
cd /tmp && printf 'a\nb\n' > t.txt && sed -i '' 's/a/A/' t.txt
# sed: can't read s/a/A/: No such file or directory   (exit 2, t.txt unchanged)
```

## Workaround

Edit in place with a command that needs no empty argument:

```bash
perl -i -pe 's/a/A/' t.txt
```

## Why Not Fixed

The bash tool drops `''` before the shell sees it, so a command that depends on an empty
argument cannot be expressed through it. Any non-empty form works (`perl -i -pe`, `sed -i
.bak` then removing the backup), so the durable rule is to never rely on `''` in commands
run through the tool. Fixing it needs a change to the tool's argument transport, which is
outside this repository.
