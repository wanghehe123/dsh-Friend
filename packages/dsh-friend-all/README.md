# dsh-Friend aggregate bundle

This package is the single DSH installation target. Its generated Cordis patch
mounts the dsh-Friend feature packages listed in `aggregate.yml`.

`dsh.bundle` and `cordis.patch.yml` belong only here: a scan of the installed
rc.6 SDK tree found no official package declaring `dsh.bundle`, so per-feature
patches would be an unsupported duplicate mount.
