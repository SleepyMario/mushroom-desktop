import {unmaximizeWindow} from './compat.js';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {layoutRegions, columnRegions, layoutTarget} from './layoutGeometry.js';

export class LayoutSelector {
    constructor() {
        this._pending = new Set();
        this._statePath = GLib.build_filenamev([GLib.get_user_config_dir(), 'codex-monitor-layout']);
        this._mode = 'columns';
        try {
            const [ok, data] = GLib.file_get_contents(this._statePath);
            if (ok && new TextDecoder().decode(data).trim() === 'stream') this._mode = 'stream';
        } catch (_) { /* First run uses the existing two-column layout. */ }
        this._button = new PanelMenu.Button(0.5, 'Monitor layout');
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER,
            style: 'font-size: 20px; color: #e7dff4;'});
        this._button.add_child(this._label);
        this._items = [];
        for (const [mode, title] of [['columns', '▥  Two columns'],
            ['stream', '▦  Language stream — OBS / Browser / TCL / Streamchat']]) {
            const item = new PopupMenu.PopupMenuItem(title);
            item.connect('activate', () => this._select(mode));
            this._button.menu.addMenuItem(item);
            this._items.push([mode, item]);
        }
        this._sync();
        Main.panel.addToStatusArea('codex-monitor-layout', this._button, 0, 'right');
        this._preview = new St.Widget({reactive: false, visible: false,
            style: 'background-color: rgba(187,153,255,0.20); border: 2px solid #bb99ff; border-radius: 16px;'});
        Main.layoutManager.addChrome(this._preview, {affectsStruts: false});
        this._signals = [
            global.display.connect('grab-op-begin', (_display, window, op) => {
                this._clearDrag();
                if (![Meta.GrabOp.MOVING, Meta.GrabOp.MOVING_UNCONSTRAINED].includes(op) ||
                    !window.allows_resize() || window.is_fullscreen()) return;
                this._window = window;
                this._update();
                this._poll = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
                    this._update();
                    return GLib.SOURCE_CONTINUE;
                });
            }),
            global.display.connect('grab-op-end', (_display, window) => this._finish(window)),
        ];
        // GNOME's original handler runs first; suppress its actor before painting
        // on the current primary monitor while our drag controller is active.
        this._nativePreviewSignal = global.window_manager.connect_after('show-tile-preview',
            (_wm, _window, _rect, index) => {
                if (this._window && this._targetMonitor()?.index === index)
                    Main.wm._tilePreview?.hide();
            });
        this._monitorSignal = Main.layoutManager.connect('monitors-changed', () => this._clearDrag());
        this._keySignal = global.stage.connect('captured-event', (_actor, event) => {
            if (event.type() === Clutter.EventType.KEY_PRESS &&
                event.get_key_symbol() === Clutter.KEY_Escape) this._clearDrag();
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _select(mode) {
        this._clearDrag();
        for (const id of this._pending) GLib.source_remove(id);
        this._pending.clear();
        this._mode = mode;
        try { GLib.file_set_contents(this._statePath, mode + '\n'); }
        catch (error) { console.warn(`Could not save monitor layout: ${error.message}`); }
        this._sync();
    }

    _sync() {
        this._label.text = this._mode === 'stream' ? '▦' : '▥';
        this._button.accessible_name = this._mode === 'stream' ? 'Layout: Language stream' : 'Layout: Two columns';
        for (const [mode, item] of this._items)
            item.setOrnament(mode === this._mode ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
    }

    _targetMonitor() {
        // Regions are calculated from the current work area, so following
        // GNOME's primary monitor automatically supports laptop, Full HD,
        // 1920x1200, 4K, and future monitor resolutions without profiles.
        return Main.layoutManager.primaryMonitor ?? Main.layoutManager.monitors[0] ?? null;
    }

    _update() {
        this._target = null;
        const monitor = this._targetMonitor();
        if (!monitor || !this._window?.get_compositor_private()) {
            this._preview.hide();
            return;
        }
        const area = this._window.get_workspace().get_work_area_for_monitor(monitor.index);
        let decoration = 36;
        if (this._window.get_title() === 'TCL Notetaker') {
            const frame = this._window.get_frame_rect();
            const client = this._window.frame_rect_to_client_rect(frame);
            decoration = Math.max(0, frame.height - client.height);
        }
        const regions = this._mode === 'columns' ? columnRegions(area) : layoutRegions(area, decoration);
        const [x, y] = global.get_pointer();
        const index = layoutTarget(regions, area, x, y);
        if (index < 0) { this._preview.hide(); return; }
        this._target = {monitor: monitor.index, ...regions[index]};
        Main.wm._tilePreview?.hide();
        this._preview.set_position(this._target.x, this._target.y);
        this._preview.set_size(this._target.width, this._target.height);
        this._preview.show();
    }

    _finish(window) {
        if (window !== this._window) return;
        this._update();
        const target = this._target;
        this._clearDrag();
        if (!target) return;
        // Let Mutter finish native edge handling before applying the custom region.
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            this._pending.delete(id);
            if (window.get_compositor_private() && !window.is_fullscreen()) {
                unmaximizeWindow(window);
                window.move_to_monitor(target.monitor);
                window.move_resize_frame(false, target.x, target.y, target.width, target.height);
            }
            return GLib.SOURCE_REMOVE;
        });
        this._pending.add(id);
    }

    _clearDrag() {
        if (this._poll) GLib.source_remove(this._poll);
        this._poll = 0;
        this._window = null;
        this._target = null;
        this._preview?.hide();
    }

    destroy() {
        this._clearDrag();
        for (const id of this._pending) GLib.source_remove(id);
        this._pending.clear();
        for (const id of this._signals) global.display.disconnect(id);
        Main.layoutManager.disconnect(this._monitorSignal);
        global.stage.disconnect(this._keySignal);
        global.window_manager.disconnect(this._nativePreviewSignal);
        this._button.destroy();
        this._preview.destroy();
    }
}
