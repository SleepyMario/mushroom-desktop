# Mushroom Desktop

Mushroom Desktop is the sixth Mushroom project: a custom GNOME workspace sidebar, system monitor, window-layout controls and bottom status panel. Its initial application version is **0.1.0-alpha.1**.

Supported targets are Ubuntu **24.04 LTS (GNOME 46)**, Ubuntu **26.04 LTS (GNOME 50)**, and Gentoo with GNOME **46, 49 or 50**. Older Ubuntu releases, other desktops and Docker distribution are out of scope. Containers under `tests/` are disposable compatibility-test environments only; no Docker image is published or scheduled.

## Maintenance policy

Follow upstream GNOME releases and maintain a small extension layer, not a GNOME fork. Keep compatibility changes focused and test activation, window operations and disable/re-enable against supported GNOME releases. Ubuntu support remains limited to 24.04 and 26.04 LTS; Gentoo follows the supported GNOME versions. Internal Shell API use can require adjustments for new GNOME releases.

## Components

- `workspaces-to-dock-codex@local`: workspace previews, system/GPU monitoring, layout selector, window spacing and snapping helpers.
- `right-half-panel@local`: the Bottom Left Status Panel, weather and optional streaming-status shortcuts. Its historical identifier is retained for continuity.

Ubuntu Dock or Dash to Dock supplies the application dock. Blur my Shell and other third-party extensions remain separately managed; their source is not bundled here.

The small GDM layout helper is retained under `integrations/` as historical source. It depends on a customized login mode and is **not installed or enabled** by the desktop package. The package does not change GDM, login sessions or display managers.

## Installation and settings

Ubuntu packages are distributed through Mushroom APT as `mushroom-desktop`. Gentoo uses `gnome-extra/mushroom-desktop` from mushroom-overlay.

Package installation only places system files. It does not enable extensions, restart GNOME, write into home directories, import a dconf profile, or change current settings. Existing local extension copies take precedence over system packages and remain intact.

Run `mushroom-desktop status` to inspect that situation. After a normal login makes newly installed extensions visible, `mushroom-desktop enable` explicitly enables the two components. It refuses to proceed if local copies would shadow them. `mushroom-desktop disable` explicitly disables those two components.

To switch an existing local installation to the packaged version, first back up its extension directories and settings, then move the two local directories outside the GNOME extensions directory and log out/in normally. This migration is a deliberate user action; the package never performs it automatically. Retain the backup until the packaged version has been checked. The historical identifiers and existing theme, GPU and layout configuration paths are unchanged.

Optional configuration can be placed at `~/.config/mushroom-desktop/config.json`; see `docs/config.example.json`. No private status endpoint is configured by default. Existing `sleepymario/theme-profile`, `codex-gpu-monitor` and `codex-monitor-layout` preferences are still read. Package removal does not delete user configuration.

## Builds

Linux packaging uses build VM 101. `make check` validates source and staging boundaries. `python3 packaging/build-deb.py` creates the architecture-independent Ubuntu package. The ebuild in `packaging/` uses the same source release. No compilation or network access is required during installation.

The two Ubuntu shell tests run inside isolated containers with their own system/session buses, virtual monitor and home directory. They do not mount or connect to the host display or user settings. See `docs/VALIDATION.md` for the exact test results and limitations.

## Provenance and license

The initial snapshot comes from the owner's working GNOME extensions in the Gentoo dotfiles repository. Original worktrees and installed copies were left unchanged. The workspace dock is inspired by the discontinued Workspaces to Dock extension and uses GNOME Shell APIs. Source is GPL-3.0-or-later; see `COPYING`. GNOME and separately installed extensions retain their own licenses.
