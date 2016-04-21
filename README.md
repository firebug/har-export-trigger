# HAR Export Trigger
Firefox add-on improving automated HAR (HTTP Archive) export of collected
data from the Network panel. This add-on is built on top of native developer
tools in Firefox. Firebug is not needed for this add-on.

The add-on exports HAR API directly to the page. Any automated system can
be consequently built on top of the API and trigger HAR export using a simple
JavaScript call at any time. It can be also nicely integrated with e.g.
Selenium to implement automated HAR export robots for existing automated test
suites.

Visit [Home Page](http://www.softwareishard.com/blog/har-export-trigger/)

License
-------
HAR Export Trigger is free and open source software distributed under the
[BSD License](https://github.com/firebug/har-export-trigger/blob/master/license.txt).

Requirements
------------
You need Firefox 42+ to run this extension.

Download
--------
See the latest [release](https://github.com/firebug/har-export-trigger/releases)

How To Use
----------
This extension exposes HAR API into the content allowing pages to trigger
HAR export as needed. To ensure that API is properly exposed into the
page content you need to yet set the following preference
in your Firefox profile (any string value that is passed into API calls):

`extensions.netmonitor.har.contentAPIToken`

To start automated collecting of HTTP data you need to set
the following preference to true:

`extensions.netmonitor.har.enableAutomation`

You might also want to set the following preference to true,
so the developer Toolbox doesn't have to be opened.

`extensions.netmonitor.har.autoConnect`

---

An example script on your page can look like as follows:

```
var options = {
  token: "test",      // Value of the token in your preferences
  getData: true,      // True if you want to get HAR data as a string
};

HAR.triggerExport(options).then(result => {
  console.log(result.data);
});
```

* Check out [a test page](http://janodvarko.cz/har/tests/har-export-trigger/har-export-api.html)
* See more [HAR API examples](https://github.com/firebug/har-export-trigger/wiki/Examples)

Build & Run HAR Export Trigger
------------------------------
Following instructions describe how to build the extension
from the source and run on your machine.

1. Install JPM: `npm install jpm -g` (read more about [installing jpm](https://developer.mozilla.org/en-US/Add-ons/SDK/Tools/jpm#Installation))
2. Get the source: `git clone https://github.com/firebug/har-export-trigger.git`
3. Install required NPM modules: `npm install`
4. Run `jpm run -b nightly` in the source directory (learn more about [jpm commands](https://developer.mozilla.org/en-US/Add-ons/SDK/Tools/jpm#Command_reference))

Further Resources
-----------------
* Home Page: http://www.softwareishard.com/blog/har-export-trigger/
* HAR Spec: https://dvcs.w3.org/hg/webperf/raw-file/tip/specs/HAR/Overview.html
* HAR Spec (original): http://www.softwareishard.com/blog/har-12-spec/
* HTTP Archive Viewer: http://www.softwareishard.com/blog/har-viewer/
* HAR Discussion Group: http://groups.google.com/group/http-archive-specification/

