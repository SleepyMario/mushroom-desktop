import {desktopConfig} from './config.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const OUTER_GAP = 8;
const REFERENCE_MONITOR_WIDTH = 3840;
const REFERENCE_SIDE_PANE_WIDTH = 274;
const REFERENCE_DOCK_ICON_SIZE = 48;

const interfaceScaleForWidth = width => Math.max(0.5,
    Math.min(1, width / REFERENCE_MONITOR_WIDTH));

export default class BottomStatusPanel extends Extension {
    enable() {
        this._brightProfile = this._isBrightProfile();
        this._items = new Map();
        this._menus = new Map();
        this._menuBoxes = new Set();
        this._styledMenuActors = new Set();
        this._styledShellPopupActors = new Set();
        this._dockPatches = new Map();
        this._dockAlignPending = 0;
        this._signals = [];
        this._pending = 0;
        this._panelVisible = Main.layoutManager.panelBox.visible;
        this._createDashSettings();
        this._syncDashScale();
        this._content = new St.BoxLayout({
            vertical: false,
            x_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 6px;',
        });
        this._tile = new St.Bin({
            name: 'codex-bottom-status-tile',
            style_class: 'dash-background',
            reactive: true,
            child: this._content,
        });
        this._applyBrightClass(this._tile, 'sm-bright-bottom-status');
        this._applyBrightClass(this._content, 'sm-bright-bottom-status-content');
        Main.layoutManager.addChrome(this._tile, {affectsStruts: false, trackFullscreen: true});
        // The workspace extension owns the left/bottom reservations.
        Main.layoutManager.untrackChrome(Main.layoutManager.panelBox);
        Main.layoutManager.panelBox.hide();
        this._signals.push([Main.panel._rightBox,
            Main.panel._rightBox.connect('child-added', () => this._queueCollect())]);
        this._signals.push([Main.layoutManager,
            Main.layoutManager.connect('monitors-changed', () => {
                this._syncDashScale();
                this._place();
                this._queueDockAlignment();
            })]);
        this._signals.push([global.display,
            global.display.connect('workareas-changed', () => this._queueDockAlignment())]);
        this._createPlatforms();
        this._createWeather();
        this._collect();
        this._styleShellPopups();
        this._place();
        this._queueDockAlignment();
        this._styleTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._styleShellPopups();
            this._place();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _isBrightProfile() {
        try {
            const [ok, contents] = GLib.file_get_contents(
                GLib.build_filenamev([GLib.get_home_dir(), '.config', 'sleepymario', 'theme-profile']));
            return ok && new TextDecoder().decode(contents).trim() === 'SM-macOS Bright';
        } catch (_) {
            return false;
        }
    }

    _createDashSettings() {
        try {
            const defaults = Gio.SettingsSchemaSource.get_default();
            let schema = defaults.lookup('org.gnome.shell.extensions.dash-to-dock', true);
            for (const base of [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]) {
                for (const uuid of ['dash-to-dock@micxgx.gmail.com', 'ubuntu-dock@ubuntu.com']) {
                    if (schema) break;
                    const directory = GLib.build_filenamev([base, 'gnome-shell', 'extensions', uuid, 'schemas']);
                    if (!GLib.file_test(directory, GLib.FileTest.IS_DIR)) continue;
                    const source = Gio.SettingsSchemaSource.new_from_directory(directory, defaults, false);
                    schema = source.lookup('org.gnome.shell.extensions.dash-to-dock', true);
                }
            }
            if (!schema)
                return;
            this._dashSettings = new Gio.Settings({settings_schema: schema});
            this._savedDashIconSize = this._dashSettings.get_int('dash-max-icon-size');
            this._savedDashShrink = this._dashSettings.get_boolean('custom-theme-shrink');
        } catch (error) {
            console.warn(`Could not load Dash-to-Dock sizing settings: ${error.message}`);
        }
    }

    _syncDashScale() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._dashSettings)
            return;
        const scale = interfaceScaleForWidth(monitor.width);
        const iconSize = Math.max(16, Math.round(REFERENCE_DOCK_ICON_SIZE * scale));
        if (this._dashSettings.get_int('dash-max-icon-size') !== iconSize)
            this._dashSettings.set_int('dash-max-icon-size', iconSize);
        const compact = scale < 1;
        if (this._dashSettings.get_boolean('custom-theme-shrink') !== compact)
            this._dashSettings.set_boolean('custom-theme-shrink', compact);
    }

    _applyBrightClass(actor, className) {
        if (this._brightProfile)
            actor?.add_style_class_name(className);
    }

    _styleShellPopups() {
        if (!this._brightProfile)
            return;

        const visit = actor => {
            const classes = actor.get_style_class_name?.() ?? '';
            if (classes.split(/\s+/).some(name =>
                name === 'popup-menu-content' ||
                name === 'popup-sub-menu' ||
                name === 'quick-settings')) {
                actor.add_style_class_name('sm-bright-status-menu');
                this._styledShellPopupActors.add(actor);
            }
            for (const child of actor.get_children?.() ?? [])
                visit(child);
        };
        visit(global.stage);
    }

    _createWeather() {
        this._weatherClient = Main.panel.statusArea.dateMenu?._weatherItem?._weatherClient;
        this._weatherIcon = new St.Icon({icon_name: 'weather-clear-symbolic', icon_size: 22});
        this._weatherLabel = new St.Label({text: 'Weather loading…',
            y_align: Clutter.ActorAlign.CENTER});
        const row = new St.BoxLayout({style: 'spacing: 10px;',
            y_align: Clutter.ActorAlign.CENTER});
        row.add_child(this._weatherIcon);
        row.add_child(this._weatherLabel);
        this._weatherTile = new St.Button({style_class: 'dash-background',
            can_focus: true, reactive: true, track_hover: true, child: row});
        this._applyBrightClass(this._weatherTile, 'sm-bright-bottom-status');
        this._weatherTile.connect('clicked', () => this._weatherClient?.activateApp());
        Main.layoutManager.addChrome(this._weatherTile, {affectsStruts: false, trackFullscreen: true});
        if (this._weatherClient) {
            this._signals.push([this._weatherClient,
                this._weatherClient.connect('changed', () => this._syncWeather())]);
            this._weatherClient.update();
            this._weatherTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 600, () => {
                this._weatherClient.update();
                return GLib.SOURCE_CONTINUE;
            });
        }
        this._syncWeather();
    }

    _syncWeather() {
        const client = this._weatherClient;
        if (!client?.hasLocation) {
            this._weatherLabel.text = 'Select weather location';
            return;
        }
        const info = client.info;
        const location = info.get_location();
        const name = location.get_city_name() || location.get_name();
        if (!info.is_valid()) {
            this._weatherLabel.text = `${name} · ${client.loading ? 'Loading…' : 'Weather unavailable'}`;
            return;
        }
        this._weatherIcon.icon_name = info.get_symbolic_icon_name() || 'weather-clear-symbolic';
        let condition = info.get_conditions();
        if (!condition || condition === '-')
            condition = info.get_sky();
        this._weatherLabel.text = `${name} · ${info.get_temp()} · ${condition}`;
        this._weatherTile.accessible_name = this._weatherLabel.text;
    }

    _createPlatforms() {
        this._platforms = new Map();
        this._platformRow = new St.BoxLayout({style: 'spacing: 6px;'});
        for (const [key, text, url, color, foreground] of [
            ['twitch', 'T', 'https://www.twitch.tv/', '#9146ff', '#ffffff'],
            ['kick', 'K', 'https://kick.com/', '#53fc18', '#071407'],
            ['youtube', 'Y', 'https://www.youtube.com/', '#ff0000', '#ffffff'],
        ]) {
            const button = new St.Button({
                can_focus: true, reactive: true, track_hover: true,
                child: new St.Label({text, y_align: Clutter.ActorAlign.CENTER,
                    style: 'font-family: "Symbols Nerd Font Mono"; font-size: 20px; font-weight: bold;'}),
                accessible_name: `${key}: status unavailable`,
            });
            button.connect('clicked', () => GLib.spawn_async(null, ['xdg-open', desktopConfig().platformLinks?.[key] || url], null,
                GLib.SpawnFlags.SEARCH_PATH, null));
            this._platformRow.add_child(button);
            this._platforms.set(key, {button, color, foreground});
        }
        this._platformTile = new St.Bin({style_class: 'dash-background', child: this._platformRow});
        this._applyBrightClass(this._platformTile, 'sm-bright-bottom-status');
        Main.layoutManager.addChrome(this._platformTile, {affectsStruts: false, trackFullscreen: true});
        this._http = new Soup.Session({timeout: 3});
        this._setPlatformState(null);
        this._refreshPlatforms();
        this._platformTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            this._refreshPlatforms();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _setPlatformState(document) {
        for (const [key, {button, color, foreground}] of this._platforms) {
            const status = document?.platforms?.[key];
            const live = !!status?.available && !!status?.live;
            button.set_style(`min-width: 30px; padding: 0 7px; border-radius: 8px; ` +
                `background-color: ${live ? color : '#586e75'}; color: ${live ? foreground : '#eee8d5'};`);
            button.accessible_name = `${key}: ${!status?.available ? 'status unavailable' : live ? 'Online' : 'Offline'}`;
        }
    }

    _refreshPlatforms() {
        const session = this._http;
        const endpoint = desktopConfig().platformStatusUrl;
        if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint)) return;
        const message = Soup.Message.new('GET', endpoint);
        if (!message) return;
        message.request_headers.append('Cache-Control', 'no-store');
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
            if (this._http !== session)
                return;
            try {
                const bytes = source.send_and_read_finish(result);
                if (message.status_code !== 200)
                    throw new Error('Status endpoint unavailable');
                this._setPlatformState(JSON.parse(new TextDecoder().decode(bytes.get_data())));
            } catch (_) {
                this._setPlatformState(null);
            }
        });
    }

    _queueCollect() {
        if (this._pending)
            return;
        this._pending = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._pending = 0;
            this._collect();
            return GLib.SOURCE_REMOVE;
        });
    }

    _collect() {
        for (const child of Main.panel._rightBox.get_children()) {
            const saved = {xExpand: child.x_expand, yExpand: child.y_expand};
            saved.destroyId = child.connect('destroy', () => this._items.delete(child));
            this._items.set(child, saved);
            Main.panel._rightBox.remove_child(child);
            child.x_expand = false;
            child.y_expand = false;
            this._applyBrightClass(child, 'sm-bright-status-item');
            this._content.add_child(child);
        }
        for (const indicator of Object.values(Main.panel.statusArea)) {
            if (!this._items.has(indicator.container))
                continue;
            const pointer = indicator.menu?._boxPointer;
            if (pointer && !this._menus.has(pointer)) {
                const saved = {side: pointer._userArrowSide};
                saved.destroyId = pointer.connect('destroy', () => this._menus.delete(pointer));
                this._menus.set(pointer, saved);
                pointer.updateArrowSide(St.Side.BOTTOM);
            }
            const menuBox = indicator.menu?.box;
            if (this._brightProfile) {
                if (menuBox && !this._menuBoxes.has(menuBox))
                    this._menuBoxes.add(menuBox);
                for (const actor of [pointer, indicator.menu?.actor, menuBox]) {
                    if (!actor?.add_style_class_name || this._styledMenuActors.has(actor))
                        continue;
                    actor.add_style_class_name('sm-bright-status-menu');
                    this._styledMenuActors.add(actor);
                }
            }
        }
    }

    _findDockBackground() {
        const visit = (actor, inDock = false) => {
            inDock ||= actor.get_name() === 'dashtodockContainer';
            if (inDock && actor.has_style_class_name?.('dash-background')) {
                const [x, y] = actor.get_transformed_position();
                const monitor = Main.layoutManager.primaryMonitor;
                if (monitor && x >= monitor.x && x < monitor.x + monitor.width)
                    return actor;
            }
            for (const child of actor.get_children()) {
                const match = visit(child, inDock);
                if (match)
                    return match;
            }
            return null;
        };
        return visit(Main.layoutManager.uiGroup);
    }

    _queueDockAlignment() {
        if (this._dockAlignPending)
            return;
        this._dockAlignPending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._dockAlignPending = 0;
            this._patchAndAlignAppDock();
            return GLib.SOURCE_REMOVE;
        });
    }

    _patchAndAlignAppDock() {
        const monitor = Main.layoutManager.primaryMonitor;
        const background = this._findDockBackground();
        if (!monitor || !background)
            return;

        let dock = background;
        while (dock && dock.get_name() !== 'dashtodockContainer')
            dock = dock.get_parent();
        if (!dock || !dock.has_style_class_name('bottom'))
            return;

        if (!this._dockPatches.has(dock) && typeof dock._resetPosition === 'function') {
            const extension = this;
            const originalReset = dock._resetPosition;
            const wrappedReset = function (...args) {
                const result = originalReset.apply(this, args);
                extension._queueDockAlignment();
                return result;
            };
            dock._resetPosition = wrappedReset;
            const saved = {originalReset, wrappedReset};
            saved.destroyId = dock.connect('destroy', () => this._dockPatches.delete(dock));
            this._dockPatches.set(dock, saved);
        }

        const [x] = background.get_transformed_position();
        const [width] = background.get_transformed_size();
        if (width <= 0)
            return;
        const delta = monitor.x + monitor.width - OUTER_GAP - x - width;
        if (Math.abs(delta) > 0.5) {
            dock.set_x(dock.x + delta);
            dock._updateBarrier?.();
        }
    }

    _place() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const background = this._findDockBackground();
        let height = 72;
        if (background && background.height > 0) {
            const node = background.get_theme_node();
            const rgba = color => `rgba(${color.red},${color.green},${color.blue},${color.alpha / 255})`;
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const style = `background-color: ${rgba(node.get_background_color())}; ` +
                `border: ${node.get_border_width(St.Side.TOP) / scale}px solid ${rgba(node.get_border_color(St.Side.TOP))}; ` +
                `border-radius: ${node.get_border_radius(St.Corner.TOPLEFT) / scale}px; ` +
                'padding: 0 12px;';
            if (this._tile.get_style() !== style)
                this._tile.set_style(style);
            height = background.height;
        }
        this._tile.set_height(height);
        this._tile.set_width(-1);
        this._platformTile.set_style(this._tile.get_style());
        this._platformTile.set_height(height);
        // Follow the workspace extension's scaled 4K reference geometry.
        const interfaceScale = interfaceScaleForWidth(monitor.width);
        const platformX = monitor.x + OUTER_GAP +
            Math.round(REFERENCE_SIDE_PANE_WIDTH * interfaceScale) +
            Math.round(12 * interfaceScale);
        const platformWidth = this._platformTile.get_preferred_width(height)[1];
        this._weatherTile.set_style(this._tile.get_style());
        this._weatherTile.set_height(height);
        const statusWidth = this._tile.get_preferred_width(height)[1];
        // Scale from the monitor itself, not from Dash-to-Dock's transient
        // allocation. The latter changes while the dock relayouts and caused
        // the lower bar to alternate between two sizes.
        const naturalGap = 12;
        const lowerScale = interfaceScale;
        const gap = Math.round(naturalGap * lowerScale);
        const visualHeight = Math.ceil(height * lowerScale);
        const y = monitor.y + monitor.height - OUTER_GAP - visualHeight;
        for (const actor of [this._platformTile, this._tile, this._weatherTile]) {
            actor.set_pivot_point(0, 0);
            actor.set_scale(lowerScale, lowerScale);
        }
        this._platformTile.set_position(platformX, y);
        const statusX = platformX + Math.ceil(platformWidth * lowerScale) + gap;
        this._tile.set_position(statusX, y);
        this._weatherTile.set_position(statusX +
            Math.ceil(statusWidth * lowerScale) + gap, y);
    }

    disable() {
        if (this._weatherTimer)
            GLib.source_remove(this._weatherTimer);
        this._weatherTimer = 0;
        if (this._weatherTile) {
            Main.layoutManager.removeChrome(this._weatherTile);
            this._weatherTile.destroy();
            this._weatherTile = null;
        }
        if (this._platformTimer)
            GLib.source_remove(this._platformTimer);
        this._platformTimer = 0;
        const session = this._http;
        this._http = null;
        session?.abort();
        if (this._platformTile) {
            Main.layoutManager.removeChrome(this._platformTile);
            this._platformTile.destroy();
            this._platformTile = null;
        }
        this._platforms?.clear();
        if (this._dockAlignPending)
            GLib.source_remove(this._dockAlignPending);
        this._dockAlignPending = 0;
        for (const [dock, saved] of this._dockPatches ?? []) {
            try {
                dock.disconnect(saved.destroyId);
                if (dock._resetPosition === saved.wrappedReset)
                    dock._resetPosition = saved.originalReset;
            } catch (_) {
                // The dock may already have been destroyed during shutdown.
            }
        }
        this._dockPatches?.clear();
        if (this._styleTimer)
            GLib.source_remove(this._styleTimer);
        this._styleTimer = 0;
        for (const [object, id] of this._signals ?? [])
            object.disconnect(id);
        if (this._pending)
            GLib.source_remove(this._pending);
        this._pending = 0;
        for (const [pointer, saved] of this._menus ?? []) {
            pointer.disconnect(saved.destroyId);
            pointer.updateArrowSide(saved.side);
        }
        for (const [child, saved] of this._items ?? []) {
            child.disconnect(saved.destroyId);
            child.remove_style_class_name('sm-bright-status-item');
            child.get_parent()?.remove_child(child);
            child.x_expand = saved.xExpand;
            child.y_expand = saved.yExpand;
            Main.panel._rightBox.add_child(child);
        }
        this._items?.clear();
        this._menus?.clear();
        for (const menuBox of this._menuBoxes ?? []) {
            try { menuBox.remove_style_class_name('sm-bright-status-menu'); } catch (_) { /* Menu removed by its owner. */ }
        }
        this._menuBoxes?.clear();
        for (const actor of this._styledMenuActors ?? []) {
            try { actor.remove_style_class_name('sm-bright-status-menu'); } catch (_) { /* Menu removed by its owner. */ }
        }
        this._styledMenuActors?.clear();
        for (const actor of this._styledShellPopupActors ?? []) {
            try { actor.remove_style_class_name('sm-bright-status-menu'); } catch (_) { /* Popup removed by its owner. */ }
        }
        this._styledShellPopupActors?.clear();
        if (this._tile) {
            Main.layoutManager.removeChrome(this._tile);
            this._tile.destroy();
            this._tile = null;
        }
        if (this._dashSettings) {
            if (this._savedDashIconSize !== undefined)
                this._dashSettings.set_int('dash-max-icon-size', this._savedDashIconSize);
            if (this._savedDashShrink !== undefined)
                this._dashSettings.set_boolean('custom-theme-shrink', this._savedDashShrink);
            this._dashSettings = null;
        }
        Main.layoutManager.trackChrome(Main.layoutManager.panelBox,
            {affectsStruts: true, trackFullscreen: true});
        Main.layoutManager.panelBox.visible = this._panelVisible;
    }
}
