import Meta from 'gi://Meta';

// GNOME 49 removed the flags argument from unmaximize().
export function unmaximizeWindow(window) {
    if (typeof window.set_unmaximize_flags === 'function') window.unmaximize();
    else window.unmaximize(Meta.MaximizeFlags.BOTH);
}

export function maximizeWindow(window) {
    if (typeof window.set_maximize_flags === 'function') window.maximize();
    else window.maximize(Meta.MaximizeFlags.BOTH);
}

export function isMaximized(window) {
    return typeof window.is_maximized === 'function' ? window.is_maximized() :
        (window.get_maximized() & Meta.MaximizeFlags.BOTH) === Meta.MaximizeFlags.BOTH;
}
