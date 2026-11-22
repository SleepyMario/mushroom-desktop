import GLib from 'gi://GLib';

// User configuration is optional. Packaging never creates or overwrites it.
export function desktopConfig() {
    const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'mushroom-desktop', 'config.json']);
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (ok) {
            const value = JSON.parse(new TextDecoder().decode(bytes));
            if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        }
    } catch (_) { /* Defaults work without a user configuration file. */ }
    return {};
}
