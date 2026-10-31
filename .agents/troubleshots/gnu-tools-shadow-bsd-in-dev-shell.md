# BSD-form `sed -i ''` and `stat -f` fail in the dev shell

## Symptom

On macOS, an in-place edit in the BSD form treats the script as a file name:

```bash
printf 'a\nb\n' > t.txt && sed -i '' 's/a/A/' t.txt
# sed: can't read s/a/A/: No such file or directory   (exit 2, t.txt unchanged)
```

`stat -f %m` (BSD format) is read as a file system query on a file named `%m`:

```bash
stat -f %m t.txt
# stat: cannot read file system information for '%m': No such file or directory
```

`which -a sed` lists the Nix GNU sed (`/nix/store/…-gnused-4.10/bin/sed`) before `/usr/bin/sed`, and `which -a stat` lists the Nix GNU coreutils `stat` before `/usr/bin/stat`.

## Workaround

Use the GNU form for sed, which takes no suffix argument:

```bash
sed -i 's/a/A/' t.txt
```

`perl -i -pe 's/a/A/' t.txt` works with either sed on `PATH`.

For BSD `stat` options, call the macOS binary by its absolute path, or use the GNU form (`stat -c %Y t.txt`):

```bash
/usr/bin/stat -f %m t.txt
```

## Why Not Fixed

The `pkgs.mkShell` dev shell in `flake.nix`, loaded through `.envrc`, puts the stdenv tools, GNU sed and coreutils among them, ahead of the macOS ones. That is deliberate: it gives Linux CI and macOS the same tools. A shell outside the dev shell gets `/usr/bin/sed` and `/usr/bin/stat`, so either form can be right. Check `which sed stat` before you rely on one.
