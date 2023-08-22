/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';

// This is the live instance of the Quick Settings menu
const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

import { Tailscale } from "./tailscale.js";

const TailscaleIndicator = GObject.registerClass(
  class TailscaleIndicator extends QuickSettings.SystemIndicator {
    _init(icon, tailscale) {
      super._init();

      // Create the icon for the indicator
      const up = this._addIndicator();
      up.gicon = icon;
      up.visible = false;
      tailscale.bind_property("running", up, "visible", GObject.BindingFlags.DEFAULT);

      // Create the icon for the indicator
      const exit = this._addIndicator();
      exit.icon_name = "network-vpn-symbolic";
      exit.visible = false;

      let _up = false;
      let _exit_node = false;
      const setVisible = () => exit.visible = _up && _exit_node

      tailscale.connect("notify::exit-node", (obj) => {
        _exit_node = obj.exit_node != "";
        setVisible();
      });
      tailscale.connect("notify::running", (obj) => {
        _up = obj.running;
        setVisible();
      });
    }
  }
);

const TailscaleDeviceItem = GObject.registerClass(
  class TailscaleDeviceItem extends PopupMenu.PopupBaseMenuItem {
    _init(icon_name, text, subtitle, callback) {
      super._init({});

      const icon = new St.Icon({
        style_class: 'popup-menu-icon',
      });
      this.add_child(icon);
      icon.icon_name = icon_name;

      const label = new St.Label({
        x_expand: true,
      });
      this.add_child(label);
      label.text = text;

      const sub = new St.Label({
        style_class: 'device-subtitle',
      });
      this.add_child(sub);
      sub.text = subtitle

      this.connect('activate', () => callback());
    }
  }
);

const TailscaleMenuToggle = GObject.registerClass(
  class TailscaleMenuToggle extends QuickSettings.QuickMenuToggle {
    _init(icon, tailscale) {
      super._init({
        title: "Tailscale",
        gicon: icon,
        toggleMode: true,
        menuEnabled: true,
      });
      tailscale.bind_property("running", this, "checked", GObject.BindingFlags.BIDIRECTIONAL);

      // This function is unique to this class. It adds a nice header with an
      // icon, title and optional subtitle. It's recommended you do so for
      // consistency with other menus.
      this.menu.setHeader(icon, this.title);

      // NODES
      const nodes = new PopupMenu.PopupMenuSection();
      tailscale.connect("notify::nodes", (obj) => {
        nodes.removeAll();
        for (const node of obj.nodes) {
          const icon = !node.online ? "network-offline-symbolic" : ((node.os == "android" || node.os == "iOS") ? "phone-symbolic" : "computer-symbolic");
          const subtitle = node.exit_node ? _("disable exit node") : (node.exit_node_option ? _("use as exit node") : "");
          const callback = () => node.exit_node_option && (tailscale.exit_node = node.exit_node ? "" : node.name);

          nodes.addMenuItem(new TailscaleDeviceItem(icon, node.name, subtitle, callback));
        }
      });
      this.menu.addMenuItem(nodes);

      // SEPARATOR
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // PREFS
      const prefs = new PopupMenu.PopupSubMenuMenuItem(_("Settings"), false, {});

      const routes = new PopupMenu.PopupSwitchMenuItem(_("Accept routes"), false, {});
      tailscale.connect("notify::accept-routes", (obj) => routes.setToggleState(obj.accept_routes));
      routes.connect("toggled", (item) => tailscale.accept_routes = item.state);
      prefs.menu.addMenuItem(routes);

      const dns = new PopupMenu.PopupSwitchMenuItem(_("Accept DNS"), false, {});
      tailscale.connect("notify::accept-dns", (obj) => dns.setToggleState(obj.accept_dns));
      dns.connect("toggled", (item) => tailscale.accept_dns = item.state);
      prefs.menu.addMenuItem(dns);

      const lan = new PopupMenu.PopupSwitchMenuItem(_("Allow LAN access"), false, {});
      tailscale.connect("notify::allow-lan-access", (obj) => lan.setToggleState(obj.allow_lan_access));
      lan.connect("toggled", (item) => tailscale.allow_lan_access = item.state);
      prefs.menu.addMenuItem(lan);

      const shields = new PopupMenu.PopupSwitchMenuItem(_("Shields up"), false, {});
      tailscale.connect("notify::shields-up", (obj) => shields.setToggleState(obj.shields_up));
      shields.connect("toggled", (item) => tailscale.shields_up = item.state);
      prefs.menu.addMenuItem(shields);

      const ssh = new PopupMenu.PopupSwitchMenuItem(_("SSH"), false, {});
      tailscale.connect("notify::ssh", (obj) => ssh.setToggleState(obj.ssh));
      ssh.connect("toggled", (item) => tailscale.ssh = item.state);
      prefs.menu.addMenuItem(ssh);

      this.menu.addMenuItem(prefs);
    }
  }
);

export default class TailscaleExtension extends Extension {
  enable() {
    const tailscale = new Tailscale();
    this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
      tailscale.refresh_status();
      tailscale.refresh_prefs();
      return GLib.SOURCE_CONTINUE;
    });

    const icon = Gio.icon_new_for_string(`${path}/icons/tailscale.svg`);

    this._indicator = new TailscaleIndicator(icon, tailscale);
    QuickSettingsMenu._indicators.insert_child_at_index(this._indicator, 0);

    this._menu = new TailscaleMenuToggle(icon, tailscale);
    QuickSettingsMenu._addItems([this._menu]);
    QuickSettingsMenu.menu._grid.set_child_below_sibling(
      this._menu,
      QuickSettingsMenu._backgroundApps.quickSettingsItems[0]
    );
  }

  disable() {
    GLib.Source.remove(this._timerId);
    this._timerId = null;

    this._menu.destroy();
    this._menu = null;

    this._indicator.destroy();
    this._indicator = null;
  }
}
