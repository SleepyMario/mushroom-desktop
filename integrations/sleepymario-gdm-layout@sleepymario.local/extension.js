import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const GROUP_CLASS = 'login-dialog-bottom-button-group';
const A11Y_CLASS = 'a11y-button';
const SESSION_CLASS = 'login-dialog-session-list-button';

function findByStyleClass(actor, styleClass) {
    if (actor.has_style_class_name?.(styleClass))
        return actor;

    for (const child of actor.get_children?.() ?? []) {
        const match = findByStyleClass(child, styleClass);
        if (match)
            return match;
    }

    return null;
}

function childHasStyleClass(actor, styleClass) {
    if (actor.has_style_class_name?.(styleClass))
        return true;

    return (actor.get_children?.() ?? [])
        .some(child => childHasStyleClass(child, styleClass));
}

export default class SleepyMarioGdmLayoutExtension extends Extension {
    enable() {
        let attempts = 0;

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const dialog = findByStyleClass(global.stage, 'login-dialog');
            if (dialog && !this._dialog)
                this._alignLogin(dialog);

            const group = findByStyleClass(global.stage, GROUP_CLASS);
            if ((!group || !this._dialog) && ++attempts < 50)
                return GLib.SOURCE_CONTINUE;

            if (group) {
                const children = group.get_children();
                const accessibility = children.find(
                    child => childHasStyleClass(child, A11Y_CLASS));
                const session = children.find(
                    child => childHasStyleClass(child, SESSION_CLASS));

                if (accessibility && session)
                    group.set_child_above_sibling(session, accessibility);
            }

            this._timeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });

        GLib.Source.set_name_by_id(
            this._timeoutId, '[sleepymario-gdm-layout] arrange bottom controls');
    }

    _alignLogin(dialog) {
        if (typeof dialog._getCenterActorAllocation !== 'function')
            return;

        this._dialog = dialog;
        this._originalAllocation = dialog._getCenterActorAllocation;
        const original = this._originalAllocation;
        this._leftAllocation = function (dialogBox, actor) {
            const box = original.call(this, dialogBox, actor);
            const width = box.x2 - box.x1;
            const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
            const [dialogX] = this.get_transformed_position();
            const [panelX] = Main.panel._leftBox.get_transformed_position();
            // Align below the left panel group, with a small scaled inset.
            // Keep GNOME's vertical placement and preferred actor dimensions.
            const inset = Math.max(0, panelX - dialogX) + 24 * scale;
            box.x1 = dialogBox.x1 + Math.min(inset,
                Math.max(0, dialogBox.x2 - dialogBox.x1 - width));
            box.x2 = box.x1 + width;
            return box;
        };
        dialog._getCenterActorAllocation = this._leftAllocation;
        dialog.queue_relayout();
    }

    disable() {
        if (this._dialog) {
            if (this._dialog._getCenterActorAllocation === this._leftAllocation)
                this._dialog._getCenterActorAllocation = this._originalAllocation;
            this._dialog.queue_relayout();
            this._dialog = null;
            this._originalAllocation = null;
            this._leftAllocation = null;
        }

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }
}
