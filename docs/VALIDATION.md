# Initial release validation — 22 November 2026

Version: 0.1.0-alpha.1. Linux builds and isolated tests ran on VM 101.

| Check | Result |
| --- | --- |
| Ubuntu 24.04 / GNOME 46 | Both extensions activated in a real headless GNOME Shell; real GTK window maximize/unmaximize probe passed; disable/re-enable passed; no extension errors or GJS critical errors. |
| Ubuntu 26.04 / GNOME 50 | Same runtime checks passed after adapting the removed affectsInputRegion option and changed Meta.Window maximize APIs. |
| Ubuntu package installation/removal | Passed on both Ubuntu releases. Existing local extension and settings sentinels retained their hashes; activation refused when a local copy shadowed the package; no dconf profile created. |
| Gentoo ebuild | Manifest, unpack, prepare, configure, compile and installation staging passed on VM 101; Python helper shebangs adjusted by the eclass. No merge into a live desktop. |
| Source/package boundaries | Exactly two desktop extension UUIDs; only system files installed; no GDM integration installed; no private status endpoint shipped. |

The isolated shells use software rendering, independent system/session buses, a virtual monitor and disposable home directories. Missing GDM, login-session, Polkit and other desktop services produce expected environment warnings. These are not full interactive Ubuntu desktop sessions. Hardware GPU monitoring, weather, multi-monitor layouts, every panel menu, login/reboot, and combinations with Ubuntu Dock or third-party extensions still need normal user testing. GNOME 49 is supported by the original working deployment and the shared compatibility branches, but this release has not been enabled on the owner's live GNOME 49 desktop.

The existing kh desktop files and settings remain in place. Package installation on ThinkPad is deliberately separate from activation; it does not opt the user into the new desktop.
