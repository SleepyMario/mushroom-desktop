import GLib from 'gi://GLib';

const PROFILES = {
    'SM-Dark Purple': {
        cssClass: 'sm-theme-dark-purple',
        logo: 'gentoo-purple.svg',
        text: '#eee5ff',
        selectedText: '#cbb0ff',
        accent: [0.73, 0.60, 1.0, 1.0],
        graphSecondary: [0.4, 0.85, 0.8, 1.0],
    },
    'SM-macOS': {
        cssClass: 'sm-theme-macos',
        logo: 'gentoo-macos.svg',
        text: '#f5f5f7',
        selectedText: '#64d2ff',
        accent: [0.04, 0.52, 1.0, 1.0],
        graphSecondary: [1.0, 0.37, 0.55, 1.0],
    },
    'SM-macOS Bright': {
        cssClass: 'sm-theme-macos-bright',
        logo: 'gentoo-macos.svg',
        text: '#c6d0f5',
        selectedText: '#8caaee',
        accent: [0.04, 0.52, 1.0, 1.0],
        graphSecondary: [1.0, 0.37, 0.55, 1.0],
    },
};

export function getThemePalette() {
    const path = GLib.build_filenamev([GLib.get_user_config_dir(), 'sleepymario', 'theme-profile']);
    try {
        const [ok, contents] = GLib.file_get_contents(path);
        if (ok) {
            const name = new TextDecoder().decode(contents).trim();
            if (PROFILES[name])
                return {...PROFILES[name], name};
        }
    } catch (_error) {
    }
    return {...PROFILES['SM-Dark Purple'], name: 'SM-Dark Purple'};
}
