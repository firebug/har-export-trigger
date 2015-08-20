/* See license.txt for terms of usage */

"use strict";

module.metadata = {
  "stability": "stable"
};

// Add-on SDK
const options = require("@loader/options");
const { Cu, Ci } = require("chrome");
const { Class } = require("sdk/core/heritage");
const { defer, resolve } = require("sdk/core/promise");
const { on, off, emit } = require("sdk/event/core");
const { prefs } = require("sdk/simple-prefs");

// Platform
const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});

// DevTools
const { devtools } = Cu.import("resource://gre/modules/devtools/Loader.jsm", {});
const { makeInfallible } = devtools["require"]("devtools/toolkit/DevToolsUtils.js");
const { get: getHarOverlay } = devtools["require"]("devtools/netmonitor/har/toolbox-overlay.js");

// Firebug SDK
const { Trace, TraceError } = require("firebug.sdk/lib/core/trace.js").get(module.id);
const { ToolboxOverlay } = require("firebug.sdk/lib/toolbox-overlay.js");
const { Rdp } = require("firebug.sdk/lib/core/rdp.js");

// HARExportTrigger
const { HarDriverFront } = require("./har-driver-front");

// URL of the {@HarDriverActor} module. This module will be
// installed and loaded on the backend.
const actorModuleUrl = options.prefixURI + "lib/har-driver-actor.js";

/**
 * @overlay This object represents an overlay for the Toolbox. The
 * overlay is created when the Toolbox is opened and destroyed when
 * the Toolbox is closed. There is one instance of the overlay per
 * Toolbox, and so there can be more overlay instances created per
 * one browser session.
 *
 * This extension uses the overlay to register and attach/detach the
 * backend actor.
 */
const TriggerToolboxOverlay = Class(
/** @lends TriggerToolboxOverlay */
{
  extends: ToolboxOverlay,

  overlayId: "TriggerToolboxOverlay",

  // Initialization

  initialize: function(options) {
    ToolboxOverlay.prototype.initialize.apply(this, arguments);

    Trace.sysout("TriggerToolboxOverlay.initialize;", options);
  },

  destroy: function() {
    ToolboxOverlay.prototype.destroy.apply(this, arguments);

    Trace.sysout("TriggerToolboxOverlay.destroy;", arguments);
  },

  // Events

  onReady: function(options) {
    ToolboxOverlay.prototype.onReady.apply(this, arguments);

    Trace.sysout("TriggerToolboxOverlay.onReady;", options);

    // Call make remote to make sure the target.client exists.
    let target = this.toolbox.target;
    target.makeRemote().then(() => {
      this.attach().then(front => {
        Trace.sysout("TriggerToolboxOverlay.onReady; HAR driver ready!");
      });
    });
  },

  // Backend

  /**
   * Attach to the backend actor.
   */
  attach: makeInfallible(function() {
    Trace.sysout("TriggerToolboxOverlay.attach;");

    if (this.deferredAttach) {
      return this.deferredAttach.promise;
    }

    let config = {
      prefix: HarDriverFront.prototype.typeName,
      actorClass: "HarDriverActor",
      frontClass: HarDriverFront,
      moduleUrl: actorModuleUrl
    };

    this.deferredAttach = defer();
    let client = this.toolbox.target.client;

    // Register as tab actor.
    Rdp.registerTabActor(client, config).then(({registrar, front}) => {
      Trace.sysout("TriggerToolboxOverlay.attach; READY", this);

      // xxxHonza: Unregister at shutdown
      this.registrar = registrar;
      this.front = front;

      this.front.setToken(prefs.contentAPIToken).then(() => {
        emit(this, "attach", front);

        // Listen to API calls. Every time the page executes
        // HAR API, corresponding event is sent from the backend.
        front.on("trigger-export", this.triggerExport.bind(this));
        front.on("clear", this.clear.bind(this));

        this.deferredAttach.resolve(front);
      });
    });

    return this.deferredAttach.promise;
  }),

  // Content API

  /**
   * Handle RDP event from the backend. HAR.triggerExport() has been
   * executed in the page and existing data in the Network panel
   * need to be exported.
   */
  triggerExport: function(data) {
    Trace.sysout("TriggerToolboxOverlay.triggerExport;", data);

    // Platform support is needed here.
    // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1184889
    if (typeof getHarOverlay != "function") {
      Cu.reportError("Platform support needed, see Bug: " +
        "https://bugzilla.mozilla.org/show_bug.cgi?id=1184889");
      return;
    }

    var harOverlay = getHarOverlay(this.toolbox);
    if (!harOverlay) {
      Trace.sysout("TriggerToolboxOverlay.triggerExport; ERROR " +
        "no HAR overlay!", data);
      return;
    }

    if (!harOverlay.automation) {
      let pref = "devtools.netmonitor.har.enableAutoExportToFile";
      let autoExport = Services.prefs.getBoolPref(pref);
      if (!autoExport) {
        Cu.reportError("You need to set '" + pref + "' pref to enable " +
          " automated HAR export (browser restart is required)");
      }
      return;
    }

    if (!harOverlay.automation.collector) {
      Cu.reportError("The HAR collector doesn't exist. Page reload required.");
      return;
    }

    // Trigger HAR export now!
    harOverlay.automation.triggerExport(data).then(jsonString => {
      Trace.sysout("TriggerToolboxOverlay.triggerExport; DONE", jsonString);

      // Send event back to the backend notifying that it has
      // finished. If 'getData' is true include also the HAR string.
      // The content API call will be resolved as soon as the packet
      // arrives on the backend.
      if (data.id) {
        this.front.exportDone({
          id: data.id,
          data: data.getData ? jsonString : undefined,
        });
      }
    });
  },

  /**
   * Handle RDP event from the backend. HAR.clear() has been
   * executed in the page and the Network panel content
   * needs to be cleared.
   */
  clear: function() {
    let panel = this.toolbox.getPanel("netmonitor");

    // Clear the Network panel content if it exists.
    if (panel) {
      let view = panel.panelWin.NetMonitorView;
      view.RequestsMenu.clear();
    };
  },
});

// Exports from this module
exports.TriggerToolboxOverlay = TriggerToolboxOverlay;
