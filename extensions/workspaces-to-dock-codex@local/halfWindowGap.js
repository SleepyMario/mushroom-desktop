import {unmaximizeWindow} from './compat.js';
import GLib from 'gi://GLib';

// The side pane reserves a 12px separation from the main work area.
const GAP = 12;
export function insetHalf(frame, area) {
    const mid = area.x + Math.floor(area.width / 2);
    const close = (a, b) => Math.abs(a - b) <= 2;
    if (!close(frame.y, area.y) || !close(frame.height, area.height)) return null;
    if (close(frame.x, area.x) && close(frame.x + frame.width, mid))
        return {x: area.x, y: area.y, width: mid - area.x - GAP / 2, height: area.height};
    if (close(frame.x, mid) && close(frame.x + frame.width, area.x + area.width))
        return {x: mid + GAP / 2, y: area.y,
            width: area.x + area.width - mid - GAP / 2, height: area.height};
    return null;
}

export class HalfWindowGap {
    constructor() {
        this._windows = new Map();
        this._dragging = false;
        this._signals = [
            global.display.connect('window-created', (_display, window) => this._watch(window)),
            global.display.connect('grab-op-begin', () => { this._dragging = true; }),
            global.display.connect('grab-op-end', () => {
                this._dragging = false;
                for (const window of this._windows.keys()) this._queue(window);
            }),
        ];
        for (const actor of global.get_window_actors()) this._watch(actor.meta_window);
    }

    _watch(window) {
        if (this._windows.has(window)) return;
        const state = {idle: 0, signals: []};
        this._windows.set(window, state);
        for (const name of ['size-changed', 'notify::maximized-vertically', 'notify::maximized-horizontally'])
            state.signals.push(window.connect(name, () => this._queue(window)));
        state.signals.push(window.connect('unmanaged', () => this._forget(window)));
        this._queue(window);
    }

    _queue(window) {
        const state = this._windows.get(window);
        if (!state || state.idle) return;
        state.idle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            state.idle = 0;
            if (this._dragging || !window.get_compositor_private() ||
                window.is_fullscreen() || !window.maximized_vertically ||
                window.maximized_horizontally || !window.allows_resize()) return GLib.SOURCE_REMOVE;
            const area = window.get_workspace().get_work_area_for_monitor(window.get_monitor());
            const frame = insetHalf(window.get_frame_rect(), area);
            if (frame && frame.width > 0) {
                // Native tile constraints would undo an inset on the next configure.
                // Release them, then keep the half layout as ordinary window geometry.
                unmaximizeWindow(window);
                window.move_resize_frame(false, frame.x, frame.y, frame.width, frame.height);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _forget(window) {
        const state = this._windows.get(window);
        if (!state) return;
        this._windows.delete(window);
        if (state.idle) GLib.source_remove(state.idle);
        for (const id of state.signals) window.disconnect(id);
    }

    destroy() {
        for (const id of this._signals) global.display.disconnect(id);
        for (const window of this._windows.keys()) this._forget(window);
    }
}
