/* See license.txt for terms of usage */

"use strict";

module.metadata = {
  "stability": "stable"
};

// Add-on SDK
const options = require("@loader/options");
const { Cu } = require("chrome");
const { Class } = require("sdk/core/heritage");
const { prefs } = require("sdk/simple-prefs");
const { defer, resolve } = require("sdk/core/promise");
const { emit } = require("sdk/event/core");

// Firebug.SDK
const { DebuggerServer, DebuggerClient, devtools } = require("firebug.sdk/lib/core/devtools.js");
const { Trace, TraceError } = require("firebug.sdk/lib/core/trace.js").get(module.id);
const { TriggerToolboxOverlay } = require("./trigger-toolbox-overlay.js");

// Platform
const { HarAutomation } = devtools.require("devtools/client/netmonitor/har/har-automation");

// Constants
const TargetFactory = devtools.TargetFactory;

/**
 * TODO: docs
 */
const TriggerToolbox =
/** @lends TriggerToolbox */
{
  // Initialization

  initialize: function() {
    this.onTabListChanged = this.onTabListChanged.bind(this);

    // Map<tab, TriggerToolboxOverlay>
    this.overlays = new Map();

    if (!prefs.autoConnect) {
      return;
    }

    this.connect().then(client => {
      this.onReady(client);
    });
  },

  onReady: function(client) {
    Trace.sysout("TriggerToolbox.onReady;", client);

    this.client = client;
    this.client.addListener("tabListChanged", this.onTabListChanged);

    // Ensure that initial connection for the default tab is created.
    this.onTabListChanged();
  },

  shutdown: function() {
    this.close();
  },

  // Connect/close

  connect: function() {
    let deferred = defer();

    if (!DebuggerServer.initialized) {
      DebuggerServer.init();
      DebuggerServer.addBrowserActors();
    }

    let client = new DebuggerClient(DebuggerServer.connectPipe());
    client.connect(() => {
      Trace.sysout("TriggerToolbox.connect; DONE", client);
      deferred.resolve(client);
    });

    return deferred.promise;
  },

  close: function() {
    Trace.sysout("TriggerToolbox.close;");

    if (!this.target) {
      return resolve();
    }

    if (this.destroyer) {
      return this.destroyer.promise;
    }

    this.destroyer = defer();

    this.client.close(() => {
      this.destroyer.resolve();
    });

    return this.destroyer.promise;
  },

  // Events

  /**
   * Handle 'tabListChanged' event and attach the selected tab.
   * Note that there is an extra connection created for each tab.
   * So, network events ('tabListChanged' and 'networkEventUpdate')
   * are sent only to the attached automation.collector object.
   *
   * xxxHonza: if we remove the check in HarCollector.onNetworkEventUpdate
   * method (labeled as: 'Skip events from unknown actors') we might
   * do everything through one connection. But this needs testing.
   */
  onTabListChanged: function(eventId, packet) {
    Trace.sysout("TriggerToolbox.onTabListChanged;", arguments);

    // Execute 'listTabs' to make sure that 'tabListChanged' event
    // will be sent the next time (this is historical complexity
    // of the backend). This must be done after every 'tabListChanged'.
    this.client.listTabs(response => {
      if (response.error) {
        Trace.sysout("TriggerToolbox.onTabListChanged; ERROR " +
          response.message, response);
        return;
      }

      let currentTab = response.tabs[response.selected];
      Trace.sysout("TriggerToolbox.onTabListChanged; " +
        "(initial connection): " + currentTab.actor, response);

      // Bail out if the tab already has its own connection.
      if (this.overlays.has(currentTab.actor)) {
        return;
      }

      // Create new connection for the current tab.
      this.connect().then(client => {
        // Execute list of tabs for the new connection (it'll maintain
        // it's own tab actors on the backend).
        client.listTabs(response => {
          let tabForm = response.tabs[response.selected];
          let tabActor = tabForm.actor;

          Trace.sysout("TriggerToolbox.onTabListChanged; " +
            "current tab: " + tabActor, tabForm);

          // Attach to the current tab using the new connection.
          this.attachTab(tabForm, client).then(result => {
            this.overlays.set(currentTab.actor, result);

            Trace.sysout("TriggerToolbox.onTabListChanged; tab attached: " +
              currentTab.actor, this.overlays);
          });
        });
      });
    });
  },

  onTabNavigated: function(packet) {
    Trace.sysout("TriggerToolbox.onTabNavigated; " + packet.from, packet);
  },

  onTabDetached: function(packet) {
    Trace.sysout("TriggerToolbox.onTabDetached; " + packet.from, packet);

    var tabActor = packet.from;

    // Destroy the automation object and close its connection.
    var entry = this.overlays.get(tabActor);
    if (entry) {
      entry.overlay.destroy();
      entry.automation.destroy();
      entry.client.close();

      this.overlays.delete(tabActor);
    }
  },

  /**
   * Attach to given tab.
   */
  attachTab: function(tab, client) {
    Trace.sysout("TriggerToolbox.attachTab; " + tab.actor);

    let config = {
      form: tab,
      client: client,
      chrome: false,
    };

    // Create target, automation object and the toolbox overlay object
    // This is what the real Toolbox does (but the Toolbox
    // isn't available at the moment).
    return TargetFactory.forRemoteTab(config).then(target => {
      Trace.sysout("TriggerToolbox.attachTab; target", target);

      // Simulate the Toolbox object since the TriggerToolboxOverlay
      // is based on it.
      // xxxHonza: If TriggerToolboxOverlay is based on the target
      // things would be easier.
      var toolbox = {
        target: target,
        getPanel: function() {},
        on: function() {}
      };

      var automation = new HarAutomation(toolbox);

      // Create toolbox overlay (just like for the real Toolbox).
      let options = {
        toolbox: toolbox,
        automation: automation,
      }

      // Instantiate the toolbox overlay and simulate onReady event.
      var overlay = new TriggerToolboxOverlay(options);
      overlay.onReady({});

      Trace.sysout("TriggerToolbox.onTabSelected; New automation", options);

      return {
        overlay: overlay,
        automation: automation,
        client: client
      };
    });
  }
};

// Exports from this module
exports.TriggerToolbox = TriggerToolbox;
