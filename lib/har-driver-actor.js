/* See license.txt for terms of usage */

"use strict";

/**
 * This module is loaded on the backend (can be a remote device) where
 * some module or features (such as Tracing console) don't have to
 * be available. Also Firebug SDK isn't available on the backend.
 */

// Add-on SDK
const { Cu, Ci, components } = require("chrome");
const Events = require("sdk/event/core");

// Platform
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

function safeImport(...args) {
  for (var i=0; i<args.length; i++) {
    try {
      return Cu["import"](args[i], {});
    }
    catch (err) {
    }
  }
  return {};
}

function safeRequire(devtools, ...args) {
  for (var i=0; i<args.length; i++) {
    try {
      return devtools["require"](args[i]);
    }
    catch (err) {
    }
  }
  return {};
}

// DevTools
// See also: https://bugzilla.mozilla.org/show_bug.cgi?id=912121
const devtools = safeImport(
  "resource://devtools/shared/Loader.jsm",
  "resource://gre/modules/devtools/shared/Loader.jsm",
  "resource://gre/modules/devtools/Loader.jsm"
).devtools;

const DevToolsUtils = safeRequire(devtools,
  "devtools/shared/DevToolsUtils",
  "devtools/toolkit/DevToolsUtils"
);

const { DebuggerServer } = devtools["require"]("devtools/server/main");

const Protocol = safeRequire(devtools,
  "devtools/shared/protocol",
  "devtools/server/protocol"
);

const { method, RetVal, ActorClass, Actor, Arg, types } = Protocol;

// For debugging purposes. Note that the tracing module isn't available
// on the backend (in case of remote device debugging).
// const baseUrl = "resource://harexporttrigger-at-getfirebug-dot-com/";
// const { getTrace } = Cu.import(baseUrl + "node_modules/firebug.sdk/lib/core/actor.js");
// const Trace = getTrace(DebuggerServer.parentMessageManager);
const Trace = {sysout: () => {}};

/**
 * Helper actor state watcher.
 * expectState has been introduced in Fx42
 * TODO: const { expectState } = require("devtools/server/actors/common");
 */
function expectState(expectedState, method) {
  return function(...args) {
    if (this.state !== expectedState) {
      Trace.sysout("actor.expectState; ERROR wrong state, expected '" +
        expectedState + "', but current state is '" + this.state + "'" +
        ", method: " + method);

      let msg = "Wrong State: Expected '" + expectedState + "', but current " +
        "state is '" + this.state + "'";

      return Promise.reject(new Error(msg));
    }

    try {
      return method.apply(this, args);
    } catch (err) {
      Cu.reportError("actor.js; expectState EXCEPTION " + err, err);
    }
  };
}

/**
 * @actor
 *
 * Read more about Protocol API:
 * https://github.com/mozilla/gecko-dev/blob/master/toolkit/devtools/server/docs/protocol.js.md
 */
var HarDriverActor = ActorClass(
/** @lends HarDriverActor */
{
  typeName: "harExportDriver",

  /**
   * Events emitted by this actor.
   */
  events: {
    "trigger-export": {
      type: "trigger-export",
      data: Arg(0, "json")
    },
    "clear": {
      type: "clear",
    },
  },

  exportsInProgress: new Map(),

  // Initialization

  initialize: function(conn, parent) {
    Trace.sysout("HarDriverActor.initialize; parent: " +
      parent.actorID + ", conn: " + conn.prefix, this);

    Actor.prototype.initialize.call(this, conn);

    this.parent = parent;
    this.state = "detached";
  },

  /**
   * The destroy is only called automatically by the framework (parent actor)
   * if an actor is instantiated by a parent actor.
   */
  destroy: function() {
    Trace.sysout("HarDriverActor.destroy; state: " + this.state, arguments);

    if (this.state === "attached") {
      this.detach();
    }

    Actor.prototype.destroy.call(this);
  },

  /**
   * Automatically executed by the framework when the parent connection
   * is closed.
   */
  disconnect: function() {
    Trace.sysout("HarDriverActor.disconnect; state: " + this.state, arguments);

    if (this.state === "attached") {
      this.detach();
    }
  },

  /**
   * Attach to this actor. Executed when the front (client) is attaching
   * to this actor.
   */
  attach: method(expectState("detached", function() {
    Trace.sysout("HarDriverActor.attach;", arguments);

    this.state = "attached";
  }), {
    request: {},
    response: {
      type: "attached"
    }
  }),

  /**
   * Set UI stylesheet for anonymous content (sent from the client).
   */
  setToken: method(expectState("attached", function(token) {
    Trace.sysout("HarDriverActor.setToken;", arguments);

    this.token = token;

    const notifyMask = Ci.nsIWebProgress.NOTIFY_STATUS |
      Ci.nsIWebProgress.NOTIFY_STATE_WINDOW |
      Ci.nsIWebProgress.NOTIFY_STATE_DOCUMENT;

    let win = this.parent.originalWindow;

    // Do not overwrite HAR object. It might be already there if
    // autoConntect is on or there might be an existing object
    // with the same on the page.
    if (win.wrappedJSObject.HAR) {
      return;
    }

    // The client just attached to this actor, let's expose
    // HAR API to the content.
    this.parent.webProgress.addProgressListener(this, notifyMask);
    this.api = new ExportDriverApi(this);
    this.exposeToContentInternal(this.parent.originalWindow);
  }), {
    request: {
      token: Arg(0, "string"),
    },
    response: {
      type: "api-exposed"
    }
  }),

  /**
   * Detach from this actor. Executed when the front (client) detaches
   * from this actor.
   */
  detach: method(expectState("attached", function() {
    Trace.sysout("HarDriverActor.detach;", arguments);

    this.state = "detached";

    if (this.api) {
      this.parent.webProgress.removeProgressListener(this);
    }
  }), {
    request: {},
    response: {
      type: "detached"
    }
  }),

  /**
   * The client calls this method when page is loaded.
   */
  pageLoadDone: method(expectState("attached", function() {
    let win = this.parent.originalWindow;
    let event = new win.MessageEvent("har-page-ready");
    win.dispatchEvent(event);
    return true;
  }), {
    request: {},
    response: {}
  }),

  /**
   * The client calls this method when HAR export has finished.
   * It allows to resolve associated promise and let the content
   * caller know that the export is done.
   */
  exportDone: method(expectState("attached", function(options) {
    if (!options.id) {
      return false;
    }

    // The HAR export is identified by ID and there should be
    // corresponding promise in the exports-in-progress array.
    let resolve = this.exportsInProgress.get(options.id);
    if (!resolve) {
      return false;
    }

    // Let's resolve the promise. If 'getData' property has been
    // set the result HAR string is also passed to the caller.
    let win = this.parent.originalWindow;
    let result = new win.Object();
    result.data = options.data;
    resolve(result);

    return true;
  }), {
    request: {
      options: Arg(0, "json"),
    },
    response: {
      result: RetVal("boolean")
    }
  }),

  // Internals

  exposeToContentInternal: function(win) {
    if (win.hasOwnProperty("HAR")) {
      return;
    }

    exportIntoContentScope(win, this.api, "HAR");

    let event = new win.MessageEvent("har-api-ready");
    win.dispatchEvent(event);
  },

  // onWebProgressListener

  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIWebProgressListener,
    Ci.nsISupportsWeakReference,
    Ci.nsISupports,
  ]),

  onStateChange: method(expectState("attached", function(aProgress, aRequest,
    aFlag, aStatus) {

    let isStart = aFlag & Ci.nsIWebProgressListener.STATE_START;
    let isStop = aFlag & Ci.nsIWebProgressListener.STATE_STOP;
    let isDocument = aFlag & Ci.nsIWebProgressListener.STATE_IS_DOCUMENT;
    let isWindow = aFlag & Ci.nsIWebProgressListener.STATE_IS_WINDOW;
    let isTransferring = aFlag & Ci.nsIWebProgressListener.STATE_TRANSFERRING;

    let win = aProgress.DOMWindow;
    if (isDocument && (isTransferring || isStop)) {
      this.exposeToContentInternal(win);
    }
  })),
});

// Export Driver Content API

/**
 * This object implements content API. Every call is checked
 * against the "contentAPIToken" that needs to be set in
 * Firefox preferences. If the token doesn't match the API
 * is not executed.
 */
function ExportDriverApi(actor) {
  let exportID = 0;
  let win = actor.parent.originalWindow;
  let exportsInProgress = actor.exportsInProgress;

 function securityCheck(method) {
    return function(options) {
      if (options.token != actor.token) {
        let pref = "extensions.netmonitor.har.contentAPIToken";
        let msg = "Security check didn't pass. You need to set '" +
          pref + "' pref to match the string token passed into " +
          "HAR object API call (browser restart is required)";
        Cu.reportError(msg);
        return win.Promise.reject(msg);
      }

      try {
        return method.apply(this, arguments);
      } catch (err) {
        Cu.reportError(err);
      }
    };
  }

  /**
   * Trigger HAR export.
   */
  this.triggerExport = securityCheck(function(options) {
    let id = ++exportID;

    let promise = new win.Promise(
      function(resolve, reject) {
        exportsInProgress.set(id, resolve);
      }
    );

    Events.emit(actor, "trigger-export", {
      id: id,
      fileName: options.fileName,
      compress: options.compress,
      title: options.title,
      jsonp: options.jsonp,
      includeResponseBodies: options.includeResponseBodies,
      jsonpCallback: options.jsonpCallback,
      forceExport: options.forceExport,
      getData: options.getData,
    });

    return promise;
  });

  /**
   * Clean up the Network monitor panel.
   */
  this.clear = securityCheck(function(options) {
    Events.emit(actor, "clear");
  });
}

// Helpers

function exportIntoContentScope(win, obj, defineAs) {
  let clone = Cu.createObjectIn(win, {
    defineAs: defineAs
  });

  let props = Object.getOwnPropertyNames(obj);

  for (var i=0; i<props.length; i++) {
    let propName = props[i];
    let propValue = obj[propName];
    if (typeof propValue == "function") {
      Cu.exportFunction(propValue, clone, {
        defineAs: propName
      });
    }
  }
}

// Exports from this module
exports.HarDriverActor = HarDriverActor;
