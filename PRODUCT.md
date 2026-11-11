# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: Nelson, the owner. He uses it at his Mac when adding and sorting files, and on his phone near the printers. He has ADHD, so the hub has to stay calm and scannable, with one clear thing to do at a time.

## Product Purpose

Print Hub's main job is getting a messy pile of 3D-print files under control: one tidy place for every STL, 3MF, OBJ, STEP and G-code file instead of copies scattered across Downloads, iCloud Drive and project folders on the Mac. Success is a library with no duplicates, every file in the right project (or knowingly Unsorted), multi-piece prints grouped as sets, and the Mac's folders cleaned to match.

Finding and reprinting a file, marking what printed well, tracking what's sellable and keeping a filament inventory all build on that tidy library; they are secondary jobs.

## Positioning

It's built around this one person's printers, projects and folders: auto-sort by his project keywords, a cleanup script that removes the matching originals from his Mac, and his two printers and filament on hand. It is a personal tool, not a marketplace or a slicer.

## Operating Context

- Files arrive by download onto the Mac (Downloads, iCloud Drive "00 Inbox", a "3D Printing" folder with project subfolders) and are added to the hub with Add files / Add folder or drag and drop. There is no automatic sync; adding new downloads is a periodic chore.
- Deleting in the hub puts the file on the Mac cleanup list; the Mac originals are removed by pasting one Terminal command from the Mac cleanup page, which asks before moving anything to the Trash.
- Printers: Anycubic Kobra S1 Combo (250 mm cube, ACE Pro multi-color) and Flashforge Adventurer 5M (220 mm cube). Slicer: Anycubic Slicer Next.
- Hosted on Vercel; catalog in a Neon Postgres database; the 3D files in Vercel Blob storage.

## Capabilities and Constraints

- Library: add files, folders or zips; duplicates (same name and size) skipped; auto-sort into Work or Personal projects by keyword; Unsorted for the rest; folders inside projects; tags; titles and notes; favorites.
- Status per file or set: Raw, Cleaned, Final (guessed from the name, one tap to mark Final).
- Sets group multi-piece prints into one card.
- Sellable shelf with an asking price; filament inventory with cost per gram (for a Shop cost calculator later).
- Tidying tools: Select mode for bulk moves and marks, a Duplicates scan (exact copies by content), a Mac cleanup list and script.
- Preview pictures are made in the browser (embedded 3MF / G-code previews, otherwise a three.js render); STEP files get none.
- No login: anyone with the address can open it. Single user.
- Open: 248 of 310 files had no stored 3D file at last check (added before storage worked); re-adding the source folders fills them in.

## Product Principles

- Tidy beats complete: help him clear the pile (duplicates, unsorted, empty entries) before adding features on top.
- One clear next action on every screen; nothing competes for attention.
- The Mac is the backup, the hub is the main view; nothing on the Mac changes without him confirming.
- Every file stays findable: sets, filters and search never hide a file for good.

## Accessibility & Inclusion

The only user has ADHD: keep it calm and uncluttered, keep priorities obvious, avoid motion that isn't a response to his own action, and respect reduced-motion settings.
