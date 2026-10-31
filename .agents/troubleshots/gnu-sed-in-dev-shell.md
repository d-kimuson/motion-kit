# `sed -i ''` fails in the dev shell

## Symptom

On macOS, an in-place edit in the BSD form treats the script as a file name:

```bash
printf 'a\nb\n' > t.txt && sed -i '' 's/a/A/' t.txt
# sed: can't read s/a/A/: No such file or directory   (exit 2, t.txt unchanged)
```

`which -a sed` lists the Nix GNU sed (`/nix/store/…-gnused-4.10/bin/sed`) before `/usr/bin/sed`.

## Workaround

Use the GNU form, which takes no suffix argument:

```bash
sed -i 's/a/A/' t.txt
```

`perl -i -pe 's/a/A/' t.txt` works with either sed on `PATH`.

## Why Not Fixed

The `pkgs.mkShell` dev shell in `flake.nix`, loaded through `.envrc`, puts the stdenv tools, GNU sed among them, ahead of the macOS ones. That is deliberate: it gives Linux CI and macOS the same tools. A shell outside the dev shell gets `/usr/bin/sed`, so either form can be right. Check `which sed` before you rely on one.
