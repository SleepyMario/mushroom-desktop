import {unmaximizeWindow, maximizeWindow, isMaximized} from './compat.js';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {SystemInfo} from './systemInfo.js';
import {InnerEdgeSnapping} from './innerEdgeSnapping.js';
import {HalfWindowGap} from './halfWindowGap.js';
import {LayoutSelector} from './layoutSelector.js';
import {getThemePalette} from './themePalette.js';

import * as Background from 'resource:///org/gnome/shell/ui/background.js';
import {WorkspaceThumbnail} from 'resource:///org/gnome/shell/ui/workspaceThumbnail.js';

const DOCK_WIDTH = 274;
const PREVIEW_WIDTH = 256;
const PREVIEW_HEIGHT = 144;
const OUTER_GAP = 8;
const REFERENCE_MONITOR_WIDTH = 3840;
const MIN_INTERFACE_SCALE = 0.5;

export function interfaceScaleForWidth(width) {
    return Math.max(MIN_INTERFACE_SCALE,
        Math.min(1, width / REFERENCE_MONITOR_WIDTH));
}

// Round the background without redirecting live window clones offscreen.
const RoundedPreviewEffect = GObject.registerClass(
class RoundedPreviewEffect extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(Cogl.SnippetHook.FRAGMENT, '', `
            vec2 p = cogl_tex_coord_in[0].xy * vec2(256.0, 144.0);
            vec2 q = abs(p - vec2(128.0, 72.0)) - vec2(116.0, 60.0);
            float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - 12.0;
            cogl_color_out *= 1.0 - smoothstep(-0.75, 0.75, d);
        `, false);
    }
});

// Desktop blur actors sample the stage and are unsuitable as thumbnail sources.
// Keep GNOME's WindowClone wrapper for positioning and native drag handling.
const DockWorkspaceThumbnail = GObject.registerClass(
class DockWorkspaceThumbnail extends WorkspaceThumbnail {
    _addWindowClone(win) {
        const wrapper = super._addWindowClone(win);
        const image = wrapper.get_first_child();
        const syncSource = () => {
            if (!win.meta_window?.blur_actor) {
                image.source = win;
                return;
            }
            const surface = win.get_children().find(child =>
                child !== win.meta_window.blur_actor &&
                child.constructor.name.includes('SurfaceActor'));
            image.source = surface ?? win;
        };
        win.connectObject('child-added', syncSource,
            'child-removed', syncSource, wrapper);
        syncSource();
        return wrapper;
    }
});

class WorkspaceDock {
    constructor(extension) {
        this._extension = extension;
        this._palette = getThemePalette();
        this._topOuterGap = OUTER_GAP;
        this._signals = [];
        this._buttons = [];
        this._stylesheet = null;
        this._previews = [];

        this.actor = new St.BoxLayout({
            vertical: true,
            style_class: `codex-workspaces-dock ${this._palette.cssClass}`,
            reactive: true,
            track_hover: true,
            x_expand: false,
            y_expand: false,
        });

        this.actor.connect('scroll-event', (_actor, event) => {
            this._switchByScroll(event);
            return Clutter.EVENT_STOP;
        });
    }

    enable() {
        this._loadStylesheet();
        Main.layoutManager.uiGroup.add_style_class_name(this._palette.cssClass);
        this._panelActor = Main.panel;
        if (this._palette.name === 'SM-macOS Bright')
            this._panelActor.add_style_class_name('sm-macos-bright-panel');
        if (this._palette.name === 'SM-macOS Bright') {
            this._brightPanelMenus = [];
            for (const indicator of Object.values(Main.panel.statusArea)) {
                const menuBox = indicator?.menu?.box;
                if (!menuBox?.add_style_class_name || this._brightPanelMenus.includes(menuBox))
                    continue;
                menuBox.add_style_class_name('sm-macos-bright-panel-menu');
                this._brightPanelMenus.push(menuBox);
            }
        }
        // Invisible edge actors reserve the data column, bottom controls, and
        // the permanent outer gaps shared by both desktop colour themes.
        this._reservations = [new St.Widget({reactive: false, opacity: 0}),
            new St.Widget({reactive: false, opacity: 0}),
            new St.Widget({reactive: false, opacity: 0}),
            new St.Widget({reactive: false, opacity: 0})];
        for (const actor of this._reservations)
            Main.layoutManager.addChrome(actor, {
                affectsStruts: true,
                ...(parseInt(Config.PACKAGE_VERSION) < 50 ? {affectsInputRegion: false} : {}),
                trackFullscreen: true,
            });
        this._dateLabel = new St.Label({
            style_class: 'codex-workspaces-date-label',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const clockSize = this._palette.name === 'SM-macOS Bright' ? 224 : 240;
        this._clock = new St.DrawingArea({width: clockSize, height: clockSize,
            x_align: Clutter.ActorAlign.CENTER});
        this._clock.connect('repaint', () => this._drawClock());
        const dateContents = new St.BoxLayout({vertical: true});
        dateContents.add_child(this._clock);
        dateContents.add_child(this._dateLabel);
        this._datePanel = new St.Bin({
            style_class: `codex-workspaces-dock codex-workspaces-date ${this._palette.cssClass}`,
            child: dateContents,
            width: DOCK_WIDTH,
        });
        Main.layoutManager.addChrome(this._datePanel, {
            affectsStruts: false,
            trackFullscreen: true,
        });
        this._updateDate();
        this._dateTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._updateDate();
            this._relayout();
            return GLib.SOURCE_CONTINUE;
        });
        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: false,
            trackFullscreen: true,
        });

        this._connect(global.workspace_manager, 'notify::n-workspaces', () => this._rebuild());
        this._connect(global.workspace_manager, 'workspaces-reordered', () => this._rebuild());
        this._connect(global.workspace_manager, 'active-workspace-changed', () => this._syncActive());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._rebuild());
        this._connect(global.display, 'workareas-changed', () => this._relayout());
        this._connect(global.display, 'restacked', () => this._syncStacking());
        this._connect(global.display, 'grab-op-begin', (_display, window, op) =>
            this._beginWindowMove(window, op));
        this._connect(global.display, 'grab-op-end', (_display, window) =>
            this._endWindowMove(window));
        this._connect(Main.overview, 'window-drag-end', () => this._highlightDrop(-1));
        this._connect(Main.overview, 'window-drag-cancelled', () => this._highlightDrop(-1));
        this._dragMonitor = {
            dragMotion: event => {
                const index = this._workspaceAtPointer();
                this._highlightDrop(event.source?.metaWindow &&
                    event.source.metaWindow.get_workspace()?.index() !== index ? index : -1);
                return DND.DragMotionResult.CONTINUE;
            },
            dragDrop: () => {
                this._highlightDrop(-1);
                return DND.DragDropResult.CONTINUE;
            },
        };
        DND.addDragMonitor(this._dragMonitor);


        this._systemInfo = new SystemInfo(this._palette);
        this._rebuild();
        this._relayout();
    }

    _drawClock() {
        const cr = this._clock.get_context();
        try {
            const [width, height] = this._clock.get_surface_size();
            const radius = Math.min(width, height) * 0.43;
            const now = GLib.DateTime.new_now_local();
            cr.translate(width / 2, height / 2);
            cr.setSourceRGBA(1, 1, 1, 0.18);
            cr.setLineWidth(1.5);
            cr.arc(0, 0, radius, 0, Math.PI * 2);
            cr.stroke();
            for (let i = 0; i < 60; i++) {
                const angle = i * Math.PI / 30;
                const major = i % 5 === 0;
                const inner = radius - (major ? 13 : 6);
                cr.setSourceRGBA(1, 1, 1, major ? 0.9 : 0.35);
                cr.setLineWidth(major ? 2.5 : 1);
                cr.moveTo(Math.sin(angle) * inner, -Math.cos(angle) * inner);
                cr.lineTo(Math.sin(angle) * (radius - 3), -Math.cos(angle) * (radius - 3));
                cr.stroke();
            }
            const hand = (angle, length, thickness, color) => {
                cr.setSourceRGBA(...color);
                cr.setLineWidth(thickness);
                cr.moveTo(0, 0);
                cr.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length);
                cr.stroke();
            };
            const seconds = now.get_second();
            const minutes = now.get_minute() + seconds / 60;
            const hours = now.get_hour() % 12 + minutes / 60;
            hand(hours * Math.PI / 6, radius * 0.52, 5, [1, 1, 1, 0.95]);
            hand(minutes * Math.PI / 30, radius * 0.76, 3, [1, 1, 1, 0.95]);
            hand(seconds * Math.PI / 30, radius * 0.84, 1.5, this._palette.accent);
            cr.setSourceRGBA(...this._palette.accent);
            cr.arc(0, 0, 4, 0, Math.PI * 2);
            cr.fill();
        } finally {
            cr.$dispose();
        }
    }

    _updateDate() {
        const now = GLib.DateTime.new_now_local();
        const weekday = ['一', '二', '三', '四', '五', '六', '日'][now.get_day_of_week() - 1];
        const text = `${now.format('%Y/%m/%d')}（${weekday}）`;
        this._clock.queue_repaint();
        if (this._dateLabel.text !== text)
            this._dateLabel.text = text;
    }

    disable() {
        Main.layoutManager.uiGroup.remove_style_class_name(this._palette.cssClass);
        this._panelActor?.remove_style_class_name('sm-macos-bright-panel');
        this._panelActor = null;
        for (const menuBox of this._brightPanelMenus ?? [])
            menuBox.remove_style_class_name('sm-macos-bright-panel-menu');
        this._brightPanelMenus = [];
        this._cancelWindowMove();
        if (this._moveIdle) GLib.source_remove(this._moveIdle);
        this._moveIdle = 0;
        if (this._dropDiagnosticTimer) GLib.source_remove(this._dropDiagnosticTimer);
        this._dropDiagnosticTimer = 0;
        if (this._dragMonitor) DND.removeDragMonitor(this._dragMonitor);
        this._dragMonitor = null;
        this._systemInfo?.destroy();
        this._systemInfo = null;
        if (this._dateTimer) {
            GLib.source_remove(this._dateTimer);
            this._dateTimer = 0;
        }
        if (this._datePanel) {
            Main.layoutManager.removeChrome(this._datePanel);
            this._datePanel.destroy();
            this._datePanel = null;
            this._dateLabel = null;
            this._clock = null;
        }
        for (const [obj, id] of this._signals.splice(0)) {
            try {
                obj.disconnect(id);
            } catch (_e) {
            }
        }

        for (const actor of this._reservations ?? []) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._reservations = [];
        this._clearPreviews();
        if (this.actor) {
            Main.layoutManager.removeChrome(this.actor);
            this.actor.destroy();
            this.actor = null;
        }

        this._unloadStylesheet();
        this._buttons = [];
    }

    _connect(obj, signal, callback) {
        this._signals.push([obj, obj.connect(signal, callback)]);
    }

    _loadStylesheet() {
        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        this._stylesheet = this._extension.dir.get_child('stylesheet.css');
        theme.load_stylesheet(this._stylesheet);
    }

    _unloadStylesheet() {
        if (!this._stylesheet)
            return;

        try {
            St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._stylesheet);
        } catch (_e) {
        }
        this._stylesheet = null;
    }

    _clearPreviews() {
        for (const preview of this._previews)
            preview.background.destroy();
        this._previews = [];
    }

    _syncStacking() {
        const indices = {};
        global.get_window_actors().forEach((actor, index) => {
            indices[actor.meta_window.get_stable_sequence()] = index;
        });
        for (const preview of this._previews)
            preview.thumbnail.syncStacking(indices);
    }

    _rebuild() {
        this._clearPreviews();
        this.actor.destroy_all_children();
        this._buttons = [];

        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const count = global.workspace_manager.get_n_workspaces();
        for (let index = 0; index < count; index++) {
            const button = new St.Button({
                style_class: 'codex-workspaces-dock-button',
                can_focus: true,
                reactive: true,
                track_hover: true,
                accessible_name: `Workspace ${index + 1}`,
            });

            const scene = new St.Widget({
                width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT,
                clip_to_allocation: true,
                layout_manager: new Clutter.FixedLayout(),
            });
            const backgroundGroup = new Clutter.Actor({
                width: monitor.width, height: monitor.height,
                scale_x: PREVIEW_WIDTH / monitor.width,
                scale_y: PREVIEW_HEIGHT / monitor.height,
            });
            scene.add_child(backgroundGroup);
            const background = new Background.BackgroundManager({
                container: backgroundGroup, monitorIndex: monitor.index,
                controlPosition: false,
            });
            const workspace = global.workspace_manager.get_workspace_by_index(index);
            const thumbnail = new DockWorkspaceThumbnail(workspace, monitor.index);
            thumbnail.set_style('background-color: transparent; border: none; box-shadow: none;');
            thumbnail.setPorthole(monitor.x, monitor.y, monitor.width, monitor.height);
            thumbnail.setScale(PREVIEW_WIDTH / monitor.width, PREVIEW_HEIGHT / monitor.height);
            thumbnail.set_size(PREVIEW_WIDTH, PREVIEW_HEIGHT);
            // Native window clones retain their drag gestures.
            button._delegate = {
                handleDragOver: (source, actor, _x, _y, time) =>
                    thumbnail.handleDragOverInternal(source, actor, time),
                acceptDrop: (source, actor, _x, _y, time) =>
                    thumbnail.acceptDropInternal(source, actor, time),
            };
            scene.add_child(thumbnail);
            // Keep live window clones outside the offscreen corner effect.
            // DND renders the same clones directly; stationary previews must too.
            backgroundGroup.add_effect(new RoundedPreviewEffect());
            button.set_child(scene);
            this._previews.push({thumbnail, background});

            button.connect('clicked', () => this._activate(index));
            button.connect('scroll-event', (_actor, event) => {
                this._switchByScroll(event);
                return Clutter.EVENT_STOP;
            });

            this.actor.add_child(button);
            this._buttons.push(button);
        }

        this._syncStacking();
        this._syncActive();
        this._relayout();
    }

    _workspaceAtPointer() {
        const [x, y] = global.get_pointer();
        return this._buttons.findIndex(button => {
            if (!button.mapped) return false;
            const [bx, by] = button.get_transformed_position();
            const [bw, bh] = button.get_transformed_size();
            return x >= bx && x < bx + bw && y >= by && y < by + bh;
        });
    }

    _highlightDrop(index) {
        this._buttons.forEach((button, i) => {
            if (i === index)
                button.add_style_class_name('codex-workspace-drop-target');
            else
                button.remove_style_class_name('codex-workspace-drop-target');
        });
    }

    _beginWindowMove(window, op) {
        if (![Meta.GrabOp.MOVING, Meta.GrabOp.MOVING_UNCONSTRAINED].includes(op))
            return;
        this._cancelWindowMove();
        this._movingWindow = window;
        const frame = window.get_frame_rect();
        this._moveOrigin = {x: frame.x, y: frame.y, width: frame.width, height: frame.height};
        this._moveMaximized = isMaximized(window);
        this._moveMonitor = window.get_monitor();
        this._moveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            const index = this._workspaceAtPointer();
            this._highlightDrop(index !== window.get_workspace()?.index() ? index : -1);
            return GLib.SOURCE_CONTINUE;
        });
    }

    _cancelWindowMove() {
        if (this._moveTimer) GLib.source_remove(this._moveTimer);
        this._moveTimer = 0;
        this._movingWindow = null;
        this._moveOrigin = null;
        this._moveMaximized = false;
        this._moveMonitor = null;
        this._highlightDrop(-1);
    }

    _endWindowMove(window) {
        if (window !== this._movingWindow) return;
        const index = this._workspaceAtPointer();
        const origin = this._moveOrigin;
        const maximized = this._moveMaximized;
        const monitor = this._moveMonitor;
        const [, , modifiers] = global.get_pointer();
        this._cancelWindowMove();
        // Escape ends a grab with the pointer button still held: don't drop.
        if (modifiers & (Clutter.ModifierType.BUTTON1_MASK |
            Clutter.ModifierType.BUTTON2_MASK | Clutter.ModifierType.BUTTON3_MASK)) return;
        if (index < 0 || !origin) return;
        const workspace = global.workspace_manager.get_workspace_by_index(index);
        if (this._moveIdle) GLib.source_remove(this._moveIdle);
        this._moveIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._moveIdle = 0;
            if (!window.get_compositor_private() || !workspace) return GLib.SOURCE_REMOVE;
            // Mutter finishes edge tiling before grab-op-end. Clear that state
            // before restoring the pre-drag geometry, including same-workspace drops.
            const snapshot = () => {
                const frame = window.get_frame_rect();
                return {monitor: window.get_monitor(), maximized: isMaximized(window),
                    frame: {x: frame.x, y: frame.y, width: frame.width, height: frame.height}};
            };
            console.log(`[workspace-drop-geometry] ${JSON.stringify({phase: 'before',
                targetWorkspace: index, origin: {monitor, maximized, frame: origin},
                current: snapshot()})}`);
            // Workspace previews belong to the primary display: never restore
            // a laptop monitor assignment or laptop coordinates after a drop.
            const targetMonitor = Main.layoutManager.primaryMonitor;
            if (!targetMonitor) return GLib.SOURCE_REMOVE;
            const area = workspace.get_work_area_for_monitor(targetMonitor.index);
            const width = Math.min(origin.width, area.width);
            const height = Math.min(origin.height, area.height);
            const x = Math.max(area.x, Math.min(origin.x, area.x + area.width - width));
            const y = Math.max(area.y, Math.min(origin.y, area.y + area.height - height));
            unmaximizeWindow(window);
            window.move_to_monitor(targetMonitor.index);
            if (window.get_workspace() !== workspace)
                window.change_workspace(workspace);
            window.move_resize_frame(false, x, y, width, height);
            if (maximized) maximizeWindow(window);
            console.log(`[workspace-drop-geometry] ${JSON.stringify({phase: 'requested', current: snapshot()})}`);
            if (this._dropDiagnosticTimer) GLib.source_remove(this._dropDiagnosticTimer);
            this._dropDiagnosticTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                this._dropDiagnosticTimer = 0;
                if (window.get_compositor_private())
                    console.log(`[workspace-drop-geometry] ${JSON.stringify({phase: 'settled', current: snapshot()})}`);
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncActive() {
        const active = global.workspace_manager.get_active_workspace_index();
        for (let i = 0; i < this._buttons.length; i++) {
            const button = this._buttons[i];
            if (i === active)
                button.add_style_class_name('codex-workspaces-dock-button-active');
            else
                button.remove_style_class_name('codex-workspaces-dock-button-active');
        }
    }

    _activate(index) {
        const workspace = global.workspace_manager.get_workspace_by_index(index);
        if (workspace)
            workspace.activate(global.get_current_time());
    }

    _switchByScroll(event) {
        const direction = event.get_scroll_direction();
        let delta = 0;
        if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.LEFT)
            delta = -1;
        else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.RIGHT)
            delta = 1;
        else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [, dy] = event.get_scroll_delta();
            delta = dy > 0 ? 1 : -1;
        }

        if (!delta)
            return;

        const count = global.workspace_manager.get_n_workspaces();
        if (count < 1)
            return;

        const current = global.workspace_manager.get_active_workspace_index();
        const next = Math.max(0, Math.min(count - 1, current + delta));
        if (next !== current)
            this._activate(next);
    }

    _relayout() {
        if (!this.actor)
            return;

        const monitor = Main.layoutManager.primaryMonitor ?? Main.layoutManager.monitors[0];
        if (!monitor)
            return;

        // The visual design was authored at 3840px. Scale the complete side
        // interface on smaller primary displays instead of reserving its 4K
        // pixel dimensions verbatim. The 1920x1080 and 1920x1200 layouts both
        // use 50%; intermediate resolutions scale proportionally.
        const interfaceScale = interfaceScaleForWidth(monitor.width);
        const scaledDockWidth = Math.round(DOCK_WIDTH * interfaceScale);
        const innerGap = Math.round(12 * interfaceScale);
        for (const actor of [this._datePanel, this.actor,
            this._systemInfo?.actor]) {
            actor?.set_pivot_point(0, 0);
            actor?.set_scale(interfaceScale, interfaceScale);
        }

        // Reserve the visible left pane and bottom controls plus equal outer
        // gaps on the top, left, and right. Shrinking the old 16px left inset
        // to 8px offsets the new 8px right inset, preserving center width.
        const status = Main.layoutManager.uiGroup.get_children()
            .find(actor => actor.name === 'codex-bottom-status-tile');
        let bottom = 80;
        let paneBottom = monitor.y + monitor.height - OUTER_GAP;
        if (status && status.height > 0) {
            const [, statusY] = status.get_transformed_position();
            const [, statusHeight] = status.get_transformed_size();
            const inset = monitor.y + monitor.height - statusY;
            if (statusHeight > 0 && inset > 0 && inset < monitor.height / 2) {
                bottom = Math.ceil(inset) + OUTER_GAP;
                // statusY is in stage coordinates, so pair it with the
                // transformed height. At the laptop's 50% interface scale,
                // status.height is still the unscaled 4K allocation and
                // produces the wrong lower edge for the side pane.
                paneBottom = statusY + statusHeight;
            }
        }
        const left = OUTER_GAP + scaledDockWidth + innerGap;
        const [leftEdge, bottomEdge, topEdge, rightEdge] = this._reservations;
        leftEdge.set_position(monitor.x, monitor.y);
        leftEdge.set_size(left, monitor.height);
        bottomEdge.set_position(monitor.x, monitor.y + monitor.height - bottom);
        bottomEdge.set_size(monitor.width, bottom);
        topEdge.set_position(monitor.x, monitor.y);
        topEdge.set_size(monitor.width, this._topOuterGap);
        rightEdge.set_position(monitor.x + monitor.width - OUTER_GAP, monitor.y);
        rightEdge.set_size(OUTER_GAP, monitor.height);

        const x = monitor.x + OUTER_GAP;
        const dateY = monitor.y + this._topOuterGap;
        this._datePanel.set_position(x, dateY);
        this._datePanel.set_width(DOCK_WIDTH);
        const dateHeight = this._datePanel.get_preferred_height(DOCK_WIDTH)[1];
        const y = dateY + Math.ceil(dateHeight * interfaceScale) + innerGap;

        this.actor.set_position(x, y);
        this.actor.set_width(DOCK_WIDTH);
        if (this._systemInfo) {
            const workspaceHeight = this.actor.get_preferred_height(DOCK_WIDTH)[1];
            const systemY = y + Math.ceil(workspaceHeight * interfaceScale) + innerGap;
            this._systemInfo.actor.set_position(x, systemY);
            this._systemInfo.actor.set_height(Math.max(1,
                Math.floor((paneBottom - systemY) / interfaceScale)));
        }
    }
}

export default class WorkspacesToDockCodexExtension extends Extension {
    enable() {
        this._dock = new WorkspaceDock(this);
        this._dock.enable();
        this._innerEdgeSnapping = new InnerEdgeSnapping();
        this._halfWindowGap = new HalfWindowGap();
        this._layoutSelector = new LayoutSelector();
    }

    disable() {
        this._halfWindowGap?.destroy();
        this._layoutSelector?.destroy();
        this._layoutSelector = null;
        this._halfWindowGap = null;
        this._innerEdgeSnapping?.destroy();
        this._innerEdgeSnapping = null;
        this._dock?.disable();
        this._dock = null;
    }
}
