import {desktopConfig} from './config.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const WIDTH = 274;
const readText = (path, cancel) => new Promise((resolve, reject) => {
    Gio.File.new_for_path(path).load_contents_async(cancel, (file, result) => {
        try {
            const [, data] = file.load_contents_finish(result);
            resolve(new TextDecoder().decode(data));
        } catch (error) { reject(error); }
    });
});
const size = n => n >= 1073741824 ? `${(n / 1073741824).toFixed(1)} G` : `${(n / 1048576).toFixed(0)} M`;
const speed = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} M/s` : `${(n / 1024).toFixed(0)} KiB/s`;

export class SystemInfo {
    constructor(palette) {
        this._palette = palette;
        this._cancel = new Gio.Cancellable();
        this._dead = false;
        this._busy = false;
        this._gpuBusy = false;
        this._diskPending = new Set();
        this._levels = {cpu: null, memory: null, swap: null, diskRoot: null, diskNfs: null};
        this._networkHistory = [];
        this._charts = {};
        this._labels = {};
        this._gpuIcons = [];
        const content = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.START,
            x_expand: true, style: 'spacing: 5px;'});
        const headerContent = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 5px;'});
        this.actor = new St.BoxLayout({vertical: true, width: WIDTH,
            style_class: palette.cssClass, style: 'spacing: 12px;'});
        this.actor.add_child(new St.Bin({width: WIDTH, style_class: 'codex-workspaces-dock', child: headerContent, x_align: Clutter.ActorAlign.FILL}));
        this.actor.add_child(new St.Bin({width: WIDTH, y_expand: true,
            style_class: 'codex-workspaces-dock', child: content}));
        const label = (key, text, small = false) => {
            const isHeader = ['kernel', 'uptime'].includes(key);
            const item = new St.Label({text, x_expand: true, x_align: Clutter.ActorAlign.FILL,
                style: `font-size: ${isHeader ? 26 : 23}px; color: ${this._palette.text}; text-align: left;`});
            item.clutter_text.ellipsize = 3;
            if (['gpu', 'vram', 'power', 'encoder'].includes(key)) {
                const row = new St.BoxLayout({style: 'spacing: 8px;'});
                const icon = new St.Icon({
                    icon_name: 'video-display-symbolic',
                    icon_size: 24,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                this._gpuIcons.push(icon);
                row.add_child(icon);
                item.x_expand = true;
                row.add_child(item);
                content.add_child(row);
            } else {
                (['kernel', 'uptime'].includes(key) ? headerContent : content).add_child(item);
            }
            this._labels[key] = item;
        };
        const chart = (key, height) => {
            const area = new St.DrawingArea({width: 256, height});
            area.connect('repaint', () => this._drawChart(area, key));
            content.add_child(area);
            this._charts[key] = area;
        };
        label('kernel', 'Linux-…', true);
        label('uptime', 'Up …');
        label('cpu', 'CPU …'); chart('cpu', 14);
        label('memory', 'RAM …'); chart('memory', 14);
        label('swap', 'Swap …'); chart('swap', 14);
        label('diskRoot', 'ROOT …', true); chart('diskRoot', 14);
        label('diskNfs', 'NFS …', true); chart('diskNfs', 14);
        label('rates', '↓ …   ↑ …', true); chart('network', 48);
        this._setupGpuSelector(content);
        label('gpu', 'Usage …', true);
        label('vram', 'VRAM …', true);
        label('power', 'Power …', true);
        label('encoder', 'ENC —', true);
        Main.layoutManager.addChrome(this.actor, {affectsStruts: false, trackFullscreen: true});
        readText('/proc/sys/kernel/osrelease', this._cancel).then(text => {
            if (!this._dead) this._labels.kernel.text = `Linux-${text.trim().match(/^\d+\.\d+(?:\.\d+)?/)?.[0] || text.trim()}`;
        }).catch(() => {});
        this._findCpuSensor();
        this._sample(); this._disk(); this._gpu();
        this._timers = [
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => { this._sample(); return GLib.SOURCE_CONTINUE; }),
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => { this._disk(); return GLib.SOURCE_CONTINUE; }),
            GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => { this._gpu(); return GLib.SOURCE_CONTINUE; }),
        ];
    }

    async _findCpuSensor() {
        let enumerator;
        try {
            const root = Gio.File.new_for_path('/sys/class/hwmon');
            enumerator = root.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, this._cancel);
            let entry;
            while ((entry = enumerator.next_file(this._cancel))) {
                const base = `/sys/class/hwmon/${entry.get_name()}`;
                const name = (await readText(`${base}/name`, this._cancel)).trim();
                if (!['coretemp', 'k10temp', 'zenpower'].includes(name)) continue;
                // coretemp temp1 is package temperature; AMD drivers expose Tctl here.
                const candidate = `${base}/temp1_input`;
                const value = Number((await readText(candidate, this._cancel)).trim());
                if (!this._dead && Number.isFinite(value)) this._cpuSensor = candidate;
                return;
            }
        } catch (_) { /* Temperature remains unavailable if no CPU sensor exists. */ }
        finally { enumerator?.close(null); }
    }

    async _sample() {
        if (this._busy || this._dead) return;
        this._busy = true;
        try {
            const results = await Promise.allSettled(['/proc/stat', '/proc/meminfo', '/proc/net/dev', '/proc/net/route', '/proc/uptime', this._cpuSensor]
                .map(path => path ? readText(path, this._cancel) : Promise.resolve(null)));
            if (this._dead) return;
            Object.assign(this._levels, {cpu: null, memory: null, swap: null});
            const values = results.map(result => result.status === 'fulfilled' ? result.value : null);
            if (values[4]) {
                const seconds = Number(values[4].split(/\s+/)[0]);
                if (Number.isFinite(seconds)) {
                    const minutes = Math.floor(seconds / 60);
                    const days = Math.floor(minutes / 1440);
                    const hours = Math.floor(minutes / 60) % 24;
                    this._labels.uptime.text = `Up ${days ? `${days}d ` : ''}${hours}h ${minutes % 60}m`;
                }
            } else this._labels.uptime.text = 'Up —';
            const temperature = values[5] === null ? NaN : Number(values[5].trim()) / 1000;
            const temperatureText = Number.isFinite(temperature) ? `${Math.round(temperature)}°C` : '—°C';
            if (values[0]) {
                const counters = values[0].split('\n')[0].trim().split(/\s+/).slice(1, 9).map(Number);
                const total = counters.reduce((a, b) => a + b, 0), idle = counters[3] + counters[4];
                if (this._cpu && total > this._cpu.total) {
                    const percent = Math.max(0, Math.min(100, 100 * (1 - (idle - this._cpu.idle) / (total - this._cpu.total))));
                    this._levels.cpu = percent;
                    this._labels.cpu.text = `CPU ${percent.toFixed(0)}% · ${temperatureText}`;
                }
                this._cpu = {total, idle};
            } else this._labels.cpu.text = 'CPU unavailable';
            if (values[1]) {
                const mem = Object.fromEntries([...values[1].matchAll(/^(\w+):\s+(\d+)/gm)].map(m => [m[1], Number(m[2]) * 1024]));
                const used = mem.MemTotal - mem.MemAvailable;
                this._levels.memory = 100 * used / mem.MemTotal;
                this._levels.swap = mem.SwapTotal ? 100 * (mem.SwapTotal - mem.SwapFree) / mem.SwapTotal : 0;
                this._labels.memory.text = `RAM  ${size(used)} / ${size(mem.MemTotal)}`;
                this._labels.swap.text = mem.SwapTotal ? `Swap  ${size(mem.SwapTotal - mem.SwapFree)} / ${size(mem.SwapTotal)}` : 'Swap  disabled';
            } else this._labels.memory.text = 'Memory unavailable';
            const interfaces = (values[2] || '').split('\n')
                .filter(row => row.includes(':')).map(row => row.split(':')[0].trim());
            const speedifyInterface = interfaces.find(name => /^(?:connectify|speedify)(?:\d+)?$/i.test(name));
            const usbWifiInterface = interfaces.find(name => /^wl.*u\d/i.test(name)) ??
                interfaces.find(name => name.startsWith('wl') && name !== 'wlp0s20f3');
            const candidates = [
                ['network', speedifyInterface, 'Speedify'],
                ['wifiMain', 'wlp0s20f3', 'wlp0s20f3'],
                ['ethernet', 'enp4s0', 'enp4s0'],
                ['wifiDongle', usbWifiInterface, usbWifiInterface ?? 'USB Wi-Fi'],
            ];
            // Link state only: do not generate internet probes from the widget.
            const online = await Promise.all(candidates.map(async ([, name]) => {
                if (!name || !interfaces.includes(name)) return false;
                try {
                    const [flags, carrier] = await Promise.all([
                        readText(`/sys/class/net/${name}/flags`, this._cancel),
                        readText(`/sys/class/net/${name}/carrier`, this._cancel),
                    ]);
                    return Boolean(Number(flags.trim()) & 1) && carrier.trim() === '1';
                } catch (_) { return false; }
            }));
            if (this._dead) return;
            const selected = online.findIndex(Boolean);
            const iface = selected < 0 ? null : candidates[selected][1];
            const line = iface && (values[2] || '').split('\n')
                .find(row => row.trim().startsWith(`${iface}:`));
            if (iface && line) {
                const numbers = line.split(':')[1].trim().split(/\s+/).map(Number);
                const now = GLib.get_monotonic_time() / 1000000;
                if (this._net?.iface === iface && now > this._net.time &&
                    numbers[0] >= this._net.rx && numbers[8] >= this._net.tx) {
                    const dt = now - this._net.time;
                    const down = Math.max(0, (numbers[0] - this._net.rx) / dt);
                    const up = Math.max(0, (numbers[8] - this._net.tx) / dt);
                    this._labels.rates.text = `↓ ${speed(down)}   ↑ ${speed(up)}`;
                    this._networkHistory.push([down, up]);
                    if (this._networkHistory.length > 60) this._networkHistory.shift();
                } else {
                    this._networkHistory = [];
                    this._labels.rates.text = '↓ …   ↑ …';
                }
                this._net = {iface, rx: numbers[0], tx: numbers[8], time: now};
            } else {
                this._networkHistory = [];
                this._net = null;
                this._labels.rates.text = '↓ —   ↑ —';
            }
            for (const chart of Object.values(this._charts)) chart.queue_repaint();
        } finally { this._busy = false; }
    }

    _drawChart(area, key) {
        const cr = area.get_context();
        try {
            const [w, h] = area.get_surface_size();
            cr.setSourceRGBA(1, 1, 1, 0.09);
            cr.rectangle(0, 0, w, h); cr.fill();
            if (key !== 'network') {
                const value = this._levels[key];
                if (value !== null && Number.isFinite(value)) {
                    cr.setSourceRGBA(...this._palette.accent.slice(0, 3), 0.95);
                    cr.rectangle(0, 0, w * Math.max(0, Math.min(100, value)) / 100, h);
                    cr.fill();
                }
                return;
            }
            cr.setSourceRGBA(1, 1, 1, 0.12); cr.setLineWidth(1);
            for (const fraction of [0.25, 0.5, 0.75]) {
                cr.moveTo(0, h * fraction); cr.lineTo(w, h * fraction);
            }
            cr.stroke();
            const max = Math.max(1024, ...this._networkHistory.flat());
            for (let series = 0; series < 2; series++) {
                cr.setSourceRGBA(...(series ? this._palette.graphSecondary : this._palette.accent));
                cr.setLineWidth(2);
                this._networkHistory.forEach((point, index) => {
                    const x = (60 - this._networkHistory.length + index) * (w - 2) / 59 + 1;
                    const y = h - 2 - point[series] / max * (h - 4);
                    if (index === 0) cr.moveTo(x, y); else cr.lineTo(x, y);
                });
                cr.stroke();
            }
        } finally { cr.$dispose(); }
    }

    _disk() {
        for (const [path, key, title] of [
            ['/', 'diskRoot', 'ROOT'],
            [desktopConfig().nfsPath || '/var/nfs', 'diskNfs', 'NFS'],
        ]) {
            // Never stack requests if a remote filesystem is slow to respond.
            if (this._diskPending.has(key)) continue;
            this._diskPending.add(key);
            Gio.File.new_for_path(path).query_filesystem_info_async(
                'filesystem::free,filesystem::size,filesystem::type',
                GLib.PRIORITY_DEFAULT, this._cancel, (file, result) => {
                    try {
                        const info = file.query_filesystem_info_finish(result);
                        if (key === 'diskNfs' && !['nfs', 'nfs4'].includes(info.get_attribute_string('filesystem::type')))
                            throw new Error('Streams NFS mount is unavailable');
                        const total = info.get_attribute_uint64('filesystem::size');
                        const used = Math.max(0, total - info.get_attribute_uint64('filesystem::free'));
                        if (!this._dead) {
                            const divisor = key === 'diskNfs' ? 1099511627776 : 1073741824;
                            const unit = key === 'diskNfs' ? 'T' : 'G';
                            this._labels[key].text = `${title} ${(used / divisor).toFixed(1)} / ${(total / divisor).toFixed(1)} ${unit}`;
                            this._levels[key] = total > 0 ? 100 * used / total : null;
                            this._charts[key].queue_repaint();
                        }
                    } catch (_) {
                        if (!this._dead) {
                            this._labels[key].text = `${title} unavailable`;
                            this._levels[key] = null;
                            this._charts[key].queue_repaint();
                        }
                    } finally {
                        this._diskPending.delete(key);
                    }
                });
        }
    }

    _setupGpuSelector(content) {
        this._gpuVendor = 'auto';
        this._gpuStatePath = GLib.build_filenamev([GLib.get_user_config_dir(), 'codex-gpu-monitor']);
        try {
            const [ok, data] = GLib.file_get_contents(this._gpuStatePath);
            const value = ok ? new TextDecoder().decode(data).trim() : '';
            if (['auto', 'amd', 'nvidia'].includes(value)) this._gpuVendor = value;
        } catch (_) { /* Default to automatic hardware detection. */ }
        this._gpuButton = new St.Button({can_focus: true, x_expand: true,
            style: `font-size: 18px; color: ${this._palette.text}; text-align: left;`});
        const titles = {auto: 'Auto', amd: 'AMD', nvidia: 'NVIDIA'};
        this._gpuButton.label = `GPU: ${titles[this._gpuVendor]} ▾`;
        this._gpuButton.accessible_name = 'Select GPU to monitor';
        content.add_child(this._gpuButton);
        this._gpuMenu = new PopupMenu.PopupMenu(this._gpuButton, 0.5, St.Side.LEFT);
        Main.uiGroup.add_child(this._gpuMenu.actor);
        this._gpuMenu.actor.hide();
        this._gpuMenuManager = new PopupMenu.PopupMenuManager(this._gpuButton);
        this._gpuMenuManager.addMenu(this._gpuMenu);
        this._gpuItems = [];
        for (const vendor of ['auto', 'amd', 'nvidia']) {
            const item = new PopupMenu.PopupMenuItem(titles[vendor]);
            item.setOrnament(vendor === this._gpuVendor ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
            item.connect('activate', () => {
                this._gpuVendor = vendor;
                this._gpuButton.label = `GPU: ${titles[vendor]} ▾`;
                for (const [value, menuItem] of this._gpuItems)
                    menuItem.setOrnament(value === vendor ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NONE);
                try { GLib.file_set_contents(this._gpuStatePath, vendor + '\n'); }
                catch (error) { console.warn(`Could not save GPU selection: ${error.message}`); }
                this._gpu();
            });
            this._gpuItems.push([vendor, item]);
            this._gpuMenu.addMenuItem(item);
        }
        this._gpuButton.connect('clicked', () => this._gpuMenu.toggle());
    }

    _setGpuIcons(vendor) {
        if (vendor === this._gpuIconVendor) return;
        this._gpuIconVendor = vendor;
        const file = ['amd', 'nvidia'].includes(vendor)
            ? Gio.File.new_for_uri(import.meta.url).get_parent().get_child(`${vendor}-logo.svg`)
            : null;
        for (const icon of this._gpuIcons) {
            icon.gicon = file ? new Gio.FileIcon({file}) : null;
            if (!file) icon.icon_name = 'video-display-symbolic';
        }
    }

    _gpu() {
        if (this._gpuBusy || this._dead) return;
        const binary = GLib.find_program_in_path('python3');
        const helper = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('gpuMonitor.py').get_path();
        if (!binary) { this._labels.gpu.text = 'GPU monitor needs Python 3'; return; }
        try {
            this._gpuBusy = true;
            const process = Gio.Subprocess.new([binary, helper, '--vendor', this._gpuVendor], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this._gpuProcess = process;
            process.communicate_utf8_async(null, this._cancel, (proc, result) => {
                this._gpuBusy = false;
                if (this._dead) return;
                try {
                    const [, out] = proc.communicate_utf8_finish(result);
                    if (!proc.get_successful()) throw new Error('GPU query failed');
                    const values = JSON.parse(out);
                    this._setGpuIcons(values.vendor);
                    for (const key of ['gpu', 'vram', 'power', 'encoder']) {
                        this._labels[key].text = values[key];
                    }
                } catch (_) {
                    this._labels.gpu.text = 'GPU unavailable';
                    this._labels.vram.text = 'VRAM —'; this._labels.power.text = 'Power —'; this._labels.encoder.text = 'ENC —';
                }
                this._gpuProcess = null;
            });
        } catch (_) { this._gpuBusy = false; this._labels.gpu.text = 'GPU unavailable'; }
    }

    destroy() {
        this._dead = true;
        this._cancel.cancel();
        this._gpuProcess?.force_exit();
        this._gpuMenu?.destroy();
        for (const timer of this._timers) GLib.source_remove(timer);
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}
