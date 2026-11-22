import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Native Mutter tiling needs time at an edge to display its 200 ms preview.
// Shared edges have no physical stop; resist crossing briefly during a move.
export function sharedVerticalEdges(monitors) {
    const edges = [];
    for (const left of monitors) {
        for (const right of monitors) {
            if (left === right || left.x + left.width !== right.x) continue;
            const y1 = Math.max(left.y, right.y);
            const y2 = Math.min(left.y + left.height, right.y + right.height);
            if (y2 > y1) edges.push({x: right.x, y1, y2});
        }
    }
    return edges;
}

export class InnerEdgeSnapping {
    constructor() {
        this._barriers = [];
        this._settings = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._beginId = global.display.connect('grab-op-begin', (_display, window, op) => {
            this._clear();
            if (!this._settings.get_boolean('edge-tiling') ||
                ![Meta.GrabOp.MOVING, Meta.GrabOp.MOVING_UNCONSTRAINED].includes(op) ||
                !window.allows_resize() || window.is_fullscreen()) return;
            try {
                for (const edge of sharedVerticalEdges(Main.layoutManager.monitors)) {
                    const barrier = new Meta.Barrier({
                        backend: global.backend,
                        x1: edge.x, x2: edge.x, y1: edge.y1, y2: edge.y2,
                        directions: 0,
                    });
                    this._barriers.push(barrier);
                    barrier.connect('hit', () => {
                        if (this._releaseTimer) return;
                        // Always let a continued drag cross, even without more motion.
                        this._releaseTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
                            this._releaseTimer = 0;
                            this._clear();
                            return GLib.SOURCE_REMOVE;
                        });
                    });
                }
            } catch (error) {
                this._clear();
                console.warn(`Inner-edge snapping unavailable: ${error.message}`);
            }
        });
        this._endId = global.display.connect('grab-op-end', () => this._clear());
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._clear());
    }

    _clear() {
        if (this._releaseTimer) GLib.source_remove(this._releaseTimer);
        this._releaseTimer = 0;
        for (const barrier of this._barriers) barrier.destroy();
        this._barriers = [];
    }

    destroy() {
        this._clear();
        global.display.disconnect(this._beginId);
        global.display.disconnect(this._endId);
        Main.layoutManager.disconnect(this._monitorsId);
        this._settings = null;
    }
}
