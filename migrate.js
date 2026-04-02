#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  ObjC.import('stdlib');
  ObjC.import('Foundation');

  var folderPath;
  try {
    folderPath = $.getenv('folder_path');
  } catch (e) {
    if (argv.length > 0) {
      folderPath = argv[0];
    } else {
      return 'Error: No folder_path set. Pass as argument or set folder_path env var.';
    }
  }

  var fm = $.NSFileManager.defaultManager;
  var results = [];

  // Regex patterns (same as parse_items.js)
  var mdCheckboxMatch = /(?:-|\*) \[(x| )\] (.+)$/i;
  var url = 'https?:\\/\\/(?:[\\w-]+(\\.[\\w-]+)+|localhost|\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})(:\\d+)?\\S*';
  var urlRegex = new RegExp('^' + url + '$', 'i');
  var mdLinkRegex = new RegExp('\\[(.*)\\]\\((' + url + ')\\)', 'i');

  function extractDomain(href) {
    var stripped = href.replace(/^https?:\/\//, '');
    stripped = stripped.replace(/^[^@]*@/, '');
    var match = stripped.match(/^([a-zA-Z0-9.-]+)/);
    return match ? match[1] : null;
  }

  function parseLine(str) {
    var trimmed = str.trim();
    if (!trimmed) return null;

    var checkboxMatch = trimmed.match(mdCheckboxMatch);
    var item = {};

    if (checkboxMatch) {
      var isChecked = checkboxMatch[1].toLowerCase() === 'x';
      var content = checkboxMatch[2];

      // Check if checkbox content is a URL or markdown link
      var isURL = urlRegex.test(content);
      var linkMatch = content.match(mdLinkRegex);

      if (linkMatch) {
        item.name = linkMatch[1];
        item.url = linkMatch[2];
        var domain = extractDomain(item.url);
        if (domain) item.icon = domain;
      } else if (isURL) {
        item.name = content;
        item.url = content;
        var domain = extractDomain(item.url);
        if (domain) item.icon = domain;
      } else {
        item.name = content;
      }

      item.checked = isChecked;
    } else {
      var isURL = urlRegex.test(trimmed);
      var linkMatch = trimmed.match(mdLinkRegex);

      if (linkMatch) {
        item.name = linkMatch[1];
        item.url = linkMatch[2];
        var domain = extractDomain(item.url);
        if (domain) item.icon = domain;
      } else if (isURL) {
        item.name = trimmed;
        item.url = trimmed;
        var domain = extractDomain(item.url);
        if (domain) item.icon = domain;
      } else {
        item.name = trimmed;
      }
    }

    return item;
  }

  // List .md files
  var folderURL = $.NSURL.fileURLWithPath(folderPath);
  var contents = fm.contentsOfDirectoryAtURLIncludingPropertiesForKeysOptionsError(
    folderURL, [], 0, null
  );

  if (!contents) {
    return 'No files found in ' + folderPath;
  }

  var mdFiles = [];
  for (var i = 0; i < contents.count; i++) {
    var fileURL = contents.objectAtIndex(i);
    var filePath = fileURL.path.js;
    if (filePath.match(/\.md$/i)) {
      mdFiles.push(filePath);
    }
  }

  if (mdFiles.length === 0) {
    return 'No .md files found to migrate.';
  }

  for (var i = 0; i < mdFiles.length; i++) {
    var mdPath = mdFiles[i];
    var content = $.NSString.stringWithContentsOfFileEncodingError(
      mdPath, $.NSUTF8StringEncoding, null
    );

    if (!content) {
      results.push('Warning: Could not read ' + mdPath);
      continue;
    }

    var lines = content.js.split('\n');
    var items = [];

    for (var j = 0; j < lines.length; j++) {
      var parsed = parseLine(lines[j]);
      if (parsed) {
        items.push(parsed);
      }
    }

    var jsonStr = JSON.stringify(items, null, 2);
    var jsonPath = mdPath.replace(/\.md$/i, '.json');

    // Write JSON file
    var nsJsonStr = $.NSString.alloc.initWithUTF8String(jsonStr);
    var success = nsJsonStr.writeToFileAtomicallyEncodingError(
      jsonPath, true, $.NSUTF8StringEncoding, null
    );

    if (success) {
      // Remove old .md file
      fm.removeItemAtPathError(mdPath, null);
      results.push('Migrated: ' + mdPath + ' -> ' + jsonPath);
    } else {
      results.push('Error: Failed to write ' + jsonPath);
    }
  }

  return results.join('\n');
}
