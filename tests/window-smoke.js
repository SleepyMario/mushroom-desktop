imports.gi.versions.Gtk = '4.0';
const {Gtk, GLib} = imports.gi;
const app = new Gtk.Application({application_id: 'org.mushroom.DesktopSmoke'});
app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({application: app, title: 'Mushroom desktop test window', default_width: 640, default_height: 480});
    window.present();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {window.maximize(); return GLib.SOURCE_REMOVE;});
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {window.unmaximize(); return GLib.SOURCE_REMOVE;});
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4000, () => {app.quit(); return GLib.SOURCE_REMOVE;});
});
app.run([]);
