#!/usr/bin/env osascript -l JavaScript

function run(argv) {
  const jsonStr = argv[0];
  const showChecked = argv[1] === 'true';
  const items = [];

  var bookmarks = [];
  try {
    bookmarks = JSON.parse(jsonStr);
  } catch (e) {
    return JSON.stringify([]);
  }

  bookmarks.forEach(function(item) {
    if (item.checked === true && !showChecked) {
      return;
    }

    items.push({
      text: item.name || '',
      href: item.url || null,
      isCheckbox: item.checked !== undefined,
      isChecked: item.checked === true,
    });
  });

  return JSON.stringify(items);
}
