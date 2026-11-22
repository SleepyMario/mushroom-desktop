import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {unmaximizeWindow, maximizeWindow, isMaximized} from '../workspaces-to-dock-codex@local/compat.js';
export default class Probe extends Extension {
    enable() {
        this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            const window = global.get_window_actors().map(a => a.meta_window)
                .find(w => w.get_title() === 'Mushroom desktop test window');
            if (!window) return GLib.SOURCE_CONTINUE;
            try {
                if (typeof isMaximized(window) !== 'boolean') throw new Error('Invalid maximized state');
                maximizeWindow(window);
                unmaximizeWindow(window);
                GLib.file_set_contents('/tmp/mushroom-probe-result', 'PASS');
            } catch (error) {
                GLib.file_set_contents('/tmp/mushroom-probe-result', String(error));
            }
            this._timer = 0;
            return GLib.SOURCE_REMOVE;
        });
    }
    disable() { if (this._timer) GLib.source_remove(this._timer); this._timer = 0; }
}
