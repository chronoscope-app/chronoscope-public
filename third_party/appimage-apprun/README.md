# AppImageKit AppRun source

`AppRun.c` is the unmodified launcher from AppImageKit commit
`5735cc5bed206497cddfbd2a75e1982c2606c35d`:

https://github.com/AppImage/AppImageKit/blob/5735cc5bed206497cddfbd2a75e1982c2606c35d/src/AppRun.c

The upstream source archive SHA-256 is
`65ce93060bb5d662fcff878ab5c63b530af16f2a4c86ae1c93f3dc7bf55e4e12`.
The source file and project `LICENSE` retain the upstream MIT notices.

`long-path.patch` allocates the desktop-file path according to its actual
length. The previous fixed-size buffer truncated paths over 255 bytes and the
launcher could crash when opening the truncated path.

Linux packaging runs `scripts/build_linux_apprun.py` from this checkout. It
checks the pinned input hashes, applies the patch with `patch`, and builds with
`CC` (default `cc`) using `-O2`. The C compiler and `patch` must be installed.
The resulting launcher replaces `AppRun.wrapped` in the AppDir. This directory,
including source, patch and license, is copied into the AppImage at
`usr/share/doc/chronoscope-apprun` so a recipient can inspect and rebuild it.
A rebuilt executable can be substituted in an extracted AppDir, then repackaged
with the AppImage tooling; the complete AppImage has additional components and
separate source and license requirements.

To rebuild using only the files included in the AppImage, from this directory:

```sh
mkdir -p work/src
cp AppRun.c work/src/AppRun.c
(cd work && patch --batch --forward -p1 -i ../long-path.patch)
cc -O2 work/src/AppRun.c -o work/AppRun.wrapped
```
