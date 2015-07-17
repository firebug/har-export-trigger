# HAR Export Trigger
Firefox plugin for HAR (HTTP Archive) export. Built on top of native
developer tools in Firefox. Allows triggering HAR export directly
from within a page.

License
-------
HAR Export Trigger is free and open source software distributed under the
[BSD License](https://github.com/firebug/har-export-trigger/blob/master/license.txt).

How To Use
----------
This extension exposes HAR API into the content allowing pages to trigger
HAR export as needed. To ensure that API is properly exposed into the
page content you need to yet set the following preference
in your Firefox profile:

`devtools.netmonitor.har.enableAutoExportToFile`

The script on your page can look like as follows:

```
var options = {
  token: "test",    // Value of the token in your preferences
  getData: true,    // Set to true if you want to also get HAR data
  title: "my custom title",  // Title used for the HAR file
  jsonp: false,     // Set to true if you want HARP
  fileName: "my test har file %Y, %H:%M:%S"  // Name of the file
};

HAR.triggerExport(options).then(result => {
  console.log(result.data);
});
```

Further Resources
-----------------
* HAR Spec: https://dvcs.w3.org/hg/webperf/raw-file/tip/specs/HAR/Overview.html
* HAR Spec (original): http://www.softwareishard.com/blog/har-12-spec/
* DevTools Extension Examples: https://github.com/mozilla/addon-sdk/tree/devtools/examples
