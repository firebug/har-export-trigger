# HAR Export Trigger
Firefox add-on for automated HAR (HTTP Archive) export. This add-on is built on
top of native developer tools in Firefox and allows automated export
of all collected and computed data from the <strong>Network</strong> panel.
Automation can be implemented on top of HAR API that are exposed directly
to the page.
It can be also used together with e.g. Selenium to implement automated HAR
export robots. Firebug is not needed for this add-on.

Read more about [HAR](http://www.softwareishard.com/blog/har-12-spec/) format
(based on JSON).


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
in your Firefox profile (any string value passed into API calls):

`extensions.netmonitor.har.contentAPIToken`

To start automated collecting of HTTP data you need to set
the following preference:

`devtools.netmonitor.har.enableAutoExportToFile`

The script on your page can look like as follows:

```
var options = {
  token: "test",    // Value of the token in your preferences
  getData: true,    // True if you want to also get HAR data as a string in the callback
  title: "my custom title",  // Title used for the HAR file
  jsonp: false,     // Set to true if you want HARP
  fileName: "my test har file %Y, %H:%M:%S"  // Name of the file
};

HAR.triggerExport(options).then(result => {
  console.log(result.data);
});
```

Check out [a test page](http://janodvarko.cz/har/tests/har-export-trigger/har-export-api.html)

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

