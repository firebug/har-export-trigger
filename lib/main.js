/* See license.txt for terms of usage */

"use strict";

module.metadata = {
  "stability": "stable"
};

// Add-on SDK
const { Cu, Ci } = require("chrome");
const { Trace, TraceError } = require("firebug.sdk/lib/core/trace.js").get(module.id);
const { ToolboxChrome } = require("firebug.sdk/lib/toolbox-chrome.js");

// HARExportTrigger
const { TriggerToolboxOverlay } = require("./trigger-toolbox-overlay.js");
const { TriggerToolbox } = require("./trigger-toolbox.js");

/**
 * Entry point of the extension. Both 'main' and 'onUnload' methods are
 * exported from this module and executed automatically by Add-ons SDK.
 */
function main(options, callbacks) {
  ToolboxChrome.initialize(options);

  ToolboxChrome.registerToolboxOverlay(TriggerToolboxOverlay);
  TriggerToolbox.initialize();
}

/**
 * Executed on browser shutdown or when the extension is
 * uninstalled/removed/disabled.
 */
function onUnload(reason) {
  ToolboxChrome.unregisterToolboxOverlay(TriggerToolboxOverlay);
  TriggerToolbox.shutdown(reason);

  ToolboxChrome.shutdown(reason);
}

// Exports from this module
exports.main = main;
exports.onUnload = onUnload;
