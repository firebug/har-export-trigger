/* See license.txt for terms of usage */

"use strict";

module.metadata = {
  "stability": "stable"
};

// Add-on SDK
const { Cu } = require("chrome");

// DevTools
const DevTools = require("firebug.sdk/lib/core/devtools.js");
const { Front, FrontClass } = DevTools.Protocol;

// Firebug SDK
const { Trace, TraceError } = require("firebug.sdk/lib/core/trace.js").get(module.id);

// HARExportTrigger
const { HarDriverActor } = require("./har-driver-actor.js");

/**
 * @front This object represents client side for the backend actor.
 *
 * Read more about Protocol API:
 * https://github.com/mozilla/gecko-dev/blob/master/toolkit/devtools/server/docs/protocol.js.md
 */
var HarDriverFront = FrontClass(HarDriverActor,
/** @lends HarDriverFront */
{
  // Initialization

  initialize: function(client, form) {
    Front.prototype.initialize.apply(this, arguments);

    Trace.sysout("HarDriverFront.initialize;", this);

    this.actorID = form[HarDriverActor.prototype.typeName];
    this.manage(this);
  },
});

// Exports from this module
exports.HarDriverFront = HarDriverFront;
