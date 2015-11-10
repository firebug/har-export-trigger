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
const { devtools, makeInfallible, safeRequire } = require("firebug.sdk/lib/core/devtools.js");

// https://bugzilla.mozilla.org/show_bug.cgi?id=912121
const { get: getHarOverlay } = safeRequire(devtools,
  "devtools/client/netmonitor/har/toolbox-overlay",
  "devtools/netmonitor/har/toolbox-overlay");

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

    this.automation = options.automation;
  },

  destroy: function() {
    ToolboxOverlay.prototype.destroy.apply(this, arguments);

    Trace.sysout("TriggerToolboxOverlay.destroy;", arguments);
  },

  // Events

  onReady: function(options) {
    ToolboxOverlay.prototype.onReady.apply(this, arguments);

    Trace.sysout("TriggerToolboxOverlay.onReady;", options);

    // Platform support is needed here.
    // See: https://bugzilla.mozilla.org/show_bug.cgi?id=1184889
    if (typeof getHarOverlay != "function") {
      Cu.reportError("Platform support needed, see Bug: " +
        "https://bugzilla.mozilla.org/show_bug.cgi?id=1184889");
      return;
    }

    // Call make remote to make sure the target.client exists.
    let target = this.toolbox.target;
    target.makeRemote().then(() => {
      // The 'devtools.netmonitor.har.enableAutoExportToFile' option doesn't
      // have to be set if users don't want to auto export to file after
      // every page load.
      // But, if users want to use HAR content API to trigger HAR export
      // when needed, HAR automation needs to be activated. Let's do it now
      // if 'extensions.netmonitor.har.enableAutomation' preference is true.
      if (prefs.enableAutomation && !this.automation) {
        Trace.sysout("TriggerToolboxOverlay.onReady; Init automation");

        // Initialize automation.
        let harOverlay = getHarOverlay(this.toolbox);
        if (!harOverlay.automation) {
          harOverlay.initAutomation();
        }
        this.automation = harOverlay.automation;
      }

      this.patchAutomation(this.automation);

      // This is a bit hacky, but the HarAutomation starts monitoring
      // after target.makeRemote() promise is resolved.
      // It's resolved after the parent target.makeRemote() (we are just within)
      // finishes.
      // So, let's register another promise handler and reset the collector
      // after the HarAutomation.startMonitoring() is actually executed.
      target.makeRemote().then(() => {
        // Make sure the collector exists. The collector is automatically
        // created when the page load begins, but the toolbox can be opened
        // in the middle of page session (after page load event).
        // And HAR API consumer might want to export any time.
        if (this.automation && !this.automation.collector) {
          this.automation.resetCollector();
        }
      });

      this.attach().then(front => {
        Trace.sysout("TriggerToolboxOverlay.onReady; HAR driver ready!");
      });
    });
  },

  /**
   * xxxHonza: this needs better platform API.
   * See also: https://github.com/firebug/har-export-trigger/issues/10
   */
  patchAutomation: function(automation) {
    if (!automation) {
      return;
    }

    let self = this;
    automation.pageLoadDone = function(response) {
      Trace.sysout("HarAutomation.patchAutomation;", response);

      if (this.collector) {
        this.collector.waitForHarLoad().then(collector => {
          self.onPageLoadDone(response);
          return this.autoExport();
        });
      }
    }
  },

  onPageLoadDone: function(response) {
    Trace.sysout("TriggerToolboxOverlay.onPageLoadDone;", response);

    this.front.pageLoadDone();
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

    if (!this.automation) {
      let pref1 = "devtools.netmonitor.har.enableAutoExportToFile";
      let pref2 = "extensions.netmonitor.har.enableAutomation";

      if (!this.automation) {
        Cu.reportError("You need to set '" + pref1 + "' or '" + pref2 +
          "' pref to enable HAR export through the API " +
          "(browser restart is required)");
      }
      return;
    }

    if (!this.automation.collector) {
      Cu.reportError("The HAR collector doesn't exist. Page reload required.");
      return;
    }

    // Trigger HAR export now! Use executeExport() not triggerExport()
    // since we don't want to have the default name automatically provided.
    this.automation.executeExport(data).then(jsonString => {
      var har = jsonString;
      try {
        if (jsonString) {
          har = JSON.parse(jsonString);
        }
      } catch (err) {
        Trace.sysout("TriggerToolboxOverlay.triggerExport; ERROR " +
          "Failed to parse HAR log " + err);
      }

      Trace.sysout("TriggerToolboxOverlay.triggerExport; DONE", har);

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
    Trace.sysout("TriggerToolboxOverlay.clear;");

    let panel = this.toolbox.getPanel("netmonitor");

    // Clean up also the HAR collector.
    this.automation.resetCollector();

    // Clear the Network panel content. The panel doesn't
    // have to exist if the user doesn't select it yet.
    if (panel) {
      let view = panel.panelWin.NetMonitorView;
      view.RequestsMenu.clear();
    };
  },
});

// Exports from this module
exports.TriggerToolboxOverlay = TriggerToolboxOverlay;
