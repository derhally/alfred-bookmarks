---
title: "feat: Add favicon icons for URL bookmarks"
type: feat
status: active
date: 2026-04-01
deepened: 2026-04-01
---

# feat: Add favicon icons for URL bookmarks

## Overview

Add automatic favicon fetching and display for URL bookmarks in the Alfred Bookmark Vault workflow. When a user adds a URL bookmark (via `bkadd` or `bktab`), the workflow fetches the site's favicon and caches it locally. When listing bookmarks, URL items display their site's favicon instead of the generic workflow icon.

## Problem Frame

Currently, all non-checkbox bookmark items display the default workflow icon (`icon.png`) — a generic bookmark vault icon regardless of what website they point to. This makes it harder to visually scan a bookmark list and identify sites at a glance. Popular bookmark managers (browser bookmark bars, Raindrop, etc.) all show favicons, and users expect this visual affordance.

## Requirements Trace

- R1. URL bookmarks added via `bkadd` display the target site's favicon in Alfred results
- R2. URL bookmarks added via `bktab` (browser tab capture) display the target site's favicon
- R3. Favicons are fetched at add-time, not display-time, so listing is always fast
- R4. Favicon cache uses Alfred's `$alfred_workflow_cache` directory
- R5. Checkbox items retain their checked/unchecked icons regardless of URL content
- R6. Non-URL items (plain text, search terms) continue to show the default workflow icon
- R7. Graceful degradation — if favicon fetch fails, the bookmark is still added and displays the default icon
- R8. A fallback "globe/link" icon is bundled for URL items with no cached favicon

## Scope Boundaries

- **Not in scope:** User-specified custom icons per bookmark (deferred to future version)
- **Not in scope:** Background/lazy favicon fetching at display-time for cache misses
- **Not in scope:** Cache invalidation or TTL-based re-fetching
- **Not in scope:** Favicon support for checkbox items containing URLs
- **Not in scope:** Refactoring the duplicated parsing logic between `parse_items.js` and the inline Script Filter

## Context & Research

### Relevant Code and Patterns

- **Title-fetch script (UID `5407019E`)** — `info.plist:698-711`. Bash script that already runs `curl -s` to fetch `<title>` when adding a URL via `bkadd`. This is the natural place to add favicon fetching.
- **bktab pre-process script (UID `65379110`)** — `info.plist:1103-1112`. Bash script for browser tab capture. Currently does NO curl — title comes from browser automation. Needs a favicon fetch added here.
- **Item display Script Filter (UID `F3D37694`)** — `info.plist:2072-2205`. JXA script that builds Alfred JSON. Sets `icon.path` to checkbox icons or `null`. Needs to resolve favicon cache paths for URL items.
- **`parse_items.js`** — Standalone JXA parser. Sets `iconPath` to checkbox icons or `null`. Used by `parse_list.sh` for the "open all items" flow. Needs parallel favicon path logic.
- **Existing icons** — `checked.png`, `unchecked.png`, `create-new.png`, `delete.png`, `back.png` at workflow root. All referenced as relative paths (`./name.png`).
- **Alfred icon format** — `icon: { path: './relative-path.png' }`. Only supports local file paths, not URLs. `null` path falls back to workflow `icon.png`. Non-existent paths also fall back gracefully.
- **`$alfred_workflow_cache`** — Alfred environment variable pointing to `~/Library/Caches/com.runningwithcrayons.Alfred/Workflow Data/com.derhally.bookmarks/`. Directory does not exist by default; must be created.

### External References

- Alfred Script Filter JSON icon format: only local paths, supports `path` + optional `type` (`fileicon`, `filetype`)
- Google S2 Favicons: `https://www.google.com/s2/favicons?domain=DOMAIN&sz=128` — returns PNG, supports size parameter, fast via CDN
- Alfred recommends icons ~256px; 128px from Google S2 is adequate for result rows

## Key Technical Decisions

- **Favicon source: Google S2 API** — Uses `https://www.google.com/s2/favicons?domain=DOMAIN&sz=128`. Returns PNG directly (no format conversion needed), supports size hints, fast via CDN. Unofficial but widely used and reliable. Chosen over DuckDuckGo (returns ICO, no size control) and direct `/favicon.ico` fetch (unreliable, many sites don't serve it there). **Privacy trade-off:** every bookmark addition sends the domain to Google. This is a known limitation for a workflow that otherwise stores everything locally. A future enhancement could add a user configuration toggle to disable favicon fetching.

- **Fetch timing: add-time only** — Favicon is fetched when the bookmark is added, not when the list is displayed. This keeps the display path fast (no network calls) and piggybacks on the existing `curl` call in `bkadd`. For `bktab`, a lightweight `curl` is added. Trade-off: existing bookmarks (pre-feature) won't have favicons until re-added. **Known limitation:** if a favicon fetch fails at add-time (network blip, DNS issue), there is no automatic retry — the bookmark will show the fallback icon until the user re-adds it or manually refreshes. Acceptable for v1 given the simplicity.

- **Cache key: domain-based** — Cache files are named by the hostname extracted from the URL (e.g., `github.com.png`). All URLs on the same domain share one favicon. Subdomains are kept separate (e.g., `docs.github.com.png` vs `github.com.png`) since they could theoretically serve different favicons. The `www.` prefix is NOT stripped — `www.github.com` and `github.com` produce separate cache entries. Both will contain valid favicons from Google S2, so this is a minor storage trade-off for implementation simplicity.

- **Domain extraction contract** — Both bash (add-time) and JXA (display-time) must extract the same hostname for the same URL, or favicons will silently fail to display. The extraction algorithm: strip the protocol (`http://` or `https://`), strip any userinfo (`user:pass@`), take everything up to the first `/`, `:` (port), `?`, `#`, or end of string. This produces the raw hostname. Both implementations must follow this specification. The extracted domain must be validated against a safe character set (`[a-zA-Z0-9.-]`) before use in shell commands or filenames to prevent shell injection and path traversal.

- **Fallback icon: bundled `link.png` with file existence check** — A generic globe/link icon bundled in the workflow root for URL items whose favicon is not cached. The display script checks whether the cached favicon file exists using `$.NSFileManager.defaultManager.fileExistsAtPath()` (a trivial local stat, not a network call). If the file exists, use the cache path; if not, use `'./link.png'`. This makes the fallback explicit rather than relying on Alfred's undocumented behavior with non-existent icon paths.

- **Icon path format: mixed relative and absolute** — Bundled icons use relative paths (`./link.png`, `./checked.png`) consistent with existing code. Cached favicons use absolute paths (`$alfred_workflow_cache/favicons/domain.png`) because the cache is outside the workflow bundle. This is a deliberate pattern exception.

- **No icon for checkbox URL items** — Checkbox items retain checked/unchecked icons. The checkbox state visual indicator is more important than the favicon for task-oriented items.

## Open Questions

### Resolved During Planning

- **Should favicons be fetched synchronously or asynchronously at add-time?** The favicon `curl` is backgrounded with `&` while the title-fetch pipeline runs synchronously (it must remain synchronous because `title=$(curl | grep | sed)` captures into a variable). A `wait` before the `printf` ensures the background favicon curl completes. Since the title pipeline is the slow path (~500ms+ for page download), the favicon fetch (~100-200ms from Google CDN) completes well within that window. Net latency increase: ~0ms.

- **What happens if the Google S2 API is down or rate-limited?** The bookmark is added normally without a favicon. On subsequent displays, it shows the `link.png` fallback icon. No retry mechanism — the favicon fetch is fire-and-forget.

- **Should the favicon path be stored in the markdown file?** No. The favicon is purely a cache artifact. The markdown format remains unchanged. The display script computes the expected cache path from the URL's domain at render time.

### Deferred to Implementation

- **Google S2 fallback icon detection** — Google S2 returns a generic globe icon when a site has no favicon. Whether to detect and discard this (showing `link.png` instead) or accept it is an implementation-time decision based on testing.

- **HTML entity encoding in `info.plist`** — The inline scripts in `info.plist` are stored with HTML entity encoding (`&lt;` for `<`, `&gt;` for `>`, `&amp;` for `&`). The implementer must preserve this encoding when editing inline scripts. Incorrect encoding will silently break the plist.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
ADD FLOW (bkadd):
  User enters URL → Script Filter detects is_url=1
  → Title-fetch script (5407019E):
      1. Extract domain from $add_item (strip protocol, userinfo, port, path)
      2. mkdir -p "$alfred_workflow_cache/favicons"
      3. Background: curl -sfL favicon from Google S2 → cache file &
      4. Foreground: title=$(curl -s $add_item | grep | sed)  (synchronous)
      5. wait  (ensures background favicon curl completes)
      6. printf JSON output (unchanged format)
  → Item formatted as [title](url) → Appended to .md file

ADD FLOW (bktab):
  Browser automation returns title + URL
  → bktab pre-process script (65379110):
      1. Extract domain from $url (same algorithm as bkadd)
      2. mkdir -p "$alfred_workflow_cache/favicons"
      3. Background: curl -sfL favicon from Google S2 → cache file &
         (no wait — don't block this fast flow)
      4. printf JSON output (unchanged format)
  → Item formatted as [title](url) → List picker → Appended to .md file

DISPLAY FLOW:
  User opens a list → Item display script (F3D37694):
    cacheDir = $.getenv('alfred_workflow_cache') + '/favicons'
    For each parsed item:
      if item.isCheckbox → use checked/unchecked icon (unchanged)
      else if item.href exists AND not checkbox:
        extract domain from href (same algorithm as bash scripts)
        cache_path = cacheDir + '/' + domain + '.png'
        if file exists at cache_path → icon.path = cache_path
        else → icon.path = './link.png'  (bundled fallback)
      else (plain text, no href) → icon.path = null (workflow default icon)
```

## Implementation Units

- [ ] **Unit 1: Bundle fallback link icon**

**Goal:** Add a generic globe/link icon to the workflow for URL items without a cached favicon.

**Requirements:** R8

**Dependencies:** None

**Files:**
- Create: `link.png` (128x128 or 256x256 PNG, a generic link/globe icon)

**Approach:**
- Source or create a simple globe or chain-link icon in PNG format
- Should be visually consistent with the existing icon set (similar style to `create-new.png`, `delete.png`, `back.png`)
- Place at workflow root alongside other icons

**Test expectation:** none — static asset, no behavioral change

**Verification:**
- `link.png` exists at the workflow root
- Visual style is consistent with existing icons

---

- [ ] **Unit 2: Add favicon fetch to `bkadd` flow**

**Goal:** When adding a URL bookmark via `bkadd`, fetch the favicon from Google S2 and cache it locally.

**Requirements:** R1, R3, R4, R7

**Dependencies:** Unit 1 (fallback icon should exist, though not strictly required)

**Files:**
- Modify: `info.plist` (inline bash script at UID `5407019E`, lines ~698-711)

**Approach:**
- In the existing bash script that already runs `curl -s` for the page title:
  - Extract the domain from `$add_item` using the domain extraction contract (strip protocol, strip userinfo, take up to first `/` or `:` or end)
  - Ensure cache directory exists: `mkdir -p "${alfred_workflow_cache}/favicons"`
  - Background the favicon download: `curl -sfL -o "${alfred_workflow_cache}/favicons/${domain}.png" "https://www.google.com/s2/favicons?domain=${domain}&sz=128" &`
  - The title-fetch pipeline (`title=$(curl | grep | sed)`) remains synchronous and foreground — it must capture into `$title`
  - Add `wait` before the `printf` to ensure the background favicon curl completes
- Use `-f` flag on favicon curl to prevent writing error/HTML responses to the PNG file on HTTP errors
- The `printf` output format remains unchanged — no new variables needed

**Patterns to follow:**
- The existing `curl -s ${add_item}` call at line 708 of `info.plist` — same graceful degradation approach

**Test scenarios:**
- Happy path: Adding `https://github.com` via `bkadd` → file `github.com.png` appears in `$alfred_workflow_cache/favicons/`
- Happy path: Page title is still fetched correctly (not broken by background favicon curl)
- Edge case: Adding a URL with a port (`https://localhost:3000/path`) → domain extracted as `localhost`, favicon attempted
- Edge case: URL with `www.` prefix → cached as `www.example.com.png` (not stripped)
- Error path: Adding a URL when offline → bookmark is added, no favicon file created (curl -f prevents empty file), no error shown
- Error path: Google S2 returns HTTP 500 → curl -f does not create output file, display script shows `link.png` fallback

**Verification:**
- After adding a URL via `bkadd`, a `.png` file appears in the favicon cache directory named by domain
- The page title fetch still works correctly (no regression)
- Adding a bookmark with no network connectivity still succeeds

---

- [ ] **Unit 3: Add favicon fetch to `bktab` flow**

**Goal:** When adding a URL bookmark via `bktab` (browser tab capture), fetch the favicon from Google S2 and cache it.

**Requirements:** R2, R3, R4, R7

**Dependencies:** Unit 1

**Files:**
- Modify: `info.plist` (inline bash script at UID `65379110`, lines ~1103-1112)

**Approach:**
- In the existing bash script that processes the browser tab title+URL:
  - Extract domain from `$url` (the URL variable parsed from the browser tab)
  - Ensure cache directory: `mkdir -p "${alfred_workflow_cache}/favicons"`
  - Download favicon in background: `curl -sfL -o "${alfred_workflow_cache}/favicons/${domain}.png" "https://www.google.com/s2/favicons?domain=${domain}&sz=128" &`
  - Use `-f` flag to prevent writing error responses to the PNG file
  - This script currently does NO curl, so the favicon fetch is the only network call
  - Run in background (`&`) without `wait` — don't add latency to this fast flow. The favicon may not be cached by the time the user picks a list, but it will be ready for next display
- The `printf` output format remains unchanged

**Patterns to follow:**
- Same domain extraction and curl pattern as Unit 2 for consistency

**Test scenarios:**
- Happy path: Capturing a browser tab for `https://example.com` → favicon file `example.com.png` appears in cache
- Happy path: The list picker still appears immediately (no added latency)
- Edge case: Tab URL has query params or fragments → domain correctly extracted without query/fragment
- Error path: Favicon curl fails silently, bookmark is added normally

**Verification:**
- After `bktab`, a favicon PNG appears in cache for the tab's domain
- The `bktab` flow remains responsive (no perceived latency increase)

---

- [ ] **Unit 4: Display favicons in item list Script Filter**

**Goal:** When displaying bookmark items, show cached favicons for URL items instead of the default workflow icon.

**Requirements:** R1, R2, R5, R6, R8

**Dependencies:** Units 2, 3 (favicons must be cached for display to work)

**Files:**
- Modify: `info.plist` (inline JXA script at UID `F3D37694`, lines ~2072-2205)

**Approach:**
- Add `ObjC.import('Foundation')` to the script (required for `$.NSFileManager` — the existing `ObjC.import('stdlib')` only provides C stdlib functions like `$.getenv()`)
- Read `alfred_workflow_cache` at the top of the `run` function via `$.getenv('alfred_workflow_cache')`, **wrapped in try-catch** with a fallback that disables favicon display (sets `cacheDir` to `null`). In JXA, `$.getenv()` throws if the variable is not set — it does not return null. The existing codebase demonstrates this pattern at UID `474362A0` where `$.getenv()` calls are wrapped in `try {} catch {}`
- In the icon-path logic (after parsing, in the item-building section):
  - If `isCheckbox`: keep checked/unchecked icon (unchanged)
  - Else if `href` exists (URL item, not checkbox):
    - Extract domain from `href` using the same algorithm as bash scripts (strip protocol, userinfo, port, path)
    - Compute `cachePath = cacheDir + '/favicons/' + domain + '.png'`
    - Check if file exists: `$.NSFileManager.defaultManager.fileExistsAtPath(cachePath)` — this is a local stat call, negligible overhead even for 50+ items
    - If exists: set `iconPath = cachePath` (absolute path)
    - If not exists: set `iconPath = './link.png'` (bundled fallback)
  - Else (plain text, no href): `iconPath` remains `null` (workflow default icon per R6)

**Patterns to follow:**
- The existing `iconPath` conditional at lines 2106-2110 — extend rather than replace
- JXA environment variable access: `$.getenv('alfred_workflow_cache')` (already used for other env vars in this script via `ObjC.import('stdlib')`)
- The domain extraction regex should be consistent with the bash implementation

**Test scenarios:**
- Happy path: URL item with cached favicon → Alfred item shows the favicon image
- Happy path: Checkbox URL item → still shows checked/unchecked icon, not favicon (R5)
- Happy path: Plain text (non-URL) item → shows default workflow icon, iconPath null (R6)
- Happy path: URL item with no cached favicon → shows `link.png` fallback icon (R8)
- Edge case: Markdown link `[title](url)` → domain extracted from href, favicon displayed
- Edge case: URL with `www.` prefix → looks up `www.example.com.png` (consistent with add-time caching)
- Integration: Add a URL via `bkadd`, then display the list → favicon appears in the list
- Integration: Add a URL via `bktab`, display list after a moment → favicon appears

**Verification:**
- URL bookmarks display their site's favicon in Alfred results
- URL bookmarks without cached favicons show the `link.png` fallback
- Checkbox items still show checked/unchecked icons
- Plain text items still show the default workflow icon
- No errors or crashes when favicon cache directory doesn't exist

---

- [ ] **Unit 5: Verify `parse_items.js` compatibility (no changes expected)**

**Goal:** Verify that the standalone parser does not need changes for this feature.

**Requirements:** None directly — this is a compatibility verification

**Dependencies:** Unit 4

**Files:**
- Review: `parse_items.js`
- Review: `parse_list.sh`

**Approach:**
- `parse_items.js` is used by `parse_list.sh` for the "open all items" flow, which opens URLs in the browser — it does not display icons in Alfred results
- The `iconPath` field produced by `parse_items.js` is serialized into the `items` variable but is NOT consumed by any downstream node in the open-all flow (the downstream conditional routes based on `action`, not `iconPath`)
- Therefore, no changes are needed in `parse_items.js` for this feature
- Adding favicon logic here would: (a) break the script's pure-`argv` pattern by introducing `$.getenv()`, (b) require changing `parse_list.sh` to pass the cache path, (c) produce a value that is never consumed
- If a future feature needs icons in `parse_items.js`, it can be added then

**Test expectation:** none — no code changes, verification only

**Verification:**
- The "open all items" flow still works correctly after the other units are implemented
- `parse_items.js` remains unchanged

---

- [ ] **Unit 6: Update `.zip.sh` packaging to include `link.png`**

**Goal:** Ensure the new `link.png` fallback icon is included in the `.alfredworkflow` package.

**Requirements:** R8 (fallback icon must ship with the workflow)

**Dependencies:** Unit 1

**Files:**
- Review: `.zip.sh` (lines ~46-47)

**Approach:**
- The current zip command includes all files except dotfiles, docs, markdown, plist backup, gifs, and previous workflow files
- `link.png` will be automatically included since it's a `.png` file at the root — no change to `.zip.sh` needed
- Verify by reviewing the exclusion patterns

**Test expectation:** none — the existing zip exclusion patterns already include PNG files. This unit is a verification checkpoint.

**Verification:**
- Running `.zip.sh` produces a `.alfredworkflow` file that contains `link.png`

## System-Wide Impact

- **Interaction graph:** The favicon fetch is added to two existing bash scripts (UIDs `5407019E` and `65379110`). The favicon display is in the JXA Script Filter (UID `F3D37694`). No other nodes, triggers, or conditionals are affected.
- **Error propagation:** Favicon fetch failures are silently absorbed — the `curl` command runs with `-s` (silent) and the output file simply won't exist. Alfred's icon fallback handles missing files gracefully.
- **State lifecycle risks:** Favicon cache files are write-once (at add-time) and never updated or deleted by the workflow. No orphan cleanup is needed for v1. Alfred's cache clearing mechanism can remove the entire cache directory.
- **API surface parity:** The external triggers (`add_item`, `show_lists`, `open_list`, `open_item`) are unchanged. No new variables or configuration options are introduced.
- **Unchanged invariants:** The markdown file format is completely unchanged. Bookmark data is not modified. The favicon is purely a display-time cache artifact derived from the URL's domain.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Google S2 API is unofficial and could break | Graceful degradation — bookmarks still work, just show fallback icon. Favicon source can be swapped in a future update. |
| Google S2 rate limiting (~55 requests) | Users rarely add 55+ bookmarks in rapid succession. Add-time fetching naturally rate-limits to user interaction speed. |
| `$alfred_workflow_cache` env var unavailable in some contexts | Always check and `mkdir -p` before use. The variable is documented as available in all Alfred workflow script contexts. |
| Network latency on `bkadd` increased by favicon fetch | Background favicon curl with `&` while title pipeline runs synchronously. `wait` ensures completion. Adds ~0ms extra wall-clock time. |
| Cached PNG from Google S2 is a generic globe (no real favicon found) | Acceptable — visually similar to the `link.png` fallback. Not worth detecting in v1. |
| Domain extraction divergence between bash and JXA | Specified a shared contract in Key Technical Decisions. Both must strip protocol, userinfo, port, and path to extract raw hostname. |
| Privacy: bookmark domains sent to Google | Documented as known trade-off. Future enhancement: add user config toggle to disable favicon fetching. |
| Permanent favicon failure (no retry) | Documented as known v1 limitation. Future enhancement: `bkrefresh` command or manual cache repopulation. |
| `curl -o` writes error responses to file | Using `-f` flag on favicon curl to prevent creating output file on HTTP errors. |
| HTML entity encoding in `info.plist` inline scripts | Documented in Deferred to Implementation. Implementer must preserve `&lt;`, `&gt;`, `&amp;` encoding. |

## Sources & References

- Related code: `info.plist` (UIDs `5407019E`, `65379110`, `F3D37694`), `parse_items.js`, `parse_list.sh`
- Alfred Script Filter JSON icon docs: https://www.alfredapp.com/help/workflows/inputs/script-filter/json/
- Alfred workflow environment variables: https://www.alfredapp.com/help/workflows/script-environment-variables/
- Google S2 Favicons API: https://www.google.com/s2/favicons?domain=example.com&sz=128
